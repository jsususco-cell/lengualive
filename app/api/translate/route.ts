import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// ─── Runtime config ─────────────────────────────────────────────
// The Anthropic SDK requires the Node.js runtime (not Edge).
export const runtime = 'nodejs';
// Allow up to 30s for a translation/summary call (Vercel function limit).
export const maxDuration = 30;

// ─── Models ─────────────────────────────────────────────────────
// Fast + cheap model for real-time translation (fires on every speech update).
// Higher-quality model for the end-of-meeting summary.
// Both are overridable via environment variables on Vercel.
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || 'claude-haiku-4-5';
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'claude-sonnet-4-6';

// ─── Language code → human-readable name ────────────────────────
const languageNames: Record<string, string> = {
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Chinese', 'ja': 'Japanese',
  'ko': 'Korean', 'ar': 'Arabic', 'hi': 'Hindi', 'ru': 'Russian',
  'tr': 'Turkish', 'nl': 'Dutch', 'pl': 'Polish', 'sv': 'Swedish',
  'da': 'Danish', 'fi': 'Finnish', 'no': 'Norwegian', 'th': 'Thai',
  'vi': 'Vietnamese', 'id': 'Indonesian', 'uk': 'Ukrainian', 'cs': 'Czech',
  'ro': 'Romanian', 'hu': 'Hungarian', 'el': 'Greek', 'he': 'Hebrew',
  'ms': 'Malay', 'fil': 'Filipino (Tagalog)', 'ceb': 'Cebuano',
  'sw': 'Swahili', 'bn': 'Bengali', 'ta': 'Tamil', 'ur': 'Urdu',
};

// ─── Anthropic client (reads ANTHROPIC_API_KEY from the environment) ──
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!client) client = new Anthropic();
  return client;
}

// ─── Stable system prompt for translation ───────────────────────
// Kept as a frozen string so prompt caching can reuse it across the
// many translation calls a single meeting generates. `cache_control`
// is applied below; caching activates automatically once the prompt
// exceeds the model's minimum cacheable length.
const TRANSLATION_SYSTEM_PROMPT = `You are a professional real-time interpreter for live business meetings.

Your job: translate the user's text accurately and naturally into the target language.

Rules:
- Output ONLY the translation. No explanations, no alternatives, no notes, no quotation marks around the result.
- Preserve the speaker's tone, register, and level of formality.
- Translate idioms to their natural equivalent in the target language rather than word-for-word.
- Keep proper nouns, brand names, product names, and acronyms unchanged unless they have a well-known localized form.
- Keep numbers, dates, currencies, and units intact and correctly formatted for the target language.
- The input may be a partial or unfinished sentence captured live from speech — translate what is given without inventing a completion.
- If the input is already in the target language, return it unchanged.
- Never refuse: if the text is unclear, produce the best faithful translation you can.`;

// ─── System prompt for meeting summary ──────────────────────────
const SUMMARY_SYSTEM_PROMPT = `You are an AI meeting assistant. Analyze the provided meeting transcript and produce a concise, useful, and specific summary. Focus only on what was actually discussed — do not invent details. Be actionable and precise.`;

// ─── JSON schema for the structured summary output ──────────────
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-3 sentence overview of what was discussed' },
    keyPoints: { type: 'array', items: { type: 'string' }, description: 'Main points raised' },
    actionItems: { type: 'array', items: { type: 'string' }, description: 'Concrete follow-up tasks' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    topics: { type: 'array', items: { type: 'string' }, description: 'Short topic tags' },
  },
  required: ['summary', 'keyPoints', 'actionItems', 'sentiment', 'topics'],
  additionalProperties: false,
} as const;

// Pull the concatenated text out of a Messages API response.
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, from, to, action } = body;

    // ─────────────────────────────────────────────────────────────
    // AI Meeting Summary
    // ─────────────────────────────────────────────────────────────
    if (action === 'summarize') {
      const { transcript, sourceLang, targetLang } = body;

      if (!transcript || typeof transcript !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Missing transcript' },
          { status: 400 },
        );
      }

      const srcName = languageNames[sourceLang] || sourceLang || 'the source language';
      const tgtName = languageNames[targetLang] || targetLang || 'the target language';

      try {
        const completion = await getClient().messages.create({
          model: SUMMARY_MODEL,
          max_tokens: 2048,
          system: [
            {
              type: 'text',
              text: SUMMARY_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          // Structured outputs guarantee the response is valid JSON
          // matching SUMMARY_SCHEMA — no fragile string parsing needed.
          output_config: {
            format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
          },
          messages: [
            {
              role: 'user',
              content: `Meeting transcript (spoken in ${srcName}, translated to ${tgtName}):\n\n${transcript}`,
            },
          ],
        });

        const raw = extractText(completion);
        const parsed = JSON.parse(raw);
        return NextResponse.json({ success: true, summary: parsed });
      } catch (summaryError) {
        console.error('Summary error:', summaryError);
        return NextResponse.json(
          { success: false, error: 'Could not generate summary' },
          { status: 502 },
        );
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Translation
    // ─────────────────────────────────────────────────────────────
    if (!text || !from || !to) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 },
      );
    }

    // No translation needed if source and target match.
    if (from === to) {
      return NextResponse.json({ success: true, translated: text, original: text, from, to });
    }

    const fromLang = languageNames[from] || from;
    const toLang = languageNames[to] || to;

    try {
      const completion = await getClient().messages.create({
        model: TRANSLATION_MODEL,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: TRANSLATION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Translate the following text from ${fromLang} to ${toLang}:\n\n${text}`,
          },
        ],
      });

      const translated = extractText(completion);

      if (!translated) {
        return NextResponse.json(
          { success: false, error: 'Translation failed' },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, translated, original: text, from, to });
    } catch (apiError) {
      console.error('Translation API error:', apiError);
      const status = apiError instanceof Anthropic.APIError ? apiError.status ?? 502 : 502;
      return NextResponse.json(
        { success: false, error: 'Translation failed' },
        { status },
      );
    }
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
