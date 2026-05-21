# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

**LinguaLive** — an AI real-time meeting translator. A Next.js 16 app that
transcribes speech in the browser (Web Speech API) and translates it live via
the Claude API. Single-page app; no database; no auth.

## Commands

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Start the dev server on http://localhost:3000 |
| `npm run build` | Production build (run before deploying)       |
| `npm run start` | Serve the production build                    |
| `npm run lint`  | Run ESLint                                    |

There is no test suite.

## Environment

`ANTHROPIC_API_KEY` is **required** — set it in `.env` (copy `.env.example`).
Without it, `/api/translate` returns a 500. Optional: `TRANSLATION_MODEL`,
`SUMMARY_MODEL`.

## Architecture

Root-level Next.js App Router layout — `app/` sits at the project root.

- `app/page.tsx` — a thin client wrapper. It loads `components/LinguaLive`
  via `next/dynamic` with `ssr: false`, so the browser-only UI is never
  server-rendered (this keeps `next build` from prerendering browser APIs).
- `components/LinguaLive.tsx` — the **entire** UI, one large client component
  (`'use client'`). Two views driven by the `view` state: `onboarding` and
  `session`. All speech-recognition, audio-visualizer, and transcript logic
  lives here. Browser-only APIs: `webkitSpeechRecognition`, `AudioContext`,
  `getUserMedia`, `getDisplayMedia`.
- `app/api/translate/route.ts` — the only backend. A `POST` handler that
  does two things based on the request body:
  - translation (`{ text, from, to }`)
  - summary (`{ action: 'summarize', transcript, sourceLang, targetLang }`)
  It calls Claude via `@anthropic-ai/sdk`. Runs on the Node.js runtime.
- `components/ui/` — shadcn/ui components (new-york style).
- `hooks/`, `lib/utils.ts` — small helpers.

The client talks to the server only through `/api/translate`. Translation
results are cached client-side in a `Map` (`translationCacheRef`) to avoid
re-translating repeated phrases.

## Conventions

- TypeScript throughout; `@/*` path alias maps to the project root (`./*`).
- Tailwind CSS v4 (config in `globals.css` via `@theme`, plus `tailwind.config.ts`).
- The brand palette and custom animations (`.fade-up`, `.live-dot`,
  `.sound-bar`, `.bg-mesh`, etc.) are defined in `app/globals.css`.
- `next.config.ts` sets `typescript.ignoreBuildErrors` — the build tolerates
  loose typing. Keep new code clean regardless. Next.js 16 does not run ESLint
  during `next build`; run `npm run lint` separately.

## When changing the AI behavior

- Model selection and prompts live at the top of
  `app/api/translate/route.ts` (`TRANSLATION_MODEL`, `SUMMARY_MODEL`,
  `TRANSLATION_SYSTEM_PROMPT`, `SUMMARY_SYSTEM_PROMPT`).
- The summary uses **structured outputs** (`output_config.format` with
  `SUMMARY_SCHEMA`) — the response is guaranteed valid JSON. If you change the
  summary shape, update both `SUMMARY_SCHEMA` here and the `MeetingSummary`
  interface in `page.tsx`.
- The system prompts carry a `cache_control` breakpoint for prompt caching.

## Deployment

Targets Vercel (zero-config Next.js). The translate function's `maxDuration`
(30s) and `runtime` (`nodejs`) are set via route segment exports in
`app/api/translate/route.ts`. Do not re-add `output: 'standalone'` to
`next.config.ts` — that is for self-hosting and is unnecessary on Vercel.

The project root (`package.json` + `app/`) must be the directory the build
runs in. On Vercel, that means the repo root — or set the project's **Root
Directory** to the folder that contains `package.json`.
