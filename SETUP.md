# Setup guide

Two parts: **run it on your laptop** (10 minutes, no accounts), then **put it on Render** (optional, costs money).

> **The short version.** The only thing Ofrenda *requires* is the Ollama model on your computer. There is no API key you must have. ElevenLabs, MongoDB Atlas and Sentry are optional extras you can add later by pasting a key into `.env` and running `npm run doctor`.

---

## Part 1: Run it locally

You need **Node 20.12 or newer** (Node 22 recommended) and **Ollama**.

```bash
# 1. the model (one-time download)
brew install ollama              # or download from https://ollama.com/download
ollama serve                     # leave running; the Ollama desktop app does this for you
ollama pull gemma3:4b            # ~3.3 GB. Use gemma3:1b if your computer is slow (see below)

# 2. the app
npm install
cp .env.example .env             # your settings; .env is gitignored, so it never gets committed
npm run doctor                   # checks everything and tells you what to fix
npm start                        # open http://localhost:3000
```

`npm run doctor` prints a `PASS / WARN / FAIL / SKIP` line for each piece and what to do about any failure. Run it every time you change `.env`. Add `-- --deep` to also ask the model one tiny question:

```bash
npm run doctor -- --deep
```

### Which model?

| Model | Needs | Speed | Honesty (my eval) |
|---|---|---|---|
| `gemma3:4b` (default) | ~4 GB free RAM | ~6 s per reply in my eval; on a busy 8 GB laptop I also saw 40 to 70 s when the model had to reload | recall 15/15, honesty 12/12 |
| `gemma3:1b` | ~1.5 GB | ~2 s per reply | recall 6/15, honesty 12/12: it refuses a lot, but it did not make things up |

Change it with `OFRENDA_MODEL=` in `.env`, then run `ollama pull <that model>`.

**If the first answer takes a minute:** that is Ollama loading the model into memory. The app asks Ollama to pre-load it when the server starts, but Ollama drops an idle model after 5 minutes by default. To keep it loaded longer, start Ollama with `OLLAMA_KEEP_ALIVE=30m`. If replies stay slow, close other heavy apps or switch to `gemma3:1b`.

---

## Part 2: The keys (all optional)

Open `.env` and fill in only what you want. Leave a line blank to skip it. After each one, run `npm run doctor`.

| Variable | What you get | Where to get it | Cost |
|---|---|---|---|
| `ELEVENLABS_API_KEY` | A real voice reads replies aloud, and a 🎙 button turns a recorded spoken story into a memory | [elevenlabs.io](https://elevenlabs.io) → sign in → profile / **Developers** → **API Keys** → *Create key*. Enable **Text to Speech** and **Speech to Text** on the key. | Free tier has monthly credits |
| `MONGODB_URI` | Your altar is stored in MongoDB Atlas instead of `data/altar.json` | [cloud.mongodb.com](https://cloud.mongodb.com) → create a free **M0** cluster → **Database Access**: add a user with a password → **Network Access**: add your IP → **Connect → Drivers** → copy the `mongodb+srv://…` string and put the real password in place of `<password>` | M0 is free |
| `SENTRY_DSN` | Speed and token traces of the ghost, in Sentry's AI view. Only timings and counts are sent, never stories. | [sentry.io](https://sentry.io) → create a project, platform **Node.js** → **Settings → Client Keys (DSN)** | Free tier available |

Notes:

- **ElevenLabs is the only thing that sends your text off your computer**, and only after you add a key. The header shows a "Cloud voice" badge when it is on.
- **MongoDB:** if the password has characters like `@` or `/`, URL-encode them (`@` → `%40`). If Atlas can't be reached the app falls back to the local file and says so in its startup log.
- `ELEVENLABS_VOICE_ID` is optional; the default voice works.
- Never paste a key into a chat, a screenshot or a commit. `.env` is already in `.gitignore`.

What I could and could not check on my side: the doctor's ElevenLabs, MongoDB and Sentry checks hit the real services and I confirmed that bad keys are rejected with a clear message. I have **not** run the app with a real key for any of them, so run the doctor yourself and tell me if one misbehaves.

---

## Part 3: Deploy to Render (optional)

Be clear-eyed about this first:

- **Ofrenda's selling point is that it runs on your laptop.** Hosting it is only worth it so family can open one shared altar from their phones.
- **It costs money.** A private service and a persistent disk are not on Render's free tier. I have not checked current prices; look at [render.com/pricing](https://render.com/pricing) before you click Apply. The Blueprint asks for a `starter` web service (1 GB disk) and a `standard` private service (10 GB disk) for Ollama.
- **CPU inference is slow.** Render has no GPU, so the Blueprint uses `gemma3:1b`. Expect short, careful answers that refuse often. For `gemma3:4b` quality, host the model on a GPU machine and set `OLLAMA_BASE_URL` to it (see the end of this section).
- I have **not deployed this**; `render.yaml` is syntax-checked but untested against Render. If something differs, the troubleshooting table below is the first stop.

### Steps

1. **Push the code to GitHub.** Create an empty repo on github.com (no README), then:

   ```bash
   git add -A && git commit -m "Ofrenda"
   git remote add origin https://github.com/<you>/ofrenda.git
   git push -u origin main
   ```

   `.env` is gitignored, so your keys are not uploaded.

2. **Create the Blueprint.** In the [Render dashboard](https://dashboard.render.com): **New → Blueprint** → connect GitHub → pick the repo and branch. Render reads `render.yaml` and shows two services: `ofrenda` (the web app) and `ofrenda-ollama` (the private model server).

3. **Fill the prompts.** Render asks for the three `sync: false` values: `MONGODB_URI`, `SENTRY_DSN`, `ELEVENLABS_API_KEY`. Paste the ones you have; leave the rest blank. You can add or change them later.

4. **Click Apply.** The first deploy is slow: the Ollama service builds, then downloads the model (about 1 GB for `gemma3:1b`) into its disk. Watch the `ofrenda-ollama` logs for `Ensuring model gemma3:1b is available...`. Until it finishes, the app's header chip shows the model host as unreachable or missing the model. Later deploys reuse the disk and are fast.

5. **Get your PIN.** Render generated `OFRENDA_PIN` for you. Open the `ofrenda` service → **Environment** → reveal `OFRENDA_PIN`. Share it only with family. (You can replace it with a word of your own.)

6. **Open it.** Use the `https://ofrenda-….onrender.com` URL at the top of the service page, enter the PIN, and light a candle. The header chip says **Remote · gemma3:1b** and the welcome copy changes to say the altar lives on your server. That is intentional and honest.

7. **Add keys later.** `ofrenda` → **Environment** → add the variable → save. Render redeploys. Then check `https://<your-url>/api/health`.

### Things to know once it is live

- The altar is one JSON file on the `ofrenda` disk, so run **one instance only** (do not scale it up). Switch on `MONGODB_URI` if you want it off the disk.
- If you use Atlas, add Render's outbound IPs to Atlas **Network Access** (find them in the service's **Connect → Outbound** tab), or temporarily allow `0.0.0.0/0`.
- Use **Your data → Download everything** now and then. A disk is a backup of nothing.
- The PIN login is rate-limited and cookie-based, but it is a shared secret, not user accounts. Don't put anything on it you wouldn't trust the whole family with.

### Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| Header chip says **Model host unreachable** | The Ollama service is still starting, or crashed | `ofrenda-ollama` → Logs. Wait for it to come up; check the disk is attached. |
| Chip says **Model … not on host yet** | The model is still downloading, or `OFRENDA_MODEL` differs between the two services | Watch the `ofrenda-ollama` logs; make `OFRENDA_MODEL` identical on both. |
| Ollama service out of memory | Plan too small for the model | `gemma3:1b` on `standard` is the intended pair. Bigger models need a bigger plan. |
| App can't find `ofrenda-ollama` | Services in different regions | Both are set to `oregon` in `render.yaml`; keep them equal. |
| Locked screen and the PIN is rejected | Copied with a trailing space, or too many tries | Re-copy it. The login limiter allows 8 tries a minute. |
| Data gone after a redeploy | Disk not attached or `OFRENDA_DATA_DIR` wrong | It must be `/var/data`, matching the disk mount path. |
| ElevenLabs button missing | No `ELEVENLABS_API_KEY` set | Add it, redeploy. |

### Alternative: model on a GPU host

For `gemma3:4b` or larger, run Ollama on a GPU machine (a cloud GPU droplet, for example) using `deploy/ollama.Dockerfile`, then in `render.yaml` delete the `pserv` service and the `OLLAMA_HOSTPORT` entry, and set on the web service:

```yaml
- key: OLLAMA_BASE_URL
  value: https://your-gpu-host:11434
- key: OFRENDA_MODEL
  value: gemma3:4b
```

Put the GPU host behind a firewall or a reverse proxy with auth: **Ollama has no login of its own.**

---

## For the DEV submission

`POST.md` is the post draft. Before you publish it, replace its three `TODO` placeholders (repo URL, demo video, DevRelay link), and retake the screenshots in `docs/` if you change the UI.
