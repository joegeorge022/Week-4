import * as Sentry from '@sentry/node';
import { config } from './config.js';

/**
 * Observability that respects the subject matter:
 *  - A local ring buffer feeds the in-app "how fast is my ghost?" stats. Always on.
 *  - Sentry agent tracing is opt-in via SENTRY_DSN and sends ONLY timing, token
 *    counts and model name. Prompts, memories and replies are never attached.
 */

const buffer = [];
const MAX = 50;
let sentryOn = false;

export function initTelemetry() {
  if (!config.sentryDsn) return false;
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 1.0,
    sendDefaultPii: false,
    // Safety net: strip request bodies and cookies from anything Sentry captures.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
  sentryOn = true;
  return true;
}

export const tracingEnabled = () => sentryOn;

export function record(entry) {
  buffer.push({ at: new Date().toISOString(), ...entry });
  if (buffer.length > MAX) buffer.shift();
}

export function summary() {
  const ok = buffer.filter((b) => b.ok);
  const avg = (key) => (ok.length ? Math.round(ok.reduce((s, b) => s + (b[key] || 0), 0) / ok.length) : 0);
  return {
    runs: buffer.length,
    failures: buffer.length - ok.length,
    avgFirstTokenMs: avg('firstTokenMs'),
    avgTotalMs: avg('totalMs'),
    avgTokensPerSec: ok.length ? +(ok.reduce((s, b) => s + (b.tokensPerSec || 0), 0) / ok.length).toFixed(1) : 0,
    sentry: sentryOn,
    recent: buffer.slice(-10),
  };
}

/**
 * Run `fn(span)` inside a gen_ai span (no-op wrapper when Sentry is off).
 * `span.set(key, value)` is always safe to call.
 */
export async function tracedAgentRun(name, attributes, fn) {
  if (!sentryOn) return fn({ set() {} });
  return Sentry.startSpan(
    {
      name,
      op: 'gen_ai.invoke_agent',
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': 'ofrenda-ghost',
        'gen_ai.system': 'ollama',
        ...attributes,
      },
    },
    (span) => fn({ set: (k, v) => span.setAttribute(k, v) }),
  );
}

export function captureError(err, ctx = {}) {
  if (sentryOn) Sentry.captureException(err, { extra: ctx });
}
