# LinguaLive — AI Real-Time Meeting Translator

Real-time speech translation for Google Meet, Microsoft Teams, Zoom, or any
meeting platform. LinguaLive transcribes speech in the browser and translates
it live using the **Claude API**, then generates an AI meeting summary when the
session ends.

Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui.

---

## How it works

1. **Transcription** runs entirely in the browser via the Web Speech API
   (`webkitSpeechRecognition`) — no audio ever leaves the user's machine.
2. **Translation** is sent as text to `/api/translate`, a Next.js Route Handler
   that calls Claude (`claude-haiku-4-5` by default for low latency).
3. **Summary** — at the end of a session, the full transcript is sent to Claude
   (`claude-sonnet-4-6` by default) and returned as structured JSON.

```
Browser mic / system audio
        │  Web Speech API (client-side transcription)
        ▼
  app/page.tsx ──fetch──▶ app/api/translate/route.ts ──▶ Claude API
        ▲                                                          │
        └──────────────── translated text / summary ◀──────────────┘
```

---

## Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Add your Anthropic API key
cp .env.example .env
#   then edit .env and set ANTHROPIC_API_KEY

# 3. Run the dev server
npm run dev
```

Open <http://localhost:3000>. Use **Chrome or Edge** — the Web Speech API is not
available in Firefox or Safari.

---

## Deploying to Vercel

This project is configured for zero-config deployment on Vercel.

1. Push the project to a Git repository (GitHub/GitLab/Bitbucket).
   **`package.json` and the `app/` folder must be at the repository root.**
2. Import it into Vercel — the Next.js framework is auto-detected.
3. In **Project Settings → Environment Variables**, add:

   | Key                 | Value                          |
   | ------------------- | ------------------------------ |
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com |

4. Deploy.

Optional environment variables:

| Key                 | Default              | Purpose                          |
| ------------------- | -------------------- | -------------------------------- |
| `TRANSLATION_MODEL` | `claude-haiku-4-5`   | Model used for live translation  |
| `SUMMARY_MODEL`     | `claude-sonnet-4-6`  | Model used for the AI summary    |

> The translation route runs on the Node.js runtime with a 30s function
> timeout (set via the `runtime` and `maxDuration` exports in the route).

### Simplest deploy (no Git needed)

From inside the project folder (the one containing `package.json`):

```bash
npx vercel
```

The Vercel CLI deploys the current folder directly, so there is no "root
directory" to misconfigure.

### Troubleshooting: "Couldn't find any 'pages' or 'app' directory"

This means the build ran in a folder that is **not** the project root. The
project root is the folder that contains `package.json` **and** the `app/`
folder side by side.

- **Local build:** `cd` into that folder before running `npm run build`.
  Run `dir` (Windows) / `ls` — you must see `package.json` and `app` together.
- **Vercel:** open **Project → Settings → Build and Deployment → Root
  Directory** and set it to the folder that contains `package.json`
  (leave it blank if `package.json` is already at the repo root).

---

## API

### `POST /api/translate`

**Translate text**

```jsonc
// Request
{ "text": "Good morning everyone", "from": "en", "to": "fil" }

// Response
{ "success": true, "translated": "Magandang umaga sa lahat", "original": "...", "from": "en", "to": "fil" }
```

**Summarize a meeting**

```jsonc
// Request
{ "action": "summarize", "transcript": "...", "sourceLang": "en", "targetLang": "fil" }

// Response
{
  "success": true,
  "summary": {
    "summary": "...",
    "keyPoints": ["..."],
    "actionItems": ["..."],
    "sentiment": "positive",
    "topics": ["..."]
  }
}
```

---

## Project structure

```
app/
  api/translate/route.ts   ← Claude-powered translation + summary API
  layout.tsx               ← root layout + metadata
  page.tsx                 ← the entire single-page app (onboarding + session)
  globals.css              ← Tailwind v4 theme + custom animations
components/ui/             ← shadcn/ui component library
hooks/                     ← use-toast, use-mobile
lib/utils.ts               ← cn() class-name helper
```

This uses the standard root-level Next.js App Router layout — `app/` sits at the
project root next to `package.json`.

The app is a single client component (`page.tsx`) with two views: an onboarding
screen (pick languages, audio source, speaker count) and a live session screen
(visualizer, real-time transcript, split/translated tabs, summary modal).

---

## Notes & limitations

- Speech recognition requires a Chromium-based browser (Chrome/Edge).
- "Computer Audio" capture uses the Screen Capture API — the user picks a tab or
  window to capture system sound from.
- No database is used; transcripts live in memory and can be copied/downloaded.
- Each translation is a separate Claude request. The system prompt carries a
  `cache_control` breakpoint so prompt caching engages automatically once the
  prompt is large enough to cache.
