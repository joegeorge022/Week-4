import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isLocalModel } from './config.js';
import { openStore } from './store.js';
import { chatWithGhost, writeRemembrance, modelStatus } from './agent.js';
import { initTelemetry, summary, captureError, tracingEnabled } from './telemetry.js';
import { speak, transcribe, voiceEnabled } from './voice.js';
import { isAuthed, safeEqual, sessionToken, checkRequestOrigin, makeLimiter } from './security.js';

const PUBLIC = path.join(config.root, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const send = (res, status, body, headers = {}) => {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
};

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Payload too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = 2_500_000) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function startSSE(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  return {
    signal: ac.signal,
    emit: (e) => !res.writableEnded && res.write(`data: ${JSON.stringify(e)}\n\n`),
    end: () => res.end(),
  };
}

async function pipeSSE(req, res, gen) {
  const sse = startSSE(req, res);
  try {
    for await (const e of gen(sse.signal)) sse.emit(e);
  } catch (err) {
    captureError(err);
    sse.emit({ type: 'error', message: 'Something went wrong while summoning the reply.' });
  }
  sse.end();
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

export function createApp(store) {
  const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const loginLimiter = makeLimiter({ max: 8, windowMs: 60_000 });

  async function route(req, res, url) {
    const { pathname } = url;
    const m = req.method;
    const parts = pathname.split('/').filter(Boolean); // ['api', 'people', id, ...]

    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

    const originProblem = checkRequestOrigin(req, { loopbackOnly });
    if (originProblem) throw new HttpError(403, `Blocked: ${originProblem}`);

    // ---- public endpoints -------------------------------------------------
    if (pathname === '/api/health' && m === 'GET') return send(res, 200, { ok: true });

    if (pathname === '/api/login' && m === 'POST') {
      if (!config.pin) return send(res, 200, { ok: true });
      if (!loginLimiter(req.socket.remoteAddress)) throw new HttpError(429, 'Too many attempts. Wait a minute.');
      const { pin } = await readJson(req, 4096);
      if (!safeEqual(pin ?? '', config.pin)) throw new HttpError(401, 'That is not the right word.');
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, {
        'set-cookie': `ofrenda=${sessionToken(config.pin)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`,
      });
    }

    const authed = isAuthed(req, config.pin);

    if (pathname === '/api/features' && m === 'GET') {
      return send(res, 200, {
        pinRequired: Boolean(config.pin),
        authed,
        ...(authed && {
          model: config.model,
          localModel: isLocalModel(),
          store: store.kind,
          tracing: tracingEnabled(),
          voice: voiceEnabled() ? 'elevenlabs' : 'browser',
          transcribe: voiceEnabled(),
          model_status: await modelStatus(),
        }),
      });
    }

    if (!authed) throw new HttpError(401, 'Locked');

    // ---- private endpoints ------------------------------------------------
    if (pathname === '/api/stats' && m === 'GET') return send(res, 200, summary());

    if (pathname === '/api/export' && m === 'GET') {
      return send(res, 200, await store.exportAll(), {
        'content-disposition': 'attachment; filename="ofrenda-export.json"',
      });
    }

    if (pathname === '/api/data' && m === 'DELETE') {
      const { confirm } = await readJson(req, 1024);
      if (confirm !== 'DELETE') throw new HttpError(400, 'Send {"confirm":"DELETE"} to wipe everything.');
      await store.wipe();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/speak' && m === 'POST') {
      if (!voiceEnabled()) throw new HttpError(501, 'No ElevenLabs key configured');
      const { text } = await readJson(req, 20_000);
      if (!text) throw new HttpError(400, 'text required');
      const upstream = await speak(text);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }

    if (pathname === '/api/transcribe' && m === 'POST') {
      if (!voiceEnabled()) throw new HttpError(501, 'No ElevenLabs key configured');
      const audio = await readBody(req, 25_000_000);
      if (!audio.length) throw new HttpError(400, 'audio required');
      const text = await transcribe(audio, (req.headers['content-type'] || 'audio/webm').split(';')[0]);
      return send(res, 200, { text });
    }

    if (parts[1] === 'people') {
      const [, , id, sub, subId] = parts;

      if (!id) {
        if (m === 'GET') return send(res, 200, await store.listPeople());
        if (m === 'POST') {
          const body = await readJson(req);
          if (!String(body.name ?? '').trim()) throw new HttpError(400, 'name required');
          return send(res, 201, await store.createPerson(body));
        }
      } else {
        const person = await store.getPerson(id);
        if (!person) throw new HttpError(404, 'No such person');

        if (!sub) {
          if (m === 'GET') return send(res, 200, person);
          if (m === 'PUT') return send(res, 200, await store.updatePerson(id, await readJson(req)));
          if (m === 'DELETE') return send(res, 200, { ok: await store.deletePerson(id) });
        }

        if (sub === 'memories') {
          if (m === 'GET' && !subId) return send(res, 200, await store.listMemories(id));
          if (m === 'POST' && !subId) {
            const mem = await store.addMemory(id, await readJson(req, 100_000));
            if (!mem) throw new HttpError(400, 'text required');
            return send(res, 201, mem);
          }
          if (m === 'DELETE' && subId) return send(res, 200, { ok: await store.deleteMemory(id, subId) });
        }

        if (sub === 'chat' && m === 'POST') {
          const { message, history, mode } = await readJson(req, 100_000);
          if (!String(message ?? '').trim()) throw new HttpError(400, 'message required');
          const memories = await store.listMemories(id);
          return pipeSSE(req, res, (signal) =>
            chatWithGhost({ person, memories, message, history, mode: mode === 'keeper' ? 'keeper' : 'echo', signal }),
          );
        }

        if (sub === 'remembrance' && m === 'POST') {
          const { style, lang } = await readJson(req, 4096);
          const memories = await store.listMemories(id);
          if (!memories.length && !person.foods.length && !person.songs.length) {
            throw new HttpError(400, 'Add a memory first so there is something to remember.');
          }
          return pipeSSE(req, res, (signal) =>
            writeRemembrance({
              person,
              memories,
              style: style === 'calaverita' ? 'calaverita' : 'letter',
              lang: lang === 'es' ? 'es' : 'en',
              signal,
            }),
          );
        }
      }
    }

    throw new HttpError(404, 'Not found');
  }

  return http.createServer(async (req, res) => {
    try {
      await route(req, res, new URL(req.url, 'http://local'));
    } catch (err) {
      if (!(err instanceof HttpError)) captureError(err);
      if (res.headersSent) return res.end();
      const status = err instanceof HttpError ? err.status : 500;
      send(res, status, { error: status === 500 ? 'Internal error' : err.message });
      if (status === 500) console.error(err);
    }
  });
}

/* ---- boot ---------------------------------------------------------------- */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initTelemetry();
  const store = await openStore(config);
  const server = createApp(store);

  if (!config.pin && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    console.warn('[security] Listening on a non-loopback address with no OFRENDA_PIN. Anyone who can reach this port can read the altar.');
  }

  server.listen(config.port, config.host, async () => {
    const st = await modelStatus();
    console.log(`\n🕯  Ofrenda is lit: http://${config.host}:${config.port}`);
    console.log(`   model   : ${config.model} @ ${config.ollamaBase} ${isLocalModel() ? '(local, nothing leaves this machine)' : '(REMOTE model host)'}`);
    console.log(`   storage : ${store.kind}`);
    console.log(`   tracing : ${tracingEnabled() ? 'sentry (timings only)' : 'local only'}`);
    console.log(`   voice   : ${voiceEnabled() ? 'elevenlabs (cloud)' : 'browser speech (local)'}`);
    if (!st.reachable) console.log(`\n   ⚠ Ollama not reachable. Start it with: ollama serve`);
    else if (!st.installed) console.log(`\n   ⚠ Model missing. Run: ollama pull ${config.model}`);
  });

  const shutdown = async () => {
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
