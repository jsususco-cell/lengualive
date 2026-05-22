'use client';

// ─── Recorded-meeting translator ────────────────────────────────
// Self-contained screen: upload an audio/video file (or paste a URL),
// transcribe it with Deepgram (POST /api/transcribe), translate every
// speaker segment with Claude (POST /api/translate), and show a split
// original/translated transcript. The live counterpart lives in
// LinguaLive.tsx; this one is for recordings, not real-time meetings.

import { useState, useRef, useCallback, type DragEvent } from 'react';
import {
  ArrowLeft, UploadCloud, FileAudio, Link2, Sparkles, Copy, Download,
  AlertCircle, RotateCcw, Check,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Props ──────────────────────────────────────────────────────
export interface LangInfo {
  code: string;
  name: string;
  flag: string;
}

interface RecordingTranslatorProps {
  /** Spoken language of the recording (used as the translation source). */
  source: LangInfo;
  /** Language to translate into. */
  target: LangInfo;
  /** Return to the onboarding screen. */
  onBack: () => void;
}

// ─── Types ──────────────────────────────────────────────────────
type Status = 'idle' | 'uploading' | 'transcribing' | 'translating' | 'done' | 'error';
type TabView = 'split' | 'original' | 'translated';

interface Segment {
  speaker: number;
  text: string;
  start: number;
  end: number;
}

interface Entry {
  id: number;
  speaker: number;
  original: string;
  translated: string | null;
  isTranslating: boolean;
  start: number;
}

// ─── Constants ──────────────────────────────────────────────────
// Vercel serverless functions cap the request body at ~4.5 MB, so a
// file routed through /api/transcribe must stay under that. Larger
// recordings should use the "from URL" path instead.
const MAX_DIRECT_UPLOAD = 4 * 1024 * 1024;

// How many segment translations to run at once.
const TRANSLATE_CONCURRENCY = 5;

const SPEAKER_COLORS = [
  { bg: 'rgba(255,143,101,0.12)', border: 'rgba(255,143,101,0.3)', text: '#FF8F65', dot: '#FF6B35' },
  { bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.3)',  text: '#34D399', dot: '#10B981' },
  { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.3)',  text: '#60A5FA', dot: '#3B82F6' },
  { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.3)', text: '#A78BFA', dot: '#7C3AED' },
  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.3)',  text: '#FBBF24', dot: '#D97706' },
  { bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.3)', text: '#F472B6', dot: '#DB2777' },
];

// ─── Helpers ────────────────────────────────────────────────────
const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Run `fn` over `items` with a bounded number of concurrent calls. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const current = items[cursor++];
      await fn(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ═══════════════════════════════════════════════════════════════
export default function RecordingTranslator({ source, target, onBack }: RecordingTranslatorProps) {
  const { toast } = useToast();

  const [status, setStatus]       = useState<Status>('idle');
  const [error, setError]         = useState('');
  const [fileName, setFileName]   = useState('');
  const [uploadPct, setUploadPct] = useState(0);
  const [duration, setDuration]   = useState(0);
  const [entries, setEntries]     = useState<Entry[]>([]);
  const [tabView, setTabView]     = useState<TabView>('split');
  const [isDragging, setIsDragging] = useState(false);
  const [urlValue, setUrlValue]   = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sameLanguage = source.code === target.code;
  const translatedCount = entries.filter(e => !e.isTranslating).length;

  // ─── Translate every transcript segment ───────────────────────
  const translateAll = useCallback(async (segs: Segment[]) => {
    const initial: Entry[] = segs.map((s, i) => ({
      id: i,
      speaker: s.speaker,
      original: s.text,
      translated: sameLanguage ? s.text : null,
      isTranslating: !sameLanguage,
      start: s.start,
    }));
    setEntries(initial);

    if (sameLanguage) {
      setStatus('done');
      return;
    }

    setStatus('translating');
    await mapLimit(initial, TRANSLATE_CONCURRENCY, async (entry) => {
      let translated: string | null = null;
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: entry.original, from: source.code, to: target.code }),
        });
        const data = await res.json();
        if (data.success && data.translated) translated = data.translated;
      } catch {
        /* leave as null — surfaced as "Translation unavailable" */
      }
      setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, translated, isTranslating: false } : e)));
    });
    setStatus('done');
  }, [sameLanguage, source.code, target.code]);

  // ─── Handle the Deepgram response shape ───────────────────────
  const consumeTranscription = useCallback(async (payload: unknown) => {
    const data = payload as { success?: boolean; error?: string; segments?: Segment[]; duration?: number };
    if (!data?.success || !Array.isArray(data.segments) || data.segments.length === 0) {
      setStatus('error');
      setError(data?.error || 'The recording could not be transcribed.');
      return;
    }
    setDuration(data.duration || 0);
    await translateAll(data.segments);
  }, [translateAll]);

  // ─── Upload a file via XHR (so we get upload progress) ─────────
  const uploadFile = useCallback((file: File) => {
    setStatus('uploading');
    setUploadPct(0);
    setError('');
    setEntries([]);
    setFileName(file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcribe');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => setStatus('transcribing');

    xhr.onload = () => {
      let parsed: unknown = null;
      try { parsed = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300 && parsed) {
        consumeTranscription(parsed);
      } else if (xhr.status === 413) {
        setStatus('error');
        setError('That file is too large to upload directly (server limit ~4 MB). Try a shorter clip or use the "From a link" option below.');
      } else {
        setStatus('error');
        const msg = (parsed as { error?: string })?.error;
        setError(msg || `Transcription failed (HTTP ${xhr.status}).`);
      }
    };
    xhr.onerror = () => {
      setStatus('error');
      setError('Network error while uploading the recording.');
    };

    xhr.send(file);
  }, [consumeTranscription]);

  // ─── Validate + accept a chosen file ──────────────────────────
  const handleFile = useCallback((file: File | undefined | null) => {
    if (!file) return;
    const isMedia =
      file.type.startsWith('audio/') ||
      file.type.startsWith('video/') ||
      file.type === ''; // some browsers report empty type — allow it
    if (!isMedia) {
      toast({ variant: 'destructive', title: 'Unsupported file', description: 'Please choose an audio or video file.' });
      return;
    }
    if (file.size > MAX_DIRECT_UPLOAD) {
      setStatus('error');
      setFileName(file.name);
      setError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Direct upload is limited to ~4 MB. Use a shorter clip, or host the file and paste its link below.`);
      return;
    }
    uploadFile(file);
  }, [toast, uploadFile]);

  // ─── Transcribe from a URL ────────────────────────────────────
  const handleUrl = useCallback(async () => {
    const url = urlValue.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast({ variant: 'destructive', title: 'Invalid link', description: 'Enter a full http(s):// URL to the recording.' });
      return;
    }
    setStatus('transcribing');
    setError('');
    setEntries([]);
    setFileName(url.split('/').pop() || 'Remote recording');
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      await consumeTranscription(data);
    } catch {
      setStatus('error');
      setError('Could not reach the transcription service.');
    }
  }, [urlValue, toast, consumeTranscription]);

  // ─── Drag & drop ──────────────────────────────────────────────
  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  // ─── Reset for another recording ──────────────────────────────
  const reset = useCallback(() => {
    setStatus('idle');
    setError('');
    setFileName('');
    setUploadPct(0);
    setDuration(0);
    setEntries([]);
    setUrlValue('');
  }, []);

  // ─── Copy / download ──────────────────────────────────────────
  const buildText = useCallback(() => {
    let t = 'LinguaLive — Recording Transcript\n';
    t += `Date: ${new Date().toLocaleString()}\n`;
    t += `${source.flag} ${source.name} → ${target.flag} ${target.name}\n`;
    if (duration) t += `Length: ${formatClock(duration)}\n`;
    t += `Source: ${fileName}\n`;
    t += `${'─'.repeat(50)}\n\n`;
    entries.forEach(e => {
      t += `[${formatClock(e.start)}] Speaker ${e.speaker + 1}\n`;
      t += `  ${source.name}: ${e.original}\n`;
      t += `  ${target.name}: ${e.translated ?? '(not translated)'}\n\n`;
    });
    return t;
  }, [entries, source, target, duration, fileName]);

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
    a.download = `lingualive-recording-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: 'Transcript downloaded ✓' });
  }, [buildText, toast]);

  const wordCount = entries.reduce((sum, e) => sum + e.original.split(/\s+/).filter(Boolean).length, 0);
  const showTranscript = entries.length > 0;
  const isWorking = status === 'uploading' || status === 'transcribing';

  // ═══════════════════════════════════════════════════════════════
  return (
    <>
      <div className="bg-mesh" />
      <div className="noise-overlay" />

      <div className="relative z-10 h-screen flex flex-col">

        {/* ── Header ── */}
        <header className="flex items-center gap-3 px-4 sm:px-5 h-14 border-b border-[var(--surface-4)]/80 bg-[var(--surface)]/90 backdrop-blur-md flex-shrink-0">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#C2410C] flex items-center justify-center">
              <FileAudio className="text-white w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-sm text-white tracking-tight">Translate a Recording</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs">
            <span className="text-base leading-none">{source.flag}</span>
            <span className="text-zinc-300 font-medium hidden sm:inline">{source.name}</span>
            <span className="text-zinc-600 mx-0.5">→</span>
            <span className="text-base leading-none">{target.flag}</span>
            <span className="text-[var(--brand-400)] font-medium hidden sm:inline">{target.name}</span>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden">

          {/* INPUT / PROGRESS */}
          {!showTranscript && (
            <div className="h-full overflow-y-auto scroll-panel">
              <div className="max-w-xl mx-auto px-5 py-10">

                {isWorking ? (
                  <div className="glass-card rounded-2xl p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--brand-600)]/15 border border-[var(--brand-600)]/30 flex items-center justify-center mx-auto mb-4">
                      <span className="spinner border-[var(--brand-600)]/30 border-t-[var(--brand-400)]" />
                    </div>
                    <p className="text-sm font-semibold text-white mb-1">
                      {status === 'uploading' ? 'Uploading recording…' : 'Transcribing with Deepgram…'}
                    </p>
                    <p className="text-xs text-zinc-500 mb-4 truncate">{fileName}</p>
                    {status === 'uploading' && (
                      <div className="h-1.5 rounded-full bg-[var(--surface-4)] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#E55A25] to-[#FF6B35] transition-all duration-200"
                          style={{ width: `${uploadPct}%` }}
                        />
                      </div>
                    )}
                    {status === 'transcribing' && (
                      <p className="text-[11px] text-zinc-600">This can take a moment for longer recordings.</p>
                    )}
                  </div>
                ) : status === 'error' ? (
                  <div className="glass-card rounded-2xl p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    </div>
                    <p className="text-sm font-semibold text-white mb-1.5">Couldn&apos;t process that recording</p>
                    <p className="text-xs text-zinc-400 leading-relaxed mb-5">{error}</p>
                    <button
                      onClick={reset}
                      className="btn-start inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs font-semibold text-zinc-200 hover:text-white transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Try again
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Upload dropzone */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={onDrop}
                      className={`glass-card rounded-2xl p-10 text-center cursor-pointer transition-colors ${
                        isDragging ? 'border-[var(--brand-500)] bg-[var(--brand-600)]/10' : 'hover:border-[var(--surface-5)]'
                      }`}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center mx-auto mb-4">
                        <UploadCloud className="w-6 h-6 text-[var(--brand-400)]" />
                      </div>
                      <p className="text-sm font-semibold text-white mb-1">Drop an audio or video file</p>
                      <p className="text-xs text-zinc-500">or click to browse · MP3, M4A, WAV, MP4, WebM…</p>
                      <p className="text-[11px] text-zinc-600 mt-3">Direct upload limit ~4 MB · longer recordings: use a link below</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,video/*"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                      />
                    </div>

                    {/* URL input */}
                    <div className="glass-card rounded-2xl p-5 mt-4">
                      <p className="text-xs text-zinc-400 font-medium flex items-center gap-1.5 mb-3">
                        <Link2 className="w-3.5 h-3.5 text-zinc-500" />
                        From a link <span className="text-zinc-600">(any size)</span>
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={urlValue}
                          onChange={(e) => setUrlValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleUrl(); }}
                          placeholder="https://…/meeting-recording.mp3"
                          className="flex-1 h-10 px-3 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--brand-500)]/50"
                        />
                        <button
                          onClick={handleUrl}
                          disabled={!urlValue.trim()}
                          className="px-4 h-10 rounded-lg bg-gradient-to-r from-[#E55A25] to-[#FF6B35] text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                        >
                          Transcribe
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-600 mt-2">
                        Must be a direct, public link to the audio/video file.
                      </p>
                    </div>

                    <p className="text-[11px] text-zinc-600 text-center mt-5 leading-relaxed">
                      The recording is transcribed with speaker labels, then every segment is
                      translated {source.flag} {source.name} → {target.flag} {target.name} by Claude.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TRANSCRIPT */}
          {showTranscript && (
            <div className="h-full flex flex-col">
              {/* Stats + toolbar */}
              <div className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-[var(--surface-4)]/60 bg-[var(--surface-2)]/40">
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{entries.length} segments</span>
                  <span className="text-zinc-700">·</span>
                  <span>{wordCount} words</span>
                  {duration > 0 && <><span className="text-zinc-700">·</span><span>{formatClock(duration)}</span></>}
                  {status === 'translating' && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span className="text-[var(--brand-400)] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand-500)] animate-pulse" />
                        translating {translatedCount}/{entries.length}
                      </span>
                    </>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={copyTranscript} className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors" data-tip="Copy">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button onClick={downloadTranscript} className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors" data-tip="Download">
                    <Download className="w-3 h-3" />
                  </button>
                  <button onClick={reset} className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-[11px] font-semibold text-zinc-300 hover:text-white transition-colors">
                    <RotateCcw className="w-3 h-3" /> New
                  </button>
                </div>
              </div>

              {/* Tab bar */}
              <div className="flex-shrink-0 flex items-center px-4 sm:px-5 border-b border-[var(--surface-4)]/60 bg-[var(--surface-2)]/40">
                {([
                  { id: 'split',      label: 'Split View' },
                  { id: 'original',   label: `Original (${source.flag})` },
                  { id: 'translated', label: `Translated (${target.flag})` },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setTabView(tab.id)}
                    className={`relative px-4 py-2.5 text-xs font-semibold transition-colors ${
                      tabView === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab.label}
                    {tabView === tab.id && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--brand-500)] rounded-t-sm" />}
                  </button>
                ))}
              </div>

              {/* Transcript area */}
              <div className="flex-1 overflow-hidden">
                {tabView === 'split' && (
                  <div className="h-full grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--surface-4)]/60">
                    <div className="flex flex-col overflow-hidden">
                      <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--surface-4)]/40">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                          {source.flag} Original · {source.name}
                        </span>
                      </div>
                      <div className="flex-1 scroll-panel px-4 py-3 space-y-3 overflow-y-auto">
                        {entries.map(e => <OriginalEntry key={e.id} entry={e} />)}
                      </div>
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--surface-4)]/40">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                          {target.flag} Translation · {target.name}
                        </span>
                      </div>
                      <div className="flex-1 scroll-panel px-4 py-3 space-y-3 overflow-y-auto">
                        {entries.map(e => <TranslatedEntry key={e.id} entry={e} />)}
                      </div>
                    </div>
                  </div>
                )}

                {tabView === 'original' && (
                  <div className="h-full scroll-panel px-5 py-4 space-y-3 overflow-y-auto">
                    {entries.map(e => <OriginalEntry key={e.id} entry={e} large />)}
                  </div>
                )}

                {tabView === 'translated' && (
                  <div className="h-full scroll-panel px-5 py-4 space-y-3 overflow-y-auto">
                    {entries.map(e => <TranslatedEntry key={e.id} entry={e} large />)}
                  </div>
                )}
              </div>

              {/* Footer */}
              <footer className="flex-shrink-0 flex items-center justify-between px-4 sm:px-5 h-10 border-t border-[var(--surface-4)]/60 bg-[var(--surface)]/80 backdrop-blur-md text-[11px] text-zinc-600">
                <span className="truncate">{fileName}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  {status === 'done' ? (
                    <><Check className="w-3 h-3 text-[var(--mint-400)]" /> <span className="text-[var(--mint-400)]">Complete · Claude AI</span></>
                  ) : (
                    <><Sparkles className="w-3 h-3 text-[var(--brand-400)]" /> <span className="text-[var(--brand-400)]">Translating · Claude AI</span></>
                  )}
                </span>
              </footer>
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

function OriginalEntry({ entry, large }: { entry: Entry; large?: boolean }) {
  return (
    <div className="transcript-entry space-y-1">
      <div className="flex items-center gap-2">
        <SpeakerBadge speaker={entry.speaker} />
        <span className="font-mono text-[9px] text-zinc-700">{formatClock(entry.start)}</span>
      </div>
      <p className={`${large ? 'text-base' : 'text-sm'} text-zinc-200 leading-relaxed`}>{entry.original}</p>
    </div>
  );
}

function TranslatedEntry({ entry, large }: { entry: Entry; large?: boolean }) {
  const color = SPEAKER_COLORS[entry.speaker % SPEAKER_COLORS.length];
  return (
    <div className="transcript-entry space-y-1">
      <div className="flex items-center gap-2">
        <SpeakerBadge speaker={entry.speaker} />
        <span className="font-mono text-[9px] text-zinc-700">{formatClock(entry.start)}</span>
      </div>
      {entry.isTranslating ? (
        <div className="flex items-center gap-2 text-zinc-600">
          <span className="spinner" />
          <span className="text-xs italic">Translating…</span>
        </div>
      ) : entry.translated ? (
        <p className={`${large ? 'text-base' : 'text-sm'} leading-relaxed font-medium`} style={{ color: color.text }}>
          {entry.translated}
        </p>
      ) : (
        <p className="text-xs text-zinc-700 italic">Translation unavailable</p>
      )}
    </div>
  );
}
