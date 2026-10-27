import { config } from './config.js';

/**
 * Optional ElevenLabs voice. This is the only part of Ofrenda that sends
 * anything to a cloud service, and only when ELEVENLABS_API_KEY is set, so the
 * UI labels it clearly. Without a key the browser's built-in speech is used.
 */

const API = 'https://api.elevenlabs.io/v1';

export const voiceEnabled = () => Boolean(config.elevenKey);

/** Returns a fetch Response whose body is audio/mpeg. */
export async function speak(text) {
  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(config.elevenVoice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: String(text).slice(0, 2500),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS failed (${r.status})`);
  return r;
}

/** Oral history: audio bytes -> text, via ElevenLabs Scribe. */
export async function transcribe(buffer, mime = 'audio/webm') {
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('file', new Blob([buffer], { type: mime }), `story.${mime.includes('mp4') ? 'm4a' : 'webm'}`);
  const r = await fetch(`${API}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs transcription failed (${r.status})`);
  const data = await r.json();
  return String(data.text || '').trim();
}
