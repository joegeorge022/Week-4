# 🕯 Ofrenda: a ghost that only knows what you tell it

A local-first memory altar for Día de los Muertos. You tell it stories about someone you miss. A small **open-weight Gemma model running on your own computer** can then echo those stories back. It can also write a letter or a *calaverita* for the altar.

The ghost is deliberately honest:

- It may only repeat what is in the memories you wrote. Retrieval decides which memories the model sees, and the prompt forbids it from guessing.
- If it doesn't know, it says so and invites you to teach it the story.
- It always says it is an *echo made of written memories*, not the person.

Built for the DEV "Ghost in the Machine" challenge.

## Run it (offline-capable)

```bash
# 1. an open-weight model, locally (Ollama >= 0.6 for Gemma 3)
brew install ollama            # or https://ollama.com/download
ollama serve &
ollama pull gemma3:4b          # ~3.3 GB; use gemma3:1b on small machines

# 2. the app
npm install
npm start                      # http://127.0.0.1:3000
```

After the one-time model download, turn Wi-Fi off. Everything keeps working: the UI has no CDN, no web fonts and no analytics, and the server binds to loopback only.

```bash
npm test                       # unit tests for retrieval, storage, prompts, security
```

## How it works

```
 browser ──SSE──▶ server/index.js ──▶ retrieve.js (BM25 over *your* memories)
                       │                       │ top-k memories
                       ▼                       ▼
                  store.js              Mastra Agent ──OpenAI-compat──▶ Ollama ──▶ Gemma
            (JSON file | MongoDB Atlas)          │
                                          telemetry.js (local stats | Sentry spans)
```

| Piece | What it does | Open? |
|---|---|---|
| **Gemma 3** via Ollama | Writes every reply, letter and poem | open weights, runs locally |
| **Mastra** | Agent framework wrapping the model (streaming, usage, model config) | open source |
| `retrieve.js` | Dependency-free BM25, accent-insensitive, English + Spanish stopwords | mine |
| `store.js` | One atomic JSON file by default; MongoDB Atlas if `MONGODB_URI` is set | n/a |

Swapping the model is one env var: `OFRENDA_MODEL=llama3.2 npm start`. Any Ollama model works, and a GPU Droplet or other host works via `OLLAMA_BASE_URL`.

### Why plain BM25 and not a vector database?

One family has dozens to a few hundred stories. BM25 is instant and deterministic, and it needs no embedding model. That matters on a laptop with no internet, and it's easy to unit-test. `retrieve.test` covers English, Spanish, accents and vague queries.

## Optional partner integrations (all off by default)

Copy `.env.example` to `.env` and fill in only what you want. Nothing is required.

| Env var | Partner | What it adds | What leaves your machine |
|---|---|---|---|
| `MONGODB_URI` | **MongoDB Atlas** | Altars stored in Atlas (falls back to the local file if unreachable) | The altar data, to your own cluster |
| `SENTRY_DSN` | **Sentry** agent tracing | `gen_ai.invoke_agent` spans with model, latency, token counts and tokens/sec | Timings and counts only. Never prompts, memories or replies (`sendDefaultPii: false` plus a `beforeSend` scrub) |
| `ELEVENLABS_API_KEY` | **ElevenLabs** | 🔊 narration of replies and letters; 🎙 *record a story* (Scribe transcription, editable before saving) | The text or audio you choose to speak or record. The UI shows a ☁ badge whenever this is on |
| *(deploy)* `render.yaml` | **Render** | Blueprint for the web app plus a private Ollama service running Gemma | See below |

> **Status:** the Render Blueprint and `Dockerfile`s are written but I haven't deployed them yet, so treat them as a starting point. The MongoDB, Sentry and ElevenLabs paths run the same code as the local path, but they were written without live keys and haven't been exercised against the real services.

### Deploying (optional)

The point of Ofrenda is that you don't have to. If you want a shared altar for the whole family:

- Set `OFRENDA_PIN`. The server refuses to serve the API without it unless it is bound to loopback.
- On Render, `render.yaml` runs the app as a web service and Ollama as a **private** service, so the model host is not reachable from the internet. CPU inference is slow, so use `gemma3:1b`, or point `OLLAMA_BASE_URL` at a GPU host.

## Privacy & safety choices

- Binds to `127.0.0.1` by default. Host-header and Origin checks defend against DNS-rebinding and cross-site requests to your local server.
- Photos are downscaled in the browser and stored only in your altar.
- *Download everything* exports a plain JSON file. *Erase everything* needs a typed confirmation.
- The UI renders stories via `textContent`, so memories can't inject HTML.
- The system prompt treats memories as quoted data, never as instructions, and tells the model to point people toward trusted humans or a crisis line if someone seems to be in distress.
- Small models can still slip. The honesty guard lowers the risk but does not make it zero.

## Limitations (honest list)

- 4B-parameter models sometimes paraphrase loosely or answer too confidently. The "from N memories" label under each reply helps you check.
- BM25 matches words, not meaning, so it can miss a memory that doesn't share words with the question.
- Transcription currently needs the ElevenLabs API. A local Whisper option would keep voice fully offline.
- Memories are not encrypted at rest. Use full-disk encryption (FileVault) if the machine is shared.

## Not included

I looked at the other partner categories (Temporal, Auth0, Tiger Data, etc.) and left them out. Bolting on a technology that doesn't make the project better would be the opposite of the point.
