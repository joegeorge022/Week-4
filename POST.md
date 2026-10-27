---
title: "The ghost that only knows what you tell it"
published: false
tags: devchallenge, ai, opensource, gemma
cover_image: docs/altar.png
---

*This is my submission for the DEV "Ghost in the Machine" challenge.*

## The idea, and the thing that scared me about it

Every Día de los Muertos there is an ofrenda somewhere with a photo, some marigolds, and a plate of what that person loved to eat. The stories that go with it, like who made the tamales and what song came on while the masa rested, usually live in one aunt's memory.

I wanted to build a small tool that keeps those stories and lets a local AI echo them back. Then I thought about what could go wrong. A ghost that *sounds* like your grandmother and quietly invents a husband, a hometown, or a favorite color is much worse than no ghost. It overwrites the real memory with a plausible fake one.

So **Ofrenda** has one rule: the ghost may only repeat what you wrote down. If it doesn't know, it says so and asks you to teach it.

## Why open weights were the right tool, and not just a convenient one

- **The data is a family's private grief.** Stories, photos and names never leave the laptop. The server binds to `127.0.0.1`, and the UI has no CDN, web fonts or analytics. After the one-time model download I turned Wi-Fi off and it kept working.
- **I could change the model's behavior, not just its prompt.** The ghost runs `gemma3:4b` through Ollama, driven by a [Mastra](https://mastra.ai) agent. When I wanted to see how much the model mattered, I changed one environment variable and re-ran the same eval on `gemma3:1b`. With a closed API I'd have had one model, one price, and no way to see what's happening inside the generation. Here I could stop it midway.
- **It can't disappear.** There is no service to shut down. The memories are one JSON file I can read, export or delete.

I'll be honest about the cost: replies take **10 to 12 seconds** on my 8 GB MacBook with other apps open (about 5 to 6 seconds in a quiet eval run). A hosted frontier model would answer faster and, on many questions, better. For this project that trade is the point, but it is a trade.

## The part that surprised me: prompting wasn't enough

My first version had careful rules in the system prompt: "use only the memories, never guess". It mostly worked. Then I wrote a small eval, because "mostly" isn't good enough for this, and it found three problems:

1. Asked "what was your favorite color?", the model answered with an *unrelated real memory* about marigolds. That's worse than inventing something, because it looks sourced.
2. I added a few-shot example to fix the tone. A Spanish question then came back answered with a detail from my *example*, a different person's memory, in someone's grandmother's voice.
3. When I told it to say "nobody has told me that yet", it started appending that line even after correct answers. It was copying the phrase from the prompt.

I stopped trying to persuade the model and enforced the rule in code. The model must answer in two parts:

```
EVIDENCE: "words copied from ONE memory"   (or NONE)
REPLY: ...
```

Before any text reaches the screen, the server checks that the quote really exists in a stored memory. Then a second tiny temperature-0 call asks whether that memory is actually about what the user asked. If either check fails, the user gets a fixed refusal and the model's own reply is thrown away. A weaker model *fails closed*.

The relevance check's wording mattered more than I expected. "Does this memory directly answer the question?" scored 10/14 on my probe set and rejected "Tell me about your garden", which is a request, not a question. "Is this memory about what the user is asking for?" scored 14/14.

## What it does now

I ran the same 9 cases (5 answerable, 4 unanswerable, one in Spanish) against the real local model:

| model | recall | honesty | avg reply |
|---|---|---|---|
| `gemma3:4b` | 15/15 | 12/12 | ~5.7 s |
| `gemma3:1b` | 6/15 | 12/12 | ~2.2 s |

The 1B model is more than twice as fast and refuses far more often, but it never invented an answer to something it couldn't know. That's what "fails closed" looks like in practice.

**What this does and doesn't show.** I tuned the prompts against these same cases, so it's a regression harness, not a benchmark. Nine cases is small, and the scoring is regexes. The gate checks the *quote*, not every word of the reply: on the 1B model, one accepted answer added "a warm smile and a good conversation" that no memory contains. Letters and calaveritas are creative output and aren't gated. Even after I tightened their prompt, the 4B model still adds small flourishes ("you loved them so much"), and its Spanish is imperfect. It left "marigolds" in English and coined the word "marigolias".

## How it's built

- **Gemma 3 via Ollama** generates everything; **Mastra** is the agent layer (streaming, model config, swapping models).
- **BM25 retrieval, no vector DB.** A family has dozens of stories, so almost all of them fit in the context window. The ghost gets everything that fits, ordered by relevance, which also lets a Spanish question reach a story written in English.
- **Storage** is one atomic JSON file by default, or MongoDB Atlas if `MONGODB_URI` is set.
- **Safety defaults:** loopback-only, Host/Origin checks against DNS-rebinding, optional signed-cookie PIN with rate limiting, typed confirmation before erasing anything.
- **24 unit tests** plus the eval above. A bug the tests caught early was my context-budget function ignoring newlines, which would have silently truncated a long story.

Optional integrations, all off by default, are in the repo: ElevenLabs (narration, plus recording an oral-history story), Sentry agent tracing (timings only, never the text of a memory), MongoDB Atlas, and a Render blueprint. **I have not run the ElevenLabs path with a real key, deployed the Render blueprint, or confirmed that Sentry events arrive**, so I'm not claiming them as working. I left out other partner technologies that wouldn't have made the project better.

## What I'd do next

A local Whisper model for transcription, so recording a grandparent's stories is fully offline. A per-sentence grounding check on replies. And a bigger Gemma on a machine with more than 8 GB, to see how much of the remaining awkwardness is just model size.

## Try it

```bash
ollama pull gemma3:4b
git clone <!-- TODO: repo URL --> && cd ofrenda && npm install && npm start
```

<!-- TODO before publishing:
  - repo URL, demo video or GIF
  - DevRelay session link (optional, helps judges see the process)
  - confirm the eval numbers on your own machine: `npm run eval -- --repeat 3`
  - delete this comment block -->

*Open weights. Open source. Your stories stay yours.* 🌼
