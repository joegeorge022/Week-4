import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load ./.env if it exists (Node >= 20.12, no dependency). Variables that are already set in the
// real environment win, so Render / Docker settings are never overridden by a stray file.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (err) {
  if (err?.code !== 'ENOENT') console.warn(`[ofrenda] could not read .env: ${err.message}`);
}

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT) || 3000,
  host: env.HOST || '127.0.0.1',
  // OLLAMA_HOSTPORT lets Render wire the private Ollama service in via `fromService`.
  ollamaBase: (env.OLLAMA_BASE_URL || (env.OLLAMA_HOSTPORT ? `http://${env.OLLAMA_HOSTPORT}` : 'http://127.0.0.1:11434')).replace(/\/+$/, ''),
  model: env.OFRENDA_MODEL || 'gemma3:4b',
  dataDir: path.resolve(root, env.OFRENDA_DATA_DIR || 'data'),
  pin: env.OFRENDA_PIN || '',
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'ofrenda',
  sentryDsn: env.SENTRY_DSN || '',
  elevenKey: env.ELEVENLABS_API_KEY || '',
  elevenVoice: env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
};

/** True when the model host is this machine, i.e. nothing leaves the laptop. */
export function isLocalModel(base = config.ollamaBase) {
  try {
    const h = new URL(base).hostname;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h);
  } catch {
    return false;
  }
}
