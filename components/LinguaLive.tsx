'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Languages, Mic, Play, Square, Pause, Trash2, Copy, Download,
  ArrowRightLeft, Check, Plus, Video, Sparkles, Wand2, ChevronDown,
  Users, Globe, Zap, FileText, X, Volume2, VolumeX, MicOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { DeepgramTranscriber } from '@/lib/deepgram';

// ─── Language Data ──────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en',  name: 'English',            flag: '🇺🇸', speechCode: 'en-US' },
  { code: 'fil', name: 'Filipino / Tagalog',  flag: '🇵🇭', speechCode: 'fil-PH' },
  { code: 'es',  name: 'Spanish',             flag: '🇪🇸', speechCode: 'es-ES' },
  { code: 'fr',  name: 'French',              flag: '🇫🇷', speechCode: 'fr-FR' },
  { code: 'de',  name: 'German',              flag: '🇩🇪', speechCode: 'de-DE' },
  { code: 'it',  name: 'Italian',             flag: '🇮🇹', speechCode: 'it-IT' },
  { code: 'pt',  name: 'Portuguese',          flag: '🇧🇷', speechCode: 'pt-BR' },
  { code: 'zh',  name: 'Chinese',             flag: '🇨🇳', speechCode: 'zh-CN' },
  { code: 'ja',  name: 'Japanese',            flag: '🇯🇵', speechCode: 'ja-JP' },
  { code: 'ko',  name: 'Korean',              flag: '🇰🇷', speechCode: 'ko-KR' },
  { code: 'ar',  name: 'Arabic',              flag: '🇸🇦', speechCode: 'ar-SA' },
  { code: 'hi',  name: 'Hindi',               flag: '🇮🇳', speechCode: 'hi-IN' },
  { code: 'ru',  name: 'Russian',             flag: '🇷🇺', speechCode: 'ru-RU' },
  { code: 'tr',  name: 'Turkish',             flag: '🇹🇷', speechCode: 'tr-TR' },
  { code: 'nl',  name: 'Dutch',               flag: '🇳🇱', speechCode: 'nl-NL' },
  { code: 'id',  name: 'Indonesian',          flag: '🇮🇩', speechCode: 'id-ID' },
  { code: 'ms',  name: 'Malay',               flag: '🇲🇾', speechCode: 'ms-MY' },
  { code: 'vi',  name: 'Vietnamese',          flag: '🇻🇳', speechCode: 'vi-VN' },
  { code: 'th',  name: 'Thai',                flag: '🇹🇭', speechCode: 'th-TH' },
  { code: 'pl',  name: 'Polish',              flag: '🇵🇱', speechCode: 'pl-PL' },
  { code: 'sv',  name: 'Swedish',             flag: '🇸🇪', speechCode: 'sv-SE' },
  { code: 'uk',  name: 'Ukrainian',           flag: '🇺🇦', speechCode: 'uk-UA' },
  { code: 'he',  name: 'Hebrew',              flag: '🇮🇱', speechCode: 'he-IL' },
  { code: 'el',  name: 'Greek',               flag: '🇬🇷', speechCode: 'el-GR' },
  { code: 'hu',  name: 'Hungarian',           flag: '🇭🇺', speechCode: 'hu-HU' },
];

// ─── Speaker color palette ──────────────────────────────────────
const SPEAKER_COLORS = [
  { bg: 'rgba(255,143,101,0.12)', border: 'rgba(255,143,101,0.3)', text: '#FF8F65', dot: '#FF6B35' },
  { bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.3)',  text: '#34D399', dot: '#10B981' },
  { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.3)',  text: '#60A5FA', dot: '#3B82F6' },
  { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.3)', text: '#A78BFA', dot: '#7C3AED' },
  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.3)',  text: '#FBBF24', dot: '#D97706' },
  { bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.3)', text: '#F472B6', dot: '#DB2777' },
];

type View = 'onboarding' | 'session';
type TabView = 'split' | 'original' | 'translated';
type AudioSource = 'mic' | 'computer';

interface TranscriptEntry {
  id: number;
  timestamp: string;
  original: string;
  translated: string | null;
  speakerIndex: number;
  speakerLabel: string;
  isTranslating: boolean;
}

interface MeetingSummary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
}

// ─── Helpers ────────────────────────────────────────────────────
const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
};

const getLang = (code: string) => LANGUAGES.find(l => l.code === code);

// ═══════════════════════════════════════════════════════════════
export default function Home() {
  const { toast } = useToast();

  // Navigation
  const [view, setView]                   = useState<View>('onboarding');
  const [tabView, setTabView]             = useState<TabView>('split');

  // Language config
  const [sourceLang, setSourceLang]       = useState('en');
  const [targetLang, setTargetLang]       = useState('fil');
  const [autoDetect, setAutoDetect]       = useState(false);

  // Audio source
  const [audioSource, setAudioSource]     = useState<AudioSource>('mic');

  // Session state
  const [isListening, setIsListening]     = useState(false);
  const [isPaused, setIsPaused]           = useState(false);
  const [isConnecting, setIsConnecting]   = useState(false);
  const [isMuted, setIsMuted]             = useState(false);
  const [transcripts, setTranscripts]     = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText]     = useState('');
  const [interimTranslation, setInterimTranslation] = useState('');
  const [elapsedTime, setElapsedTime]     = useState(0);

  // Summary
  const [showSummary, setShowSummary]     = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary]             = useState<MeetingSummary | null>(null);

  // UI
  const [isBrowserSupported, setIsBrowserSupported] = useState(true);
  const [activeSpeakerIdx, setActiveSpeakerIdx]     = useState<number>(0);
  const [speakerCount, setSpeakerCount]             = useState(1);

  // Refs
  const audioContextRef     = useRef<AudioContext | null>(null);
  const analyserRef         = useRef<AnalyserNode | null>(null);
  const micStreamRef        = useRef<MediaStream | null>(null);
  const recognitionRef      = useRef<any>(null);
  const transcriberRef      = useRef<DeepgramTranscriber | null>(null);
  const timerIntervalRef    = useRef<NodeJS.Timeout | null>(null);
  const visualizerRef       = useRef<HTMLCanvasElement>(null);
  const animationFrameRef   = useRef<number | null>(null);
  const entryIdCounterRef   = useRef(0);
  const lastFinalIndexRef   = useRef(0);
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const transcriptEndRef    = useRef<HTMLDivElement | null>(null);
  const currentSpeakerRef   = useRef(0);
  const lastSegmentTimeRef  = useRef<number>(Date.now());
  const speakerMapRef       = useRef<Map<number, number>>(new Map());
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastInterimTextRef   = useRef('');

  // ─── Browser support ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ok = !!(
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        window.MediaRecorder &&
        window.WebSocket
      );
      setIsBrowserSupported(ok);
    }
  }, []);

  // ─── Timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (isListening && !isPaused) {
      timerIntervalRef.current = setInterval(() => setElapsedTime(p => p + 1000), 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isListening, isPaused]);

  // ─── Auto-scroll ──────────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // ─── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }
    };
  }, []);

  // ─── Visualizer ───────────────────────────────────────────────
  useEffect(() => {
    if (!analyserRef.current || !visualizerRef.current) return;
    const canvas = visualizerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray    = new Uint8Array(bufferLength);
    const smoothed     = new Array(bufferLength).fill(0);
    const barCount = 64;
    const gap      = 2;

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current!.getByteFrequencyData(dataArray);
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < bufferLength; i++) {
        smoothed[i] = smoothed[i] * 0.7 + dataArray[i] * 0.3;
      }

      const totalGap = gap * (barCount - 1);
      const barWidth = Math.max(1.5, (w - totalGap - 24) / barCount);
      const startX   = (w - (barWidth + gap) * barCount + gap) / 2;

      const spkColor = SPEAKER_COLORS[activeSpeakerIdx % SPEAKER_COLORS.length];

      for (let i = 0; i < barCount; i++) {
        const di  = Math.floor(i * bufferLength / barCount);
        const val = smoothed[di] / 255;
        const barH = Math.max(2, val * h * 0.8);
        const x = startX + i * (barWidth + gap);
        const y = (h - barH) / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, `${spkColor.text}${Math.round((0.3 + val * 0.7) * 255).toString(16).padStart(2,'0')}`);
        grad.addColorStop(1, `${spkColor.dot}${Math.round((0.15 + val * 0.5) * 255).toString(16).padStart(2,'0')}`);

        ctx.beginPath();
        const r = Math.min(barWidth / 2, 2.5);
        ctx.roundRect(x, y, barWidth, barH, r);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [analyserRef.current, activeSpeakerIdx]);

  // ─── Audio init ───────────────────────────────────────────────
  const initAudio = useCallback(async () => {
    try {
      let stream: MediaStream;

      if (audioSource === 'computer') {
        // Capture computer/system audio using Screen Capture API
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,  // Required for screen sharing
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 44100
          }
        });

        // Stop video track immediately since we only need audio
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
          stream.removeTrack(videoTrack);
        }

        // Handle user stopping the screen share
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.addEventListener('ended', () => {
            // Direct cleanup without calling stopSession to avoid circular dependency
            setIsListening(false);
            setIsPaused(false);
            try { transcriberRef.current?.stop(); } catch { /* ok */ }
            transcriberRef.current = null;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            stream?.getTracks().forEach(t => t.stop());
            if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
            setInterimText('');
            setInterimTranslation('');
            setShowSummary(true);
          });
        }
      } else {
        // Capture microphone audio
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
          }
        });
      }

      micStreamRef.current = stream;
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source  = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      return true;
    } catch (error) {
      if (audioSource === 'computer') {
        toast({ 
          variant: 'destructive', 
          title: 'Screen sharing cancelled', 
          description: 'Please select a window or tab to capture audio.' 
        });
      } else {
        toast({ 
          variant: 'destructive', 
          title: 'Microphone access denied', 
          description: 'Please allow microphone permission.' 
        });
      }
      return false;
    }
  }, [toast, audioSource]);

  // ─── Speaker detection (heuristic: silence gap → new speaker) ─
  const detectSpeakerChange = useCallback(() => {
    const now = Date.now();
    const gap = now - lastSegmentTimeRef.current;
    lastSegmentTimeRef.current = now;

    // If more than 3 seconds silence, likely new speaker
    if (gap > 3000 && speakerCount > 1) {
      const next = (currentSpeakerRef.current + 1) % speakerCount;
      currentSpeakerRef.current = next;
      setActiveSpeakerIdx(next);
    }
    return currentSpeakerRef.current;
  }, [speakerCount]);

  // ─── Translation ──────────────────────────────────────────────
  const translateText = useCallback(async (text: string, from: string, to: string): Promise<string | null> => {
    if (!text.trim() || from === to) return text;
    const key = `${from}|${to}|${text.toLowerCase().trim()}`;
    if (translationCacheRef.current.has(key)) return translationCacheRef.current.get(key)!;

    try {
      const res  = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, from, to }),
      });
      const data = await res.json();
      if (data.success && data.translated) {
        translationCacheRef.current.set(key, data.translated);
        return data.translated;
      }
    } catch { /* silent */ }
    return null;
  }, []);

  // ─── Smart Real-time Translation ───────────────────────────────
  const debouncedTranslate = useCallback(
    (text: string) => {
      // Clear previous timeout
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }

      // Don't translate if text is too short (< 3 chars)
      if (text.length < 3) {
        setInterimTranslation('');
        return;
      }

      // Smart debouncing: wait based on text length and sentence structure
      // - Short phrases: translate quickly (500ms)
      // - Medium sentences: moderate delay (800ms)
      // - Long paragraphs: longer delay (up to 2000ms)
      const hasPunctuation = /[.!?。！？]$/.test(text);
      const wordCount = text.split(/\s+/).length;
      
      let delay = 500;
      if (wordCount > 10) {
        delay = 1200;
      } else if (wordCount > 5) {
        delay = 800;
      }
      
      // If sentence ends, translate immediately (very responsive)
      if (hasPunctuation) {
        delay = 300;
      }

      translationTimeoutRef.current = setTimeout(async () => {
        if (sourceLang !== targetLang) {
          const translated = await translateText(text, sourceLang, targetLang);
          setInterimTranslation(translated || '');
        } else {
          setInterimTranslation(text);
        }
      }, delay);
    },
    [sourceLang, targetLang, translateText]
  );

  // ─── Add transcript entry ────────────────────────────────────
  const addTranscriptEntry = useCallback((original: string, speaker: number) => {
    const id  = ++entryIdCounterRef.current;
    const ts  = new Date().toTimeString().slice(0, 8);
    const spkLabel = `Speaker ${speaker + 1}`;

    const entry: TranscriptEntry = { id, timestamp: ts, original, translated: null, speakerIndex: speaker, speakerLabel: spkLabel, isTranslating: true };
    setTranscripts(prev => [...prev, entry]);

    if (sourceLang !== targetLang) {
      translateText(original, sourceLang, targetLang).then(translated => {
        setTranscripts(prev => prev.map(e => e.id === id ? { ...e, translated, isTranslating: false } : e));
      });
    } else {
      setTranscripts(prev => prev.map(e => e.id === id ? { ...e, translated: original, isTranslating: false } : e));
    }
  }, [sourceLang, targetLang, translateText]);

  // ─── Cleanup ──────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current     = null;
    micStreamRef.current    = null;
  }, []);

  const stopRecognition = useCallback(() => {
    try { transcriberRef.current?.stop(); } catch { /* ok */ }
    transcriberRef.current = null;
  }, []);

  const stopSession = useCallback(() => {
    setIsListening(false);
    setIsPaused(false);
    stopRecognition();
    stopAudio();
    setInterimText('');
    setInterimTranslation('');
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current);
      translationTimeoutRef.current = null;
    }
    setShowSummary(true);
  }, [stopRecognition, stopAudio]);

  // ─── Speech recognition ───────────────────────────────────────
  const initRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;

    const recognition = new SR();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;
    recognition.lang = getLang(sourceLang)?.speechCode || 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          if (i >= lastFinalIndexRef.current) {
            const text = result[0].transcript.trim();
            if (text) addTranscriptEntry(text);
            lastFinalIndexRef.current = i + 1;
          }
        } else {
          interim += result[0].transcript;
        }
      }
      const trimmedInterim = interim.trim();
      setInterimText(trimmedInterim);
      
      // Real-time translation of interim text
      if (trimmedInterim && trimmedInterim !== lastInterimTextRef.current) {
        lastInterimTextRef.current = trimmedInterim;
        debouncedTranslate(trimmedInterim);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') {
        toast({ variant: 'destructive', title: 'Microphone denied' });
        setIsListening(false);
        setIsPaused(false);
        stopRecognition();
        stopAudio();
        setInterimText('');
        setShowSummary(true);
      }
    };

    recognition.onend = () => {
      if (isListening && !isPaused) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognitionRef.current = recognition;
    return true;
  }, [sourceLang, isListening, isPaused, toast, addTranscriptEntry, stopRecognition, stopAudio]);

  // ─── Start session ────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (sourceLang === targetLang) {
      toast({ variant: 'destructive', title: 'Same language selected', description: 'Please choose different source and target languages.' });
      return;
    }
    setIsConnecting(true);
    const ok = await initAudio();
    if (!ok) { setIsConnecting(false); return; }

    // Build the Deepgram transcriber; its callbacks drive the live transcript.
    const transcriber = new DeepgramTranscriber({
      language: sourceLang,
      callbacks: {
        onInterim: (text, speaker) => {
          setActiveSpeakerIdx(speaker);
          setInterimText(text);
          if (text && text !== lastInterimTextRef.current) {
            lastInterimTextRef.current = text;
            debouncedTranslate(text);
          }
        },
        onFinal: (text, speaker) => {
          if (text) addTranscriptEntry(text, speaker);
          setInterimText('');
          setInterimTranslation('');
          lastInterimTextRef.current = '';
        },
        onError: (msg) => {
          toast({ variant: 'destructive', title: 'Transcription problem', description: msg });
        },
      },
    });
    transcriberRef.current = transcriber;

    try {
      await transcriber.start(micStreamRef.current!);
      setIsListening(true);
      setIsPaused(false);
      setElapsedTime(0);
      setInterimText('');
      setInterimTranslation('');
      lastInterimTextRef.current = '';
      setView('session');
      toast({
        title: '🎙 Translation Live',
        description: `${getLang(sourceLang)?.flag} ${getLang(sourceLang)?.name} → ${getLang(targetLang)?.flag} ${getLang(targetLang)?.name}`,
      });
    } catch (err) {
      transcriberRef.current = null;
      stopAudio();
      toast({ variant: 'destructive', title: 'Could not start translation', description: err instanceof Error ? err.message : 'Transcription failed to start.' });
    }
    setIsConnecting(false);
  }, [sourceLang, targetLang, initAudio, stopAudio, toast, addTranscriptEntry, debouncedTranslate]);

  // ─── Toggle pause ─────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (!isListening) return;
    if (isPaused) {
      transcriberRef.current?.resume();
      setIsPaused(false);
      setInterimText('');
      setInterimTranslation('');
    } else {
      transcriberRef.current?.pause();
      setIsPaused(true);
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
        translationTimeoutRef.current = null;
      }
    }
  }, [isListening, isPaused]);

  // ─── Mute toggle ─────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (micStreamRef.current) {
      const enabled = !isMuted;
      micStreamRef.current.getTracks().forEach(t => { t.enabled = enabled; });
      setIsMuted(!enabled);
    }
  }, [isMuted]);

  // ─── AI Summary ───────────────────────────────────────────────
  const generateSummary = useCallback(async () => {
    if (transcripts.length === 0) return;
    setIsSummarizing(true);
    setSummary(null);

    const transcript = transcripts.map(e =>
      `[${e.timestamp}] ${e.speakerLabel}: ${e.original}\n→ ${e.translated || '(translating)'}`
    ).join('\n\n');

    try {
      const res  = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summarize', transcript, sourceLang, targetLang }),
      });
      const data = await res.json();
      if (data.success) setSummary(data.summary);
    } catch { /* ok */ }
    setIsSummarizing(false);
  }, [transcripts, sourceLang, targetLang]);

  // ─── Copy / Download ──────────────────────────────────────────
  const buildText = useCallback(() => {
    const src = getLang(sourceLang), tgt = getLang(targetLang);
    let t = `LinguaLive — Meeting Transcript\n`;
    t += `Date: ${new Date().toLocaleString()}\n`;
    t += `${src?.flag} ${src?.name} → ${tgt?.flag} ${tgt?.name}\n`;
    t += `Duration: ${formatDuration(elapsedTime)}\n`;
    t += `${'─'.repeat(50)}\n\n`;
    transcripts.forEach(e => {
      t += `[${e.timestamp}] ${e.speakerLabel}\n`;
      t += `  ${src?.name}: ${e.original}\n`;
      t += `  ${tgt?.name}: ${e.translated || '(not translated)'}\n\n`;
    });
    return t;
  }, [transcripts, sourceLang, targetLang, elapsedTime]);

  const copyTranscript = useCallback(() => {
    navigator.clipboard.writeText(buildText()).then(
      () => toast({ title: 'Copied to clipboard ✓' }),
      () => toast({ variant: 'destructive', title: 'Copy failed' })
    );
  }, [buildText, toast]);

  const downloadTranscript = useCallback(() => {
    const blob = new Blob([buildText()], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `lingualive-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast({ title: 'Transcript downloaded ✓' });
  }, [buildText, toast]);

  // ─── Reset ────────────────────────────────────────────────────
  const resetToOnboarding = useCallback(() => {
    setShowSummary(false); setView('onboarding');
    setTranscripts([]); entryIdCounterRef.current = 0;
    lastFinalIndexRef.current = 0; translationCacheRef.current.clear();
    setElapsedTime(0); setInterimText(''); setInterimTranslation(''); setSummary(null);
    currentSpeakerRef.current = 0;
    lastInterimTextRef.current = '';
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current);
      translationTimeoutRef.current = null;
    }
  }, []);

  const swapLanguages = () => { setSourceLang(targetLang); setTargetLang(sourceLang); };
  const clearTranscript = () => {
    setTranscripts([]); entryIdCounterRef.current = 0; lastFinalIndexRef.current = 0;
    translationCacheRef.current.clear();
    setInterimText('');
    setInterimTranslation('');
    lastInterimTextRef.current = '';
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current);
      translationTimeoutRef.current = null;
    }
    toast({ title: 'Transcript cleared' });
  };

  const wordCount    = transcripts.reduce((s, e) => s + (e.original?.split(/\s+/).filter(Boolean).length || 0), 0);
  const srcLang      = getLang(sourceLang);
  const tgtLang      = getLang(targetLang);

  // ═══════════════════════════════════════════════════════════════
  // ─── ONBOARDING ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  if (view === 'onboarding') return (
    <>
      <div className="bg-mesh" />
      <div className="noise-overlay" />

      <div className="relative z-10 h-screen overflow-y-auto scroll-panel">
        <div className="max-w-2xl mx-auto px-5 py-12 flex flex-col items-center">

          {/* Logo */}
          <div className="fade-up fade-up-1 flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF6B35] to-[#C2410C] flex items-center justify-center shadow-lg shadow-orange-600/25">
              <Languages className="text-white w-5 h-5" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-white">LinguaLive</span>
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--brand-500)] border border-[var(--brand-600)]/40 px-1.5 py-0.5 rounded-full">AI</span>
            </div>
          </div>

          {/* Hero */}
          <div className="fade-up fade-up-2 text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight mb-4 text-white">
              Real-time translation<br />
              <span className="bg-gradient-to-r from-[#FF8F65] via-[#FF6B35] to-[#E55A25] bg-clip-text text-transparent">
                for every meeting
              </span>
            </h1>
            <p className="text-zinc-400 text-base max-w-md mx-auto leading-relaxed">
              Speak naturally in Google Meet, Teams, or Zoom — LinguaLive transcribes
              and translates in real time using Claude AI.
            </p>
          </div>

          {/* Sound wave */}
          <div className="fade-up fade-up-2 flex justify-center items-end gap-[4px] h-8 mb-10" aria-hidden>
            {[20, 32, 16, 28, 12, 34, 22, 14, 30, 20, 26, 14, 24, 18, 32].map((h, i) => (
              <div key={i} className="sound-bar" style={{ height: `${h}px`, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>

          {/* Language selector */}
          <div className="fade-up fade-up-3 w-full glass-card rounded-2xl p-5 mb-6">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-4 text-center">Choose your languages</p>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-zinc-500 mb-1.5">Meeting speaks</label>
                <Select value={sourceLang} onValueChange={setSourceLang}>
                  <SelectTrigger className="bg-[var(--surface-3)] border-[var(--surface-4)] text-zinc-100 h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--surface-2)] border-[var(--surface-4)] max-h-72">
                    {LANGUAGES.map(l => (
                      <SelectItem key={l.code} value={l.code} className="text-zinc-100 focus:bg-[var(--surface-4)]">
                        {l.flag} {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <button
                onClick={swapLanguages}
                className="swap-btn mb-0.5 w-10 h-10 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-400 hover:text-[var(--brand-400)] hover:border-[var(--brand-500)]/40 transition-colors flex-shrink-0"
                aria-label="Swap"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>

              <div className="flex-1">
                <label className="block text-xs text-zinc-500 mb-1.5">Translate to</label>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="bg-[var(--surface-3)] border-[var(--surface-4)] text-zinc-100 h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--surface-2)] border-[var(--surface-4)] max-h-72">
                    {LANGUAGES.map(l => (
                      <SelectItem key={l.code} value={l.code} className="text-zinc-100 focus:bg-[var(--surface-4)]">
                        {l.flag} {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Speaker count */}
            <div className="mt-4 pt-4 border-t border-[var(--surface-4)] flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-zinc-500" />
                  Number of speakers
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Helps with speaker labeling</p>
              </div>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => setSpeakerCount(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                      speakerCount === n
                        ? 'bg-[var(--brand-600)] text-white shadow shadow-orange-600/20'
                        : 'bg-[var(--surface-3)] text-zinc-400 hover:text-zinc-200 border border-[var(--surface-4)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <span className="text-xs text-zinc-600 ml-1">+</span>
              </div>
            </div>
          </div>

          {/* Audio Source Selector */}
          <div className="fade-up fade-up-3 w-full glass-card rounded-2xl p-5 mb-6">
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-4 text-center">Audio Source</p>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setAudioSource('mic')}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                  audioSource === 'mic'
                    ? 'bg-[var(--brand-600)]/20 border-[var(--brand-500)]'
                    : 'bg-[var(--surface-3)] border-[var(--surface-4)] hover:border-[var(--surface-5)]'
                }`}
              >
                <Mic className={`w-6 h-6 ${audioSource === 'mic' ? 'text-[var(--brand-400)]' : 'text-zinc-400'}`} />
                <div className="text-center">
                  <p className={`text-sm font-semibold ${audioSource === 'mic' ? 'text-white' : 'text-zinc-300'}`}>Microphone</p>
                  <p className={`text-[10px] ${audioSource === 'mic' ? 'text-zinc-400' : 'text-zinc-600'}`}>Speak directly</p>
                </div>
              </button>
              
              <button
                onClick={() => setAudioSource('computer')}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                  audioSource === 'computer'
                    ? 'bg-[var(--brand-600)]/20 border-[var(--brand-500)]'
                    : 'bg-[var(--surface-3)] border-[var(--surface-4)] hover:border-[var(--surface-5)]'
                }`}
              >
                <Video className={`w-6 h-6 ${audioSource === 'computer' ? 'text-[var(--brand-400)]' : 'text-zinc-400'}`} />
                <div className="text-center">
                  <p className={`text-sm font-semibold ${audioSource === 'computer' ? 'text-white' : 'text-zinc-300'}`}>Computer Audio</p>
                  <p className={`text-[10px] ${audioSource === 'computer' ? 'text-zinc-400' : 'text-zinc-600'}`}>Capture system sound</p>
                </div>
              </button>
            </div>

            {audioSource === 'computer' && (
              <div className="mt-3 p-3 rounded-lg bg-[var(--surface-4)]/30 border border-[var(--surface-4)]/50">
                <p className="text-[10px] text-zinc-400 text-center">
                  💡 Select the window or tab playing audio when prompted
                </p>
              </div>
            )}
          </div>

          {/* Platform badges */}
          <div className="fade-up fade-up-3 flex flex-wrap gap-2 justify-center mb-8">
            {[
              { name: 'Google Meet', emoji: '📹' },
              { name: 'Microsoft Teams', emoji: '💼' },
              { name: 'Zoom', emoji: '🎥' },
              { name: 'Any Platform', emoji: '🌐' },
            ].map(p => (
              <span key={p.name} className="feature-chip">
                <span>{p.emoji}</span> {p.name}
              </span>
            ))}
          </div>

          {/* How it works */}
          <div className="fade-up fade-up-4 w-full grid grid-cols-3 gap-3 mb-8">
            {(audioSource === 'mic' ? [
              { icon: Globe,     title: 'Open Meeting',     desc: 'Join your video call as usual' },
              { icon: Mic,       title: 'Start LinguaLive',  desc: 'Keep this tab open alongside' },
              { icon: Sparkles,  title: 'Read in Real-time', desc: 'Transcribe & translate live' },
            ] : [
              { icon: Globe,     title: 'Open Meeting',     desc: 'Join your video call with audio' },
              { icon: Video,     title: 'Select Window',    desc: 'Choose the tab with audio to capture' },
              { icon: Sparkles,  title: 'Read in Real-time', desc: 'System audio transcribed live' },
            ]).map((step, i) => (
              <div key={i} className="glass-card rounded-xl p-4 text-center">
                <div className="w-9 h-9 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center mx-auto mb-2.5">
                  <step.icon className="w-4 h-4 text-[var(--brand-400)]" />
                </div>
                <p className="text-xs font-semibold text-zinc-200 mb-0.5">{step.title}</p>
                <p className="text-[10px] text-zinc-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="fade-up fade-up-5 text-center">
            <button
              onClick={startSession}
              disabled={isConnecting || !isBrowserSupported}
              className="btn-start bg-gradient-to-r from-[#E55A25] to-[#FF6B35] text-white font-bold px-10 py-4 rounded-2xl text-sm shadow-xl shadow-orange-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
            >
              {isConnecting ? (
                <><span className="spinner border-white/20 border-t-white" /><span>Connecting…</span></>
              ) : !isBrowserSupported ? (
                <><MicOff className="w-4 h-4" /><span>Unsupported Browser</span></>
              ) : (
                <><Zap className="w-4 h-4" /><span>Start Translation</span></>
              )}
            </button>
            <p className="text-zinc-600 text-[11px] mt-3">
              {audioSource === 'mic' 
                ? 'Requires microphone access · Best in Chrome or Edge'
                : 'Requires screen sharing permission · Select tab/window with audio'
              }
            </p>
          </div>

        </div>
      </div>
    </>
  );

  // ═══════════════════════════════════════════════════════════════
  // ─── SESSION ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  return (
    <>
      <div className="bg-mesh" />
      <div className="noise-overlay" />

      <div className="relative z-10 h-screen flex flex-col">

        {/* ── Top Bar ── */}
        <header className="flex items-center justify-between px-4 sm:px-5 h-13 border-b border-[var(--surface-4)]/80 bg-[var(--surface)]/90 backdrop-blur-md flex-shrink-0 gap-3" style={{minHeight:'52px'}}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#C2410C] flex items-center justify-center">
              <Languages className="text-white w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-sm text-white hidden sm:inline tracking-tight">LinguaLive</span>
          </div>

          {/* Language pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs">
            <span className="text-base leading-none">{srcLang?.flag}</span>
            <span className="text-zinc-300 font-medium hidden sm:inline">{srcLang?.name}</span>
            <ArrowRightLeft className="w-3 h-3 text-zinc-600 mx-0.5" />
            <span className="text-base leading-none">{tgtLang?.flag}</span>
            <span className="text-[var(--brand-400)] font-medium hidden sm:inline">{tgtLang?.name}</span>
          </div>

          {/* Audio source indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs">
            {audioSource === 'mic' ? (
              <>
                <Mic className="w-3.5 h-3.5 text-[var(--brand-400)]" />
                <span className="text-zinc-300 font-medium hidden sm:inline">Mic</span>
              </>
            ) : (
              <>
                <Video className="w-3.5 h-3.5 text-[var(--brand-400)]" />
                <span className="text-zinc-300 font-medium hidden sm:inline">System Audio</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Status */}
            <div className="flex items-center gap-1.5">
              <div className={`live-dot ${isPaused ? 'paused' : ''}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider hidden sm:inline ${isPaused ? 'text-amber-400' : 'text-[var(--mint-400)]'}`}>
                {isPaused ? 'Paused' : 'Live'}
              </span>
            </div>
            <span className="font-mono text-xs text-zinc-500">{formatDuration(elapsedTime)}</span>

            {/* Controls */}
            <button
              onClick={toggleMute}
              className={`tooltip w-8 h-8 rounded-lg border flex items-center justify-center transition-colors text-xs ${
                isMuted
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : 'bg-[var(--surface-3)] border-[var(--surface-4)] text-zinc-400 hover:text-zinc-200'
              }`}
              data-tip={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={togglePause}
              className="tooltip w-8 h-8 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
              data-tip={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={stopSession}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold hover:bg-red-500/15 transition-colors"
            >
              <Square className="w-3 h-3" />
              <span className="hidden sm:inline">End</span>
            </button>
          </div>
        </header>

        {/* ── Visualizer ── */}
        <div className="flex-shrink-0 bg-[var(--surface-2)]/60 border-b border-[var(--surface-4)]/60" style={{height:'60px'}}>
          <canvas ref={visualizerRef} id="visualizer" style={{height:'60px'}} />
        </div>

        {/* ── Interim text with real-time translation ── */}
        <div className="flex-shrink-0 px-4 sm:px-5 py-3 bg-[var(--surface)]/50 border-b border-[var(--surface-4)]/40 min-h-[60px]">
          <div className="flex items-start gap-2 mb-1">
            {!isPaused && (
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-500)] animate-pulse flex-shrink-0 mt-2" />
            )}
            <div className="flex-1">
              <span className={`text-sm block ${interimText ? 'text-shimmer' : 'text-zinc-600 italic'}`}>
                {isPaused ? 'Translation paused — resume to continue' : (interimText || 'Listening…')}
              </span>
              {/* Real-time translation */}
              {interimText && sourceLang !== targetLang && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[var(--brand-400)] uppercase tracking-wider">
                    {tgtLang?.flag} Live Translation
                  </span>
                  <span className="text-sm text-zinc-300">
                    {interimTranslation || (
                      <span className="text-zinc-600 italic flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand-500)] animate-pulse" />
                        Translating…
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex-shrink-0 flex items-center gap-0 px-4 sm:px-5 border-b border-[var(--surface-4)]/60 bg-[var(--surface-2)]/40 relative">
          {([
            { id: 'split',      label: 'Split View' },
            { id: 'original',   label: `Original (${srcLang?.flag})` },
            { id: 'translated', label: `Translated (${tgtLang?.flag})` },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setTabView(tab.id)}
              className={`relative px-4 py-2.5 text-xs font-semibold transition-colors ${
                tabView === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {tabView === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--brand-500)] rounded-t-sm" />
              )}
            </button>
          ))}

          {/* Toolbar right */}
          <div className="ml-auto flex items-center gap-1.5 py-1.5">
            <button
              onClick={clearTranscript}
              className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
              data-tip="Clear"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              onClick={copyTranscript}
              className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
              data-tip="Copy"
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={downloadTranscript}
              className="tooltip w-7 h-7 rounded-lg bg-[var(--surface-3)] border border-[var(--surface-4)] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
              data-tip="Download"
            >
              <Download className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* ── Transcript area ── */}
        <div className="flex-1 overflow-hidden">

          {/* SPLIT VIEW */}
          {tabView === 'split' && (
            <div className="h-full grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--surface-4)]/60">
              {/* Original */}
              <div className="flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--surface-4)]/40 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                    {srcLang?.flag} Original · {srcLang?.name}
                  </span>
                  <span className="text-[10px] text-zinc-700">{transcripts.length} segments</span>
                </div>
                <div className="flex-1 scroll-panel px-4 py-3 space-y-3">
                  {transcripts.length === 0 ? (
                    <EmptyState icon={<Mic className="w-6 h-6" />} text="Waiting for speech…" />
                  ) : transcripts.map(entry => (
                    <OriginalEntry key={entry.id} entry={entry} />
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              </div>

              {/* Translated */}
              <div className="flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--surface-4)]/40 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                    {tgtLang?.flag} Translation · {tgtLang?.name}
                  </span>
                  <span className="text-[10px] text-zinc-700">{wordCount} words</span>
                </div>
                <div className="flex-1 scroll-panel px-4 py-3 space-y-3">
                  {transcripts.length === 0 ? (
                    <EmptyState icon={<Sparkles className="w-6 h-6" />} text="Translations appear here…" />
                  ) : transcripts.map(entry => (
                    <TranslatedEntry key={entry.id} entry={entry} />
                  ))}
                  <div />
                </div>
              </div>
            </div>
          )}

          {/* ORIGINAL ONLY */}
          {tabView === 'original' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 scroll-panel px-5 py-4 space-y-3">
                {transcripts.length === 0 ? (
                  <EmptyState icon={<Mic className="w-8 h-8" />} text="Waiting for speech…" large />
                ) : transcripts.map(entry => (
                  <OriginalEntry key={entry.id} entry={entry} large />
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          )}

          {/* TRANSLATED ONLY */}
          {tabView === 'translated' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 scroll-panel px-5 py-4 space-y-3">
                {transcripts.length === 0 ? (
                  <EmptyState icon={<Sparkles className="w-8 h-8" />} text="Translations appear here…" large />
                ) : transcripts.map(entry => (
                  <TranslatedEntry key={entry.id} entry={entry} large />
                ))}
                <div />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <footer className="flex-shrink-0 flex items-center justify-between px-4 sm:px-5 h-10 border-t border-[var(--surface-4)]/60 bg-[var(--surface)]/80 backdrop-blur-md text-[11px] text-zinc-600">
          <div className="flex items-center gap-3">
            <span>{transcripts.length} segments</span>
            <span className="text-zinc-700">·</span>
            <span>{wordCount} words</span>
            {speakerCount > 1 && <span className="text-zinc-700">· {speakerCount} speakers</span>}
          </div>
          <div className="flex items-center gap-1">
            <div className={`live-dot w-[5px] h-[5px] ${isPaused ? 'paused' : ''}`} style={{width:'5px',height:'5px'}} />
            <span className={isPaused ? 'text-amber-500' : 'text-[var(--mint-400)]'}>
              {isPaused ? 'Paused' : 'Live'} · Claude AI
            </span>
          </div>
        </footer>
      </div>

      {/* ═══ SUMMARY MODAL ═══ */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="bg-[var(--surface-2)] border-[var(--surface-4)] text-white max-w-lg p-0 overflow-hidden">
          <div className="p-6 border-b border-[var(--surface-4)]">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-[var(--mint-500)]/10 border border-[var(--mint-500)]/20 flex items-center justify-center">
                  <Check className="text-[var(--mint-400)] w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold">Session Complete</DialogTitle>
                  <p className="text-zinc-500 text-xs mt-0.5">Meeting translation finished</p>
                </div>
              </div>
            </DialogHeader>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Duration',  value: formatDuration(elapsedTime) },
                { label: 'Segments',  value: String(transcripts.length) },
                { label: 'Words',     value: String(wordCount) },
              ].map(s => (
                <div key={s.label} className="stat-card">
                  <div className="text-lg font-bold text-[var(--brand-400)]">{s.value}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Summary */}
          <div className="p-5 max-h-72 overflow-y-auto scroll-panel">
            {!summary && !isSummarizing && (
              <button
                onClick={generateSummary}
                disabled={transcripts.length === 0}
                className="btn-start w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#E55A25]/20 to-[#FF6B35]/20 border border-[var(--brand-600)]/30 text-[var(--brand-400)] text-sm font-semibold flex items-center justify-center gap-2 hover:from-[#E55A25]/30 hover:to-[#FF6B35]/30 transition-all disabled:opacity-40"
              >
                <Wand2 className="w-4 h-4" /> Generate AI Meeting Summary
              </button>
            )}

            {isSummarizing && (
              <div className="flex items-center gap-3 py-4 text-zinc-500">
                <span className="spinner" /> Analyzing meeting with Claude AI…
              </div>
            )}

            {summary && (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1.5">Overview</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{summary.summary}</p>
                </div>
                {summary.keyPoints?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1.5">Key Points</p>
                    <ul className="space-y-1">
                      {summary.keyPoints.map((pt, i) => (
                        <li key={i} className="flex gap-2 text-sm text-zinc-400">
                          <span className="text-[var(--brand-500)] font-bold mt-0.5">·</span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.actionItems?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1.5">Action Items</p>
                    <ul className="space-y-1">
                      {summary.actionItems.map((item, i) => (
                        <li key={i} className="flex gap-2 text-sm text-zinc-400">
                          <Check className="w-3.5 h-3.5 text-[var(--mint-400)] mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.topics?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.topics.map((t, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-full bg-[var(--surface-4)] text-zinc-400 text-[10px] font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-5 pt-0 grid grid-cols-3 gap-2">
            <button
              onClick={copyTranscript}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs font-semibold text-zinc-300 hover:text-white hover:border-[var(--surface-5)] transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button
              onClick={downloadTranscript}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[var(--surface-3)] border border-[var(--surface-4)] text-xs font-semibold text-zinc-300 hover:text-white hover:border-[var(--surface-5)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
            <button
              onClick={resetToOnboarding}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-[#E55A25] to-[#FF6B35] text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function EmptyState({ icon, text, large }: { icon: React.ReactNode; text: string; large?: boolean }) {
  return (
    <div className={`h-full flex flex-col items-center justify-center text-zinc-700 ${large ? 'py-16' : 'py-10'}`}>
      <div className="opacity-30 mb-2">{icon}</div>
      <p className={`${large ? 'text-sm' : 'text-xs'}`}>{text}</p>
    </div>
  );
}

function SpeakerBadge({ entry }: { entry: TranscriptEntry }) {
  const color = SPEAKER_COLORS[entry.speakerIndex % SPEAKER_COLORS.length];
  return (
    <span className="spk-badge" style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color.dot }} />
      {entry.speakerLabel}
    </span>
  );
}

function OriginalEntry({ entry, large }: { entry: TranscriptEntry; large?: boolean }) {
  return (
    <div className="transcript-entry space-y-1">
      <div className="flex items-center gap-2">
        <SpeakerBadge entry={entry} />
        <span className="font-mono text-[9px] text-zinc-700">{entry.timestamp}</span>
      </div>
      <p className={`${large ? 'text-base' : 'text-sm'} text-zinc-200 leading-relaxed`}>{entry.original}</p>
    </div>
  );
}

function TranslatedEntry({ entry, large }: { entry: TranscriptEntry; large?: boolean }) {
  const color = SPEAKER_COLORS[entry.speakerIndex % SPEAKER_COLORS.length];
  return (
    <div className="transcript-entry space-y-1">
      <div className="flex items-center gap-2">
        <SpeakerBadge entry={entry} />
        <span className="font-mono text-[9px] text-zinc-700">{entry.timestamp}</span>
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
