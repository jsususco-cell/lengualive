// ─── Real-time speech-to-text via Deepgram ──────────────────────
// Streams microphone or captured system audio to Deepgram's live
// WebSocket API and reports transcripts with real speaker labels
// (diarization). Hand-rolled on native fetch / WebSocket / MediaRecorder
// — no SDK — so it bundles cleanly for the browser.
//
// Model: nova-3 multilingual ("multi"). It auto-detects the spoken
// language across Deepgram's supported set — including Tagalog — and
// handles code-switching (e.g. Taglish), so the app's language picker
// does not need to be mapped to a Deepgram language code.

export interface DeepgramCallbacks {
  /** Fired once the connection is live and audio is streaming. */
  onOpen?: () => void;
  /** Live, not-yet-final text for the current utterance. */
  onInterim: (text: string, speaker: number) => void;
  /** A finalized speaker turn — ready to translate and record. */
  onFinal: (text: string, speaker: number) => void;
  /** A non-fatal problem worth surfacing to the user. */
  onError: (message: string) => void;
  /** The connection closed. */
  onClose?: () => void;
}

// Pick the speaker that owns most of the words in a result.
function dominantSpeaker(words: Array<{ speaker?: number }>, fallback: number): number {
  if (!words || words.length === 0) return fallback;
  const counts = new Map<number, number>();
  for (const w of words) {
    const s = typeof w.speaker === 'number' ? w.speaker : fallback;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = fallback;
  let bestCount = -1;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = speaker;
    }
  }
  return best;
}

export class DeepgramTranscriber {
  // Kept for reference / future use; the nova-3 multilingual model
  // auto-detects the language so it is not sent to Deepgram.
  private language: string;
  private cb: DeepgramCallbacks;
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private finalizedText = '';
  private currentSpeaker = 0;
  private stopped = false;

  constructor(opts: { language: string; callbacks: DeepgramCallbacks }) {
    this.language = opts.language;
    this.cb = opts.callbacks;
  }

  /** Fetch a token, open the Deepgram socket, and start streaming `stream`. */
  async start(stream: MediaStream): Promise<void> {
    this.stopped = false;

    // 1. Short-lived browser token from our own API route.
    const tokenRes = await fetch('/api/deepgram-token', { method: 'POST' });
    if (!tokenRes.ok) {
      throw new Error('Could not get a Deepgram token (is DEEPGRAM_API_KEY set?)');
    }
    const { token } = await tokenRes.json();
    if (!token) throw new Error('No Deepgram token was returned');

    // 2. Open the streaming WebSocket. nova-3 "multi" = multilingual,
    //    supports diarization on streaming.
    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'multi',
      diarize: 'true',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      endpointing: '500',
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    // Browser auth: the grant token rides in the Sec-WebSocket-Protocol
    // subprotocol under the 'bearer' scheme (a raw API key would use 'token').
    const ws = new WebSocket(url, ['bearer', token]);
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped) {
        try { ws.close(); } catch { /* ignore */ }
        return;
      }
      this.startRecorder(stream);
      this.cb.onOpen?.();
    };
    ws.onmessage = (ev) => this.handleMessage(ev);
    ws.onerror = () => this.cb.onError('Lost the connection to the transcription service');
    ws.onclose = () => {
      this.cb.onClose?.();
    };
  }

  private startRecorder(stream: MediaStream) {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(e.data);
      }
    };
    // Emit a chunk every 250ms for low-latency streaming.
    recorder.start(250);
  }

  private handleMessage(ev: MessageEvent) {
    let msg: {
      type?: string;
      is_final?: boolean;
      speech_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string; words?: Array<{ speaker?: number }> }> };
    };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;

    const alt = msg.channel?.alternatives?.[0];
    if (!alt) return;
    const transcript = (alt.transcript || '').trim();
    if (!transcript) return;

    const words = alt.words || [];
    const speaker = dominantSpeaker(words, this.currentSpeaker);

    if (msg.is_final) {
      // A speaker change closes the buffered turn as its own segment.
      if (this.finalizedText && speaker !== this.currentSpeaker) {
        this.cb.onFinal(this.finalizedText.trim(), this.currentSpeaker);
        this.finalizedText = '';
      }
      this.currentSpeaker = speaker;
      this.finalizedText = `${this.finalizedText} ${transcript}`.trim();

      if (msg.speech_final) {
        // End of utterance — commit the turn.
        this.cb.onFinal(this.finalizedText.trim(), this.currentSpeaker);
        this.finalizedText = '';
      } else {
        this.cb.onInterim(this.finalizedText, this.currentSpeaker);
      }
    } else {
      // Interim (still being refined).
      this.cb.onInterim(`${this.finalizedText} ${transcript}`.trim(), speaker);
    }
  }

  /** Stop sending audio but keep the connection alive. */
  pause() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.pause();
    }
    if (!this.keepAlive) {
      this.keepAlive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 6000);
    }
  }

  /** Resume sending audio. */
  resume() {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.recorder && this.recorder.state === 'paused') {
      this.recorder.resume();
    }
  }

  /** Tear everything down. */
  stop() {
    this.stopped = true;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    // Flush any buffered finalized text as a last segment.
    if (this.finalizedText.trim()) {
      this.cb.onFinal(this.finalizedText.trim(), this.currentSpeaker);
      this.finalizedText = '';
    }
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop();
      }
    } catch { /* ignore */ }
    this.recorder = null;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      this.ws?.close();
    } catch { /* ignore */ }
    this.ws = null;
  }
}
