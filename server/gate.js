/**
 * Citation gate: the code-level guarantee behind "it never invents a memory".
 *
 * The model is told to answer in two parts:
 *
 *     EVIDENCE: "words copied from ONE memory"   (or NONE)
 *     REPLY: ...
 *
 * We read the stream as it arrives and decide BEFORE any reply text reaches the
 * user:
 *   - EVIDENCE is NONE                     -> deterministic refusal (model's reply discarded)
 *   - EVIDENCE isn't found in any memory   -> deterministic refusal
 *   - EVIDENCE is supported by a memory    -> stream the REPLY through
 *   - the model ignored the format         -> deterministic refusal (fail closed)
 *
 * Stage 2 (relevance): a real quote can still be the wrong memory ("favorite
 * color?" -> the marigold story). So once the quote is verified, the caller runs
 * a tiny independent YES/NO check, "does this memory directly answer the
 * question?", and reports back through resolve(). Nothing streams until it does.
 *
 * This makes the worst failure (displaying an invented fact) impossible and the
 * second-worst (dodging with an unrelated memory) rare, but it is not a proof of
 * correctness: a small model can still be wrong in subtle ways.
 */

export const REFUSAL = {
  en: "Nobody has told me that yet. Would you like to share it so it can be kept?",
  es: 'Nadie me ha contado eso todavía. ¿Quieres compartirlo para que quede guardado?',
};

const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** The source text that (nearly) all of the quoted words come from, or null. */
export function findSource(evidence, sources, threshold = 0.8) {
  const words = norm(evidence);
  if (words.length < 2 && !(words.length === 1 && words[0].length >= 4)) return null;
  let best = null;
  let bestRatio = 0;
  for (const src of sources) {
    const have = new Set(norm(src));
    const ratio = words.filter((w) => have.has(w)).length / words.length;
    if (ratio >= threshold && ratio > bestRatio) [best, bestRatio] = [src, ratio];
  }
  return best;
}

export const isSupported = (evidence, sources, threshold) => findSource(evidence, sources, threshold) !== null;

/** Extract the quoted text (or bare text) after "EVIDENCE:". Returns null for NONE. */
export function parseEvidence(block) {
  const body = block.replace(/^[\s\S]*?EVIDENCE:\s*/i, '').trim();
  if (/^["“”']?\s*none\b/i.test(body) || !body) return null;
  const quoted = body.match(/["“]([^"”]+)["”]/);
  return (quoted ? quoted[1] : body).trim();
}

export function createGate({ sources, lang = 'en' }) {
  let buf = '';
  let state = 'reading'; // reading | verify | pass | refuse
  let evidence = null;
  let source = null;
  let held = '';

  const refuse = () => {
    state = 'refuse';
    return REFUSAL[lang] ?? REFUSAL.en;
  };

  return {
    get state() {
      return state;
    },
    get evidence() {
      return evidence;
    },
    /** The full memory the quote came from (what the relevance check should read). */
    get source() {
      return source;
    },
    /**
     * Feed a model chunk; returns the text (possibly '') that may be shown now.
     * When state becomes 'verify' the caller must run the relevance check and call resolve().
     */
    feed(chunk) {
      if (state === 'pass') return chunk;
      if (state === 'refuse') return '';
      if (state === 'verify') {
        held += chunk;
        return '';
      }
      buf += chunk;
      const m = buf.match(/\bREPLY:\s*/i);
      if (!m) return '';
      evidence = parseEvidence(buf.slice(0, m.index));
      source = evidence ? findSource(evidence, sources) : null;
      if (!source) return refuse();
      held = buf.slice(m.index + m[0].length).trimStart();
      state = 'verify';
      return '';
    },
    /** Result of the relevance check. Returns the held reply text, or the refusal. */
    resolve(relevant) {
      if (state !== 'verify') return '';
      if (!relevant) return refuse();
      state = 'pass';
      const out = held.trimStart(); // models often emit the space after "REPLY:" as its own later token
      held = '';
      return out;
    },
    /** Call when the stream ends. Fail closed if the model never produced a REPLY. */
    end() {
      return state === 'reading' || state === 'verify' ? refuse() : '';
    },
  };
}
