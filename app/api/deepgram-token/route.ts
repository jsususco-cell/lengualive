import { NextResponse } from 'next/server';

// The Deepgram master key must never reach the browser. This route exchanges
// it for a short-lived (5 min) token the browser can safely use to open the
// Deepgram streaming WebSocket directly.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPGRAM_API_KEY is not set' },
      { status: 500 },
    );
  }

  try {
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 300 }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Deepgram grant failed:', res.status, detail);
      return NextResponse.json(
        { error: 'Could not obtain a Deepgram token' },
        { status: 502 },
      );
    }

    // { access_token, expires_in }
    const data = await res.json();
    return NextResponse.json({
      token: data.access_token,
      expiresIn: data.expires_in,
    });
  } catch (err) {
    console.error('Deepgram token error:', err);
    return NextResponse.json(
      { error: 'Deepgram token request failed' },
      { status: 502 },
    );
  }
}
