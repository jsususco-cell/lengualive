import { NextRequest, NextResponse } from 'next/server';

// ─── Bot-worker proxy ───────────────────────────────────────────
// The dashboard never calls the bot-worker from the browser — that
// would leak the master WORKER_API_TOKEN. This route is the
// server-side go-between: it holds the secret and the worker URL, and
// hands the browser back only a session-scoped stream token + the
// WebSocket URL it should connect to.
//
// Configure two env vars (Vercel project settings):
//   BOT_WORKER_URL    — e.g. https://lengualive-bot-worker.fly.dev
//   WORKER_API_TOKEN  — the shared secret, matching the worker's

export const runtime = 'nodejs';

function workerConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.BOT_WORKER_URL;
  const token = process.env.WORKER_API_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

// http(s):// → ws(s):// for the browser's WebSocket URL.
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/i, 'ws');
}

// ─── Start a meeting bot ────────────────────────────────────────
export async function POST(request: NextRequest) {
  const config = workerConfig();
  if (!config) {
    return NextResponse.json(
      { success: false, error: 'The meeting bot is not configured yet (set BOT_WORKER_URL and WORKER_API_TOKEN).' },
      { status: 503 },
    );
  }

  let body: { meetingUrl?: string; sourceLang?: string; targetLang?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { meetingUrl, sourceLang, targetLang } = body;
  if (!meetingUrl || !sourceLang || !targetLang) {
    return NextResponse.json(
      { success: false, error: 'meetingUrl, sourceLang and targetLang are required' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${config.baseUrl}/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ meetingUrl, sourceLang, targetLang }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: (data as { error?: string }).error || `Bot worker returned ${res.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: data.sessionId,
      streamToken: data.streamToken,
      state: data.state,
      // The browser opens this directly, authed with the stream token.
      wsUrl: `${toWsUrl(config.baseUrl)}/sessions/${data.sessionId}/stream`,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Could not reach the meeting bot service' },
      { status: 502 },
    );
  }
}

// ─── Stop a meeting bot (the bot leaves the call) ───────────────
export async function DELETE(request: NextRequest) {
  const config = workerConfig();
  if (!config) {
    return NextResponse.json({ success: false, error: 'The meeting bot is not configured' }, { status: 503 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, error: 'Missing session id' }, { status: 400 });
  }

  try {
    const res = await fetch(`${config.baseUrl}/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}` },
    });
    return NextResponse.json({ success: res.ok });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Could not reach the meeting bot service' },
      { status: 502 },
    );
  }
}
