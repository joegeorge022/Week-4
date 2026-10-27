#!/usr/bin/env node
// `npm run doctor` : checks your setup and tells you, in plain words, what works and what to fix.
// Reads the same .env the app reads. Never prints a secret.
//   npm run doctor            checks config, Ollama, and every optional key you have filled in
//   npm run doctor -- --deep  also asks the model one tiny question (slow on a cold start)

import { config, isLocalModel } from '../server/config.js';

const deep = process.argv.includes('--deep');
const useColor = process.stdout.isTTY;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const tags = { pass: c('32', 'PASS'), warn: c('33', 'WARN'), fail: c('31', 'FAIL'), skip: c('90', 'SKIP') };
const tally = { pass: 0, warn: 0, fail: 0, skip: 0 };

function say(level, title, detail = '', fix = '') {
  tally[level]++;
  console.log(`${tags[level]}  ${title}${detail ? c('90', ` · ${detail}`) : ''}`);
  if (fix) console.log(`      ${c('36', '→')} ${fix}`);
}

const withTimeout = (ms) => AbortSignal.timeout(ms);
const msg = (err) => String(err?.cause?.code || err?.code || err?.message || err).slice(0, 140);

console.log(c('1', '\nOfrenda doctor\n'));

// ---- Node ------------------------------------------------------------------
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 20 || (maj === 20 && min >= 12)) say('pass', 'Node.js', `v${process.versions.node}`);
  else say('fail', 'Node.js', `v${process.versions.node}`, 'Install Node 20.12 or newer (Node 22 recommended): https://nodejs.org');
}

// ---- Server settings -------------------------------------------------------
{
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!loopback && !config.pin) {
    say('fail', 'HOST / PIN', `HOST=${config.host} with no OFRENDA_PIN`, 'Anyone who finds the URL could read the altar. Set OFRENDA_PIN, or set HOST=127.0.0.1.');
  } else if (!loopback) {
    say('pass', 'HOST / PIN', `public bind, protected by OFRENDA_PIN (${config.pin.length} chars)`);
    if (config.pin.length < 8) say('warn', 'OFRENDA_PIN is short', '', 'Use 12+ characters on a public URL:  openssl rand -base64 18');
  } else {
    say('pass', 'HOST', `${config.host}:${config.port} (this computer only)${config.pin ? ', PIN set' : ''}`);
  }
}

// ---- Ollama + model --------------------------------------------------------
{
  const where = isLocalModel() ? 'local' : 'remote';
  try {
    const r = await fetch(`${config.ollamaBase}/api/tags`, { signal: withTimeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { models = [] } = await r.json();
    const names = models.map((m) => m.name);
    const want = config.model.includes(':') ? config.model : `${config.model}:latest`;
    if (names.includes(want)) {
      say('pass', 'Ollama', `${where} at ${config.ollamaBase}, model ${config.model} installed`);
      if (deep) {
        const t0 = Date.now();
        try {
          const g = await fetch(`${config.ollamaBase}/api/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: config.model, prompt: 'Say hola.', stream: false, options: { num_predict: 8 } }),
            signal: withTimeout(180_000),
          });
          if (!g.ok) throw new Error(`HTTP ${g.status}`);
          say('pass', 'Model answers', `first reply in ${((Date.now() - t0) / 1000).toFixed(1)}s (a cold start is the slowest it will ever be)`);
        } catch (err) {
          say('fail', 'Model answers', msg(err), 'The model is installed but did not respond. Close other heavy apps, or try OFRENDA_MODEL=gemma3:1b.');
        }
      }
    } else {
      say('fail', 'Ollama is up, model missing', `${config.model} not installed (have: ${names.join(', ') || 'nothing'})`, `Run:  ollama pull ${config.model}`);
    }
  } catch (err) {
    say('fail', 'Ollama', `could not reach ${config.ollamaBase} (${msg(err)})`, 'Install Ollama (https://ollama.com), open it, then run:  ollama pull ' + config.model);
  }
}

// ---- ElevenLabs ------------------------------------------------------------
if (!config.elevenKey) {
  say('skip', 'ElevenLabs', 'no ELEVENLABS_API_KEY', 'Optional. Without it the app reads aloud with your browser voice and the record button is hidden.');
} else {
  try {
    // A 4-character synthesis is the most honest test: it needs the same permission the app uses.
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenVoice)}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hola', model_id: 'eleven_multilingual_v2' }),
      signal: withTimeout(20_000),
    });
    if (r.ok) {
      const bytes = (await r.arrayBuffer()).byteLength;
      say('pass', 'ElevenLabs text-to-speech', `key accepted, got ${bytes} bytes of audio`);
    } else if (r.status === 401) {
      const body = await r.text();
      const perm = /missing_permissions|permission/i.test(body);
      say('fail', 'ElevenLabs', perm ? 'key is valid but lacks the Text to Speech permission' : 'key rejected (401)',
        perm ? 'Edit the key in ElevenLabs and enable Text to Speech + Speech to Text.' : 'Copy the key again from elevenlabs.io → API Keys (no spaces or quotes).');
    } else if (r.status === 402 || r.status === 429) {
      say('warn', 'ElevenLabs', `key works but the account hit a limit (${r.status})`, 'Check your credits / concurrency on elevenlabs.io.');
    } else if (r.status === 404 || r.status === 400 || r.status === 422) {
      say('fail', 'ElevenLabs', `request rejected (${r.status}); is ELEVENLABS_VOICE_ID valid for your account?`, 'Remove ELEVENLABS_VOICE_ID to use the default voice.');
    } else {
      say('fail', 'ElevenLabs', `unexpected HTTP ${r.status}`);
    }
  } catch (err) {
    say('fail', 'ElevenLabs', `network error (${msg(err)})`, 'Check your internet connection.');
  }
}

// ---- MongoDB ---------------------------------------------------------------
if (!config.mongoUri) {
  say('skip', 'MongoDB Atlas', 'no MONGODB_URI', 'Optional. Without it your altar is saved to data/altar.json.');
} else {
  let client;
  try {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    await client.db(config.mongoDb).command({ ping: 1 });
    say('pass', 'MongoDB Atlas', `connected, database "${config.mongoDb}"`);
  } catch (err) {
    const text = msg(err);
    let fix = 'Re-copy the connection string from Atlas → Connect → Drivers.';
    if (/auth/i.test(text)) fix = 'Wrong user or password. In Atlas → Database Access, check the user and that special characters in the password are URL-encoded.';
    else if (/ENOTFOUND|querySrv|ECONNREFUSED|timed out|selection/i.test(text)) fix = 'Atlas is blocking you. In Atlas → Network Access, add your current IP (or 0.0.0.0/0 for Render).';
    say('fail', 'MongoDB Atlas', text, fix);
  } finally {
    await client?.close().catch(() => {});
  }
}

// ---- Sentry ----------------------------------------------------------------
if (!config.sentryDsn) {
  say('skip', 'Sentry', 'no SENTRY_DSN', 'Optional. Without it you still get the local speed stats in the app.');
} else {
  // The SDK swallows delivery errors, so talk to Sentry's ingest endpoint directly and read the status.
  try {
    const dsn = new URL(config.sentryDsn);
    const projectId = dsn.pathname.split('/').filter(Boolean).pop();
    if (!dsn.username || !projectId) throw new Error('bad DSN');
    const eventId = crypto.randomUUID().replaceAll('-', '');
    const event = { event_id: eventId, timestamp: Date.now() / 1000, level: 'info', platform: 'node', message: 'Ofrenda doctor: setup check (safe to ignore)' };
    const body = [{ event_id: eventId }, { type: 'event' }, event].map((o) => JSON.stringify(o)).join('\n');
    const r = await fetch(`${dsn.protocol}//${dsn.host}/api/${projectId}/envelope/?sentry_key=${dsn.username}&sentry_version=7`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body,
      signal: withTimeout(10_000),
    });
    if (r.ok) say('pass', 'Sentry', `DSN accepted a test event (${eventId.slice(0, 8)}…); it will appear in your project's Issues`);
    else if ([400, 401, 403, 404].includes(r.status)) say('fail', 'Sentry', `DSN rejected (${r.status})`, 'Copy the DSN again from Sentry → Settings → Client Keys (DSN).');
    else say('warn', 'Sentry', `unexpected HTTP ${r.status}`);
  } catch (err) {
    say('fail', 'Sentry', msg(err), 'The DSN should look like https://<key>@<org>.ingest.sentry.io/<project>');
  }
}

// ---- Verdict ---------------------------------------------------------------
console.log(`\n${tally.pass} passed · ${tally.warn} warnings · ${tally.fail} failed · ${tally.skip} optional skipped`);
if (tally.fail) console.log(c('31', 'Fix the FAIL lines above, then run `npm run doctor` again.\n'));
else console.log(c('32', 'Good to go: `npm start` and open http://localhost:' + config.port + '\n'));
process.exit(tally.fail ? 1 : 0);
