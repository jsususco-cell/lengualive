import { NextRequest, NextResponse } from 'next/server';

// ─── Pre-recorded transcription via Deepgram ────────────────────
// Transcribes an uploaded audio/video file (or a remote URL) into
// diarized speaker segments. This is the "recorded meeting" path —
// the live counterpart is lib/deepgram.ts.
//
// The browser sends either:
//   • the raw file bytes  (Content-Type: the file's mime type), or
//   • JSON { url }        (Content-Type: application/json)
// and gets back { success, segments[], duration }.

export const runtime = 'nodejs';
// Deepgram processes pre-recorded audio fast (well above real-time),
// but a very long recording can still approach this ceiling. For
// hour-long files the proper fix is Deepgram's async callback mode.
export const maxDuration = 60;

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

// nova-3 "multi" = multilingual auto-detect (matches the live lib).
// utterances=true gives us per-speaker-turn segments ready to render.
const DEEPGRAM_PARAMS = new URLSearchParams({
  model: 'nova-3',
  language: 'multi',
  diarize: 'true',
  punctuate: 'true',
  smart_format: 'true',
  utterances: 'true',
});

interface Segment {
  speaker: number;
  text: string;
  start: number;
  end: number;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'DEEPGRAM_API_KEY is not set' },
      { status: 500 },
    );
  }

  const contentType = request.headers.get('content-type') || '';
  const endpoint = `${DEEPGRAM_URL}?${DEEPGRAM_PARAMS.toString()}`;

  let dgRes: Response;
  try {
    if (contentType.includes('application/json')) {
      // ── URL mode: Deepgram fetches the recording itself (no size limit).
      const body = await request.json().catch(() => null);
      const url = body?.url;
      if (!url || typeof url !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Missing "url" in request body' },
          { status: 400 },
        );
      }
      dgRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
    } else {
      // ── File mode: the raw bytes are streamed straight to Deepgram.
      // NOTE: on Vercel, the serverless request body is capped (~4.5 MB).
      // Larger files should go through blob storage + URL mode instead.
      const bytes = await request.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) {
        return NextResponse.json(
          { success: false, error: 'The uploaded file was empty' },
          { status: 400 },
        );
      }
      dgRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': contentType || 'application/octet-stream',
        },
        body: bytes,
      });
    }
  } catch (err) {
    console.error('Transcription request failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not reach the transcription service' },
      { status: 502 },
    );
  }

  if (!dgRes.ok) {
    const detail = await dgRes.text();
    console.error('Deepgram transcription failed:', dgRes.status, detail);
    return NextResponse.json(
      {
        success: false,
        error: 'Transcription failed',
        deepgramStatus: dgRes.status,
        deepgramDetail: detail.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const data = await dgRes.json();

  // Prefer diarized utterances; fall back to the flat transcript.
  let segments: Segment[] = [];
  const utterances = data?.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    segments = utterances
      .map((u: { transcript?: string; speaker?: number; start?: number; end?: number }) => ({
        speaker: typeof u.speaker === 'number' ? u.speaker : 0,
        text: (u.transcript || '').trim(),
        start: typeof u.start === 'number' ? u.start : 0,
        end: typeof u.end === 'number' ? u.end : 0,
      }))
      .filter((s: Segment) => s.text.length > 0);
  } else {
    const alt = data?.results?.channels?.[0]?.alternatives?.[0];
    const flat = (alt?.transcript || '').trim();
    if (flat) segments = [{ speaker: 0, text: flat, start: 0, end: 0 }];
  }

  if (segments.length === 0) {
    return NextResponse.json(
      { success: false, error: 'No speech was detected in the recording' },
      { status: 422 },
    );
  }

  const duration = typeof data?.metadata?.duration === 'number' ? data.metadata.duration : 0;
  return NextResponse.json({ success: true, segments, duration });
}
