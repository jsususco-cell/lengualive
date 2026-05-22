'use client';

// ─── Live meeting (bot) view ────────────────────────────────────
// Sends a bot into a Google Meet / Zoom / Teams call via the
// bot-worker service and renders the live transcript + translation
// it streams back over a WebSocket.
//
// Flow:
//   POST /api/meeting  → { sessionId, streamToken, wsUrl }
//   open WebSocket(wsUrl?token=streamToken)
//   render 'state' / 'interim' / 'transcript' / 'error' events
//   DELETE /api/meeting?id=…  → the bot leaves the call

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft, Video, Square, Copy, Download, AlertCircle, RotateCcw,
  Check, Sparkles, Radio,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { LangInfo } from '@/components/RecordingTranslator';

interface LiveMeetingProps {
  source: LangInfo;
  target: LangInfo;
  onBack: () => void;
}

// Mirrors the bot-worker's SessionState, plus local UI-only phases.
type Phase = 'idle' | 'starting' | 'joining' | 'waiting-admit' | 'live' | 'ended' | 'error';

interface Entry {
  id: number;
  speaker: number;
  original: string;
  translated: string | null;
  ts: string;
}

// Events received over the bot-worker WebSocket.
type WorkerEvent =
  | { type: 'state'; state: string; error?: string }
  | { type: 'interim'; text: string; speaker: number }
  | { type: 'transcript'; original: string; translated: string | null; speaker: number; ts: string }
  | { type: 'error'; message: string };

const SPEAKER_COLORS = [
  { bg: 'rgba(255,143,101,0.12)', border: 'rgba(255,143,101,0.3)', text: '#FF8F65', dot: '#FF6B35' },
  { bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.3)',  text: '#34D399', dot: '#10B981' },
  { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.3)',  text: '#60A5FA', dot: '#3B82F6' },
  { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.3)', text: '#A78BFA', dot: '#7C3AED' },
  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.3)',  text: '#FBBF24', dot: '#D97706' },
  { bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.3)', text: '#F472B6', dot: '#DB2777' },
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  starting: 'Dispatching bot…',
  joining: 'Bot is joining the meeting…',
  'waiting-admit': 'Waiting to be admitted — please admit the bot in the meeting',
  live: 'Live',
  ended: 'Meeting ended',
  error: 'Error',
};

// ═══════════════════════════════════════════════════════════════
export default function LiveMeeting({ source, target, onBack }: LiveMeetingProps) {
  const { toast } = useToast();

  const [phase, setPhase]         = useState<Phase>('idle');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [error, setError]         = useState('');
  const [entries, setEntries]     = useState<Entry[]>([]);
  const [interim, setInterim]     = useState<{ text: string; speaker: number } | null>(null);

  const wsRef        = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const entryIdRef   = useRef(0);
  const endRef       = useRef<HTMLDivElement | null>(null);

  const isActive = phase === 'starting' || phase === 'joining' || phase === 'waiting-admit' || phase === 'live';

  // ─── Auto-scroll the transcript ───────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, interim]);

  // ─── Tear everything down ─────────────────────────────────────
  const teardown = useCallback((endOnServer: boolean) => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    const id = sessionIdRef.current;
    if (endOnServer && id) {
      // Best-effort: tell the worker to make the bot leave. `keepalive`
      // lets it complete even if the page is navigating away.
      fetch(`/api/meeting?id=${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    }
    sessionIdRef.current = null;
  }, []);

  // Close the bot if the component unmounts while a meeting is active.
  useEffect(() => {
    return () => {
      if (wsRef.current || sessionIdRef.current) teardown(true);
    };
  }, [teardown]);

  // ─── Handle one WebSocket event ───────────────────────────────
  const onWorkerEvent = useCallback((event: WorkerEvent) => {
    if (event.type === 'state') {
      const s = event.state;
      if (s === 'joining' || s === 'waiting-admit' || s === 'live' || s === 'ended' || s === 'error') {
        setPhase(s);
      }
      if (s === 'error') setError(event.error || 'The bot reported an error.');
      if (s === 'ended') { setInterim(null); teardown(false); }
    } else if (event.type === 'interim') {
      setInterim({ text: event.text, speaker: event.speaker });
    } else if (event.type === 'transcript') {
      setEntries(prev => [...prev, {
        id: ++entryIdRef.current,
        speaker: event.speaker,
        original: event.original,
        translated: event.translated,
        ts: event.ts,
      }]);
      setInterim(null);
    } else if (event.type === 'error') {
      toast({ variant: 'destructive', title: 'Meeting bot', description: event.message });
    }
  }, [teardown, toast]);

  // ─── Start: dispatch the bot ──────────────────────────────────
  const start = useCallback(async () => {
    const url = meetingUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast({ variant: 'destructive', title: 'Invalid link', description: 'Paste the full meeting URL.' });
      return;
    }

    setPhase('starting');
    setError('');
    setEntries([]);
    setInterim(null);
    entryIdRef.current = 0;

    let payload: { success: boolean; error?: string; sessionId?: string; streamToken?: string; wsUrl?: string };
    try {
      const res = await fetch('/api/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: url, sourceLang: source.code, targetLang: target.code }),
      });
      payload = await res.json();
    } catch {
      setPhase('error');
      setError('Could not reach the dashboard server.');
      return;
    }

    if (!payload.success || !payload.sessionId || !payload.streamToken || !payload.wsUrl) {
      setPhase('error');
      setError(payload.error || 'The meeting bot could not be started.');
      return;
    }

    sessionIdRef.current = payload.sessionId;
    setPhase('joining');

    // Open the live event stream, authed with the session-scoped token.
    try {
      const ws = new WebSocket(`${payload.wsUrl}?token=${encodeURIComponent(payload.streamToken)}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try { onWorkerEvent(JSON.parse(e.data) as WorkerEvent); } catch { /* ignore bad frame */ }
      };
      ws.onerror = () => {
        toast({ variant: 'destructive', title: 'Stream error', description: 'Lost the connection to the meeting bot.' });
      };
      ws.onclose = () => {
        // If the meeting hasn't formally ended, surface the drop.
        setPhase(p => (p === 'ended' || p === 'error' ? p : 'ended'));
      };
    } catch {
      setPhase('error');
      setError('Could not open the live transcript stream.');
    }
  }, [meetingUrl, source.code, target.code, onWorkerEvent, toast]);

  // ─── End the meeting ──────────────────────────────────────────
  const end = useCallback(() => {
    teardown(true);
    setPhase('ended');
    setInterim(null);
  }, [teardown]);

  // ─── Copy / download ──────────────────────────────────────────
  const buildText = useCallback(() => {
    let t = 'LinguaLive — Live Meeting Transcript\n';
    t += `Date: ${new Date().toLocaleString()}\n`;
    t += `${source.flag} ${source.name} → ${target.flag} ${target.name}\n`;
    t += `Meeting: ${meetingUrl}\n`;
    t += `${'─'.repeat(50)}\n\n`;
    entries.forEach(e => {
      t += `Speaker ${e.speaker + 1}\n`;
      t += `  ${source.name}: ${e.original}\n`;
      t += `  ${target.name}: ${e.translated ?? '(not translated)'}\n\n`;
    });
    return t;
  }, [entries, source, target, meetingUrl]);

  const copyTranscript = useCallback(() => {
    navigator.clipboard.writeText(buildText()).then(
      () => toast({ title: 'Copied to clipboard ✓' }),
      () => toast({ variant: 'destructive', title: 'Copy failed' }),
    );
  }, [buildText, toast]);

  const downloadTranscript = useCallback(() => {
    const blob = new Blob([buildText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lingualive-meeting-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: 'Transcript downloaded ✓' });
  }, [buildText, toast]);

  const reset = useCallback(() => {
    teardown(false);
    setPhase('idle');
    setError('');
    setEntries([]);
    setInterim(null);
    entryIdRef.current = 0;
  }, [teardown]);

  const showTranscript = phase === 'joining' || phase === 'waiting-admit' || phase === 'live' || phase === 'ended';

  // ═══════════════════════════════════════════════════════════════
  return (
    <>
      <div className="bg-mesh" />
      <div className="noise-overlay" />

      <div className="relative z-10 h-screen flex flex-col">

        {/* ── Header ── */}
        <header className="flex items-center gap-3 px-4 sm:px-5 h-14 border-b border-[var(--surface-4)]/80 bg-[var(--surface)]/90 backdrop-blur-md flex-shrink-0">
          <button
            onClick={() => { if (isActive) end(); onBack(); }}
            className="w-8 h-8 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#C2410C] flex items-center justify-center">
              <Video className="text-white w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-sm text-white tracking-tight">Live Meeting Bot</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs">
              <span className="text-base leading-none">{source.flag}</span>
              <span className="text-zinc-600 mx-0.5">→</span>
              <span className="text-base leading-none">{target.flag}</span>
            </div>
            {isActive && (
              <button
                onClick={end}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold hover:bg-red-500/15 transition-colors"
              >
                <Square className="w-3 h-3" />
                <span className="hidden sm:inline">End</span>
              </button>
            )}
          </div>
        </header>

        {/* ── Status bar ── */}
        {phase !== 'idle' && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-5 py-2 border-b border-[var(--surface-4)]/60 bg-[var(--surface-2)]/40 text-xs">
            {phase === 'live' ? (
              <Radio className="w-3.5 h-3.5 text-[var(--mint-400)] animate-pulse" />
            ) : phase === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            ) : phase === 'ended' ? (
              <Check className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <span className="spinner" />
            )}
            <span className={phase === 'error' ? 'text-red-400' : phase === 'live' ? 'text-[var(--mint-400)]' : 'text-zinc-400'}>
              {PHASE_LABEL[phase]}
            </span>
            {entries.length > 0 && <span className="ml-auto text-zinc-600">{entries.length} segments</span>}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden">

          {/* IDLE — enter a meeting link */}
          {phase === 'idle' && (
            <div className="h-full overflow-y-auto scroll-panel">
              <div className="max-w-xl mx-auto px-5 py-12">
                <div className="glass-card rounded-2xl p-7">
                  <div className="w-14 h-14 rounded-2xl bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center mx-auto mb-4">
                    <Video className="w-6 h-6 text-[var(--brand-400)]" />
                  </div>
                  <h2 className="text-base font-bold text-white text-center mb-1">Send a bot to your meeting</h2>
                  <p className="text-xs text-zinc-500 text-center mb-5 leading-relaxed">
                    Paste a Google Meet link. A bot joins the call as a participant and
                    translates {source.flag} {source.name} → {target.flag} {target.name} live.
                  </p>
                  <input
                    type="url"
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
                    placeholder="https://meet.google.com/abc-defg-hij"
                    className="w-full h-11 px-3.5 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--brand-500)]/50"
                  />
                  <button
                    onClick={start}
                    disabled={!meetingUrl.trim()}
                    className="btn-start w-full mt-3 py-3 rounded-xl bg-gradient-to-r from-[#E55A25] to-[#FF6B35] text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Video className="w-4 h-4" /> Send bot to meeting
                  </button>
                  <p className="text-[11px] text-zinc-600 mt-3 text-center leading-relaxed">
                    Someone in the meeting must admit the bot from the waiting room.
                    Google Meet is supported today; Zoom and Teams are coming.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ERROR */}
          {phase === 'error' && (
            <div className="h-full flex items-center justify-center px-5">
              <div className="glass-card rounded-2xl p-8 text-center max-w-md">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-sm font-semibold text-white mb-1.5">The meeting bot couldn&apos;t run</p>
                <p className="text-xs text-zinc-400 leading-relaxed mb-5">{error}</p>
                <button
                  onClick={reset}
                  className="btn-start inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs font-semibold text-zinc-200 hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Try again
                </button>
              </div>
            </div>
          )}

          {/* TRANSCRIPT */}
          {showTranscript && (
            <div className="h-full flex flex-col">
              <div className="flex-1 scroll-panel overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
                {entries.length === 0 && !interim && (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700">
                    <Sparkles className="w-7 h-7 opacity-30 mb-2" />
                    <p className="text-xs">{phase === 'waiting-admit' ? 'Waiting to be admitted…' : 'Waiting for speech…'}</p>
                  </div>
                )}
                {entries.map(e => <LiveEntry key={e.id} entry={e} sourceFlag={source.flag} targetFlag={target.flag} />)}
                {interim && (
                  <div className="transcript-entry opacity-60">
                    <SpeakerBadge speaker={interim.speaker} />
                    <p className="text-sm text-zinc-400 italic mt-1">{interim.text}</p>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {(entries.length > 0) && (
                <footer className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-5 h-11 border-t border-[var(--surface-4)]/60 bg-[var(--surface)]/80 backdrop-blur-md">
                  <span className="text-[11px] text-zinc-600">{entries.length} segments · Claude AI</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={copyTranscript} className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors" data-tip="Copy">
                      <Copy className="w-3 h-3" />
                    </button>
                    <button onClick={downloadTranscript} className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors" data-tip="Download">
                      <Download className="w-3 h-3" />
                    </button>
                    {phase === 'ended' && (
                      <button onClick={reset} className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-[11px] font-semibold text-zinc-300 hover:text-white transition-colors">
                        <RotateCcw className="w-3 h-3" /> New
                      </button>
                    )}
                  </div>
                </footer>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────
function SpeakerBadge({ speaker }: { speaker: number }) {
  const color = SPEAKER_COLORS[speaker % SPEAKER_COLORS.length];
  return (
    <span className="spk-badge" style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color.dot }} />
      Speaker {speaker + 1}
    </span>
  );
}

function LiveEntry({ entry, sourceFlag, targetFlag }: { entry: Entry; sourceFlag: string; targetFlag: string }) {
  const color = SPEAKER_COLORS[entry.speaker % SPEAKER_COLORS.length];
  return (
    <div className="transcript-entry space-y-1.5">
      <SpeakerBadge speaker={entry.speaker} />
      <p className="text-sm text-zinc-200 leading-relaxed">
        <span className="text-zinc-600 mr-1.5">{sourceFlag}</span>{entry.original}
      </p>
      {entry.translated ? (
        <p className="text-sm leading-relaxed font-medium" style={{ color: color.text }}>
          <span className="opacity-60 mr-1.5">{targetFlag}</span>{entry.translated}
        </p>
      ) : (
        <p className="text-xs text-zinc-700 italic">Translation unavailable</p>
      )}
    </div>
  );
}
