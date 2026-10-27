import crypto from 'node:crypto';

/** Constant-time string compare. */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function sessionToken(pin) {
  return crypto.createHmac('sha256', pin).update('ofrenda-session-v1').digest('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthed(req, pin) {
  if (!pin) return true;
  const token = parseCookies(req.headers.cookie).ofrenda;
  return Boolean(token) && safeEqual(token, sessionToken(pin));
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Guards a localhost-bound server against DNS-rebinding and cross-site writes:
 *  - when bound to loopback, the Host header must be a loopback name
 *  - any request carrying an Origin must be same-origin with Host
 */
export function checkRequestOrigin(req, { loopbackOnly }) {
  const host = req.headers.host || '';
  if (loopbackOnly && !LOOPBACK.test(host)) return 'bad host';
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return 'cross-origin';
    } catch {
      return 'bad origin';
    }
  }
  return null;
}

/** Tiny fixed-window limiter, enough to slow down PIN guessing. */
export function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, n: 1 });
      return true;
    }
    rec.n += 1;
    return rec.n <= max;
  };
}
