import { Agent } from '@mastra/core/agent';
import { config } from './config.js';
import { ghostInstructions, remembranceInstructions, cleanHistory, detectLang } from './prompts.js';
import { selectContext, profileFacts } from './retrieve.js';
import { record, tracedAgentRun, captureError } from './telemetry.js';
import { createGate } from './gate.js';

/**
 * The ghost is a Mastra agent whose brain is an open-weight Gemma model served by
 * Ollama through its OpenAI-compatible endpoint. Swap OFRENDA_MODEL (or point
 * OLLAMA_BASE_URL at a GPU Droplet / Render private service) and nothing else changes.
 *
 * Instructions are built per request: retrieval decides which memories the model
 * may see, so the model can only echo what the family actually wrote.
 */
export function buildAgent(instructions) {
  return new Agent({
    id: 'ofrenda-ghost',
    name: 'ofrenda-ghost',
    instructions,
    model: {
      id: `ollama/${config.model}`,
      url: `${config.ollamaBase}/v1`,
      apiKey: 'ollama', // Ollama ignores it, the SDK requires one
    },
  });
}

const approxTokens = (chars) => Math.max(1, Math.round(chars / 4));

/**
 * Stream a reply grounded in retrieved memories.
 * Yields {type:'sources'|'token'|'done'|'error', ...}
 */
export async function* chatWithGhost({ person, memories, message, history, mode, signal }) {
  const docs = [...profileFacts(person), ...memories];
  const grounding = selectContext(message, docs);
  yield {
    type: 'sources',
    ids: grounding.filter((g) => g.source !== 'profile').map((g) => g.id),
    facts: grounding.filter((g) => g.source === 'profile').length,
  };

  const instructions = ghostInstructions({ person, memories: grounding, mode, lang: detectLang(message) });
  const messages = [...cleanHistory(history), { role: 'user', content: String(message).slice(0, 2000) }];

  const lang = detectLang(message);
  const gate = createGate({ sources: grounding.map((g) => g.text), lang });
  yield* run('ghost.reply', { agent: buildAgent(instructions), instructions, messages, signal, temperature: 0.3, grounded: grounding.length, gate, question: message });
}

export async function* writeRemembrance({ person, memories, style, lang, signal }) {
  const docs = [...profileFacts(person), ...memories];
  const instructions = remembranceInstructions({ person, memories: docs, style, lang });
  const messages = [{ role: 'user', content: lang === 'es' ? 'Escríbelo ahora.' : 'Write it now.' }];
  yield* run('ghost.remembrance', { agent: buildAgent(instructions), instructions, messages, signal, temperature: 0.8, grounded: docs.length });
}

async function* run(name, { agent, instructions, messages, signal, temperature, grounded, gate, question }) {
  const started = performance.now();
  let firstTokenMs = 0;
  let out = '';
  let rawStart = 0; // model's own first/last chunk times, so speed ignores gate + verification pauses
  let rawEnd = 0;
  let verifyMs = 0; // time spent in the relevance check (consumer paused)
  let modelChars = 0; // what the model actually generated (the gate may replace what the user sees)
  const inputChars = instructions.length + messages.reduce((s, m) => s + m.content.length, 0);

  // Collected via a queue so we can yield from inside the traced callback.
  const queue = [];
  let wake;
  let finished = false;
  const push = (e) => {
    queue.push(e);
    wake?.();
  };

  const job = tracedAgentRun(name, { 'gen_ai.request.model': config.model, 'ofrenda.grounded_memories': grounded }, async (span) => {
    try {
      // When the gate refuses we stop generating: the rest of the model's output is discarded anyway.
      const inner = new AbortController();
      const res = await agent.stream(messages, {
        abortSignal: signal ? AbortSignal.any([signal, inner.signal]) : inner.signal,
        maxRetries: 1,
        modelSettings: { temperature },
      });
      // NOTE: use fullStream, not textStream. textStream silently ends empty when the
      // model call fails; the failure only appears as an 'error' chunk.
      for await (const chunk of res.fullStream) {
        if (chunk.type === 'error') throw toError(chunk.payload?.error);
        if (chunk.type !== 'text-delta') continue;
        const raw = chunk.payload?.text;
        if (!raw) continue;
        modelChars += raw.length;
        rawStart ||= performance.now();
        rawEnd = performance.now();
        let text = gate ? gate.feed(raw) : raw;
        if (gate?.state === 'verify') {
          // Stage 2: independent relevance check. Nothing streams to the user until it passes.
          const t0 = performance.now();
          text = gate.resolve(await memoryAnswers(question, gate.source, inner.signal));
          verifyMs += performance.now() - t0;
        }
        if (!text) continue;
        if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - started);
        out += text;
        push({ type: 'token', text });
        if (gate?.state === 'refuse') {
          inner.abort();
          break;
        }
      }
      let tail = gate?.end();
      if (gate?.state === 'verify') tail = gate.resolve(await memoryAnswers(question, gate.source, inner.signal));
      if (tail) {
        out += tail;
        push({ type: 'token', text: tail });
      }
      if (!out.trim()) throw new Error('The model returned an empty reply.');
      // Ollama's OpenAI-compatible stream reports no token usage, so counts are
      // ~4 chars/token estimates (flagged as such in the UI).
      const inTok = Math.max(1, Math.round(inputChars / 4));
      const outTok = approxTokens(modelChars);
      const totalMs = Math.round(performance.now() - started);
      const genMs = Math.max(250, rawEnd - rawStart - verifyMs); // floor avoids absurd rates on very short outputs
      const stats = {
        model: config.model,
        firstTokenMs,
        totalMs,
        inputTokens: inTok,
        outputTokens: outTok,
        tokensPerSec: +((outTok / genMs) * 1000).toFixed(1),
        estimated: true,
        ...(gate && { gate: gate.state, verifyMs: Math.round(verifyMs) }),
      };
      span.set('gen_ai.usage.input_tokens', inTok);
      span.set('gen_ai.usage.output_tokens', outTok);
      span.set('ofrenda.first_token_ms', firstTokenMs);
      span.set('ofrenda.tokens_per_sec', stats.tokensPerSec);
      record({ ok: true, name, ...stats });
      push({ type: 'done', stats });
    } catch (err) {
      if (signal?.aborted) {
        push({ type: 'done', stats: { aborted: true } });
      } else {
        captureError(err, { name });
        record({ ok: false, name });
        push({ type: 'error', message: friendlyError(err) });
      }
    } finally {
      finished = true;
      wake?.();
    }
  });

  while (!finished || queue.length) {
    if (!queue.length) await new Promise((r) => (wake = r));
    wake = undefined;
    while (queue.length) yield queue.shift();
  }
  await job;
}

/**
 * Relevance check for the citation gate: a short, temperature-0 YES/NO call to the same
 * local model. ~1s on a laptop. Fails closed: any error means "not relevant".
 *
 * Wording matters (measured, 14 hand-written cases, gemma3:4b): "does this memory directly
 * answer the question?" scored 10/14 and wrongly rejected requests such as "Tell me about
 * your garden"; "is this memory about what the user is asking for?" scored 14/14.
 */
export async function memoryAnswers(question, memory, signal) {
  try {
    const checker = buildAgent('You are a strict checker. Reply with exactly one word: YES or NO.');
    const res = await checker.generate(
      [{ role: 'user', content: `User message: ${String(question).slice(0, 500)}\nMemory: ${memory}\n\nIs this memory about what the user is asking for, so that it can be used to reply? Reply with exactly one word: YES or NO.` }],
      { abortSignal: signal, maxRetries: 1, modelSettings: { temperature: 0, maxOutputTokens: 3 } },
    );
    return /^\W*yes/i.test(String(res.text || ''));
  } catch {
    return false;
  }
}

function toError(e) {
  if (e instanceof Error) return e;
  const err = new Error(e?.message || String(e));
  err.cause = e?.cause;
  return err;
}

export function friendlyError(err) {
  const msg = String(err?.message || err);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|Cannot connect/i.test(msg) || /ECONNREFUSED/.test(String(err?.cause))) {
    return `I can't reach the model at ${config.ollamaBase}. Is Ollama running? (try: ollama serve)`;
  }
  if (/not found|404/i.test(msg)) {
    return `The model "${config.model}" isn't installed. Run: ollama pull ${config.model}`;
  }
  return `The spirits are quiet right now: ${msg.slice(0, 200)}`;
}

/** Is Ollama up, and is our model pulled? Used by the UI's status badge. */
/**
 * Ask Ollama to load the model into memory now (an empty /api/generate loads without generating),
 * so the first real question isn't spent waiting on a cold start. Best effort; never throws.
 */
export async function warmModel() {
  try {
    await fetch(`${config.ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, keep_alive: '30m' }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    /* Ollama may be starting or the model missing; the first real request will report it clearly */
  }
}

export async function modelStatus() {
  try {
    const r = await fetch(`${config.ollamaBase}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { models = [] } = await r.json();
    const names = models.map((m) => m.name);
    const base = config.model.includes(':') ? config.model : `${config.model}:latest`;
    return { reachable: true, installed: names.includes(base) || names.includes(config.model), available: names };
  } catch (err) {
    return { reachable: false, installed: false, available: [], error: err.message };
  }
}
