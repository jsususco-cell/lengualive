'use client';

// ─── Floating live-translation widget (Document Picture-in-Picture) ──
// Pops the live translation out into a real, always-on-top OS window
// (via the Document Picture-in-Picture API) so the viewer can keep the
// captions on top of the actual meeting window or any other app.
//
// It re-uses the data already streaming into <LiveMeeting>; it does NOT
// open its own WebSocket. The parent owns `desiredOpen`; this component
// reports the real window state back through `onOpenChange` so a failed
// open (e.g. no user gesture, unsupported browser) falls back to the
// inline transcript without surfacing an error.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ─── Document PiP isn't in the standard DOM lib yet ────────────────
interface DocumentPiP {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPiP;
  }
}

export function pipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

// Kept in sync with LiveMeeting's palette.
const SPEAKER_COLORS = [
  { text: '#FF8F65', dot: '#FF6B35' },
  { text: '#34D399', dot: '#10B981' },
  { text: '#60A5FA', dot: '#3B82F6' },
  { text: '#A78BFA', dot: '#7C3AED' },
  { text: '#FBBF24', dot: '#D97706' },
  { text: '#F472B6', dot: '#DB2777' },
];

export interface Caption {
  speaker: number;
  original: string;
  translated: string | null;
}

interface FloatingTranslatorProps {
  desiredOpen: boolean;
  onOpenChange: (open: boolean) => void;
  latest: Caption | null;
  previous: Caption | null;
  interim: { text: string; speaker: number } | null;
  live: boolean;
  sourceFlag: string;
  targetFlag: string;
}

// The PiP window is a separate document, so it doesn't inherit the
// dashboard's stylesheet. We inject a small self-contained sheet to
// stay bulletproof across dev/prod build differences.
const PIP_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0C0C0F;
    color: #e4e4e7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  .lt-root { display: flex; flex-direction: column; height: 100%; padding: 12px 14px; }
  .lt-header {
    display: flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 600; letter-spacing: .02em;
    color: #71717a; flex-shrink: 0;
  }
  .lt-dot { width: 8px; height: 8px; border-radius: 50%; background: #3f3f46; }
  .lt-dot.live { background: #34D399; animation: lt-pulse 1.6s ease-in-out infinite; }
  @keyframes lt-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  .lt-langs { margin-left: auto; font-size: 13px; letter-spacing: 0; }
  .lt-body {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    justify-content: flex-end; gap: 6px; padding-top: 10px;
  }
  .lt-prev { font-size: 13px; line-height: 1.35; color: #52525b;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .lt-spk { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    display: inline-flex; align-items: center; gap: 5px; }
  .lt-spk-dot { width: 6px; height: 6px; border-radius: 50%; }
  .lt-translated { font-size: 21px; line-height: 1.3; font-weight: 600; margin-top: 4px; }
  .lt-original { font-size: 12px; line-height: 1.35; color: #71717a; margin-top: 5px; }
  .lt-interim { font-size: 13px; line-height: 1.35; color: #a1a1aa; font-style: italic;
    margin-top: 7px; opacity: .9; }
  .lt-empty { font-size: 13px; color: #52525b; text-align: center; margin: auto 0; }
`;

export default function FloatingTranslator({
  desiredOpen, onOpenChange, latest, previous, interim, live, sourceFlag, targetFlag,
}: FloatingTranslatorProps) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const openingRef = useRef(false);

  const close = useCallback(() => {
    try { pipWindow?.close(); } catch { /* ignore */ }
  }, [pipWindow]);

  // Open / close the PiP window in response to the parent's wish.
  useEffect(() => {
    if (desiredOpen && !pipWindow && !openingRef.current) {
      const pip = window.documentPictureInPicture;
      if (!pip) { onOpenChange(false); return; }
      openingRef.current = true;
      pip.requestWindow({ width: 380, height: 250 })
        .then((win) => {
          const style = win.document.createElement('style');
          style.textContent = PIP_CSS;
          win.document.head.appendChild(style);
          win.document.title = 'LinguaLive';
          // The OS close button fires pagehide on the PiP document.
          win.addEventListener('pagehide', () => { setPipWindow(null); onOpenChange(false); });
          setPipWindow(win);
          onOpenChange(true);
        })
        .catch(() => { onOpenChange(false); })   // no gesture / blocked → fall back inline
        .finally(() => { openingRef.current = false; });
    } else if (!desiredOpen && pipWindow) {
      close();
      setPipWindow(null);
      onOpenChange(false);
    }
  }, [desiredOpen, pipWindow, onOpenChange, close]);

  // Make sure the floating window never outlives the meeting view.
  useEffect(() => () => { try { pipWindow?.close(); } catch { /* ignore */ } }, [pipWindow]);

  if (!pipWindow) return null;

  const color = latest ? SPEAKER_COLORS[latest.speaker % SPEAKER_COLORS.length] : SPEAKER_COLORS[0];

  return createPortal(
    <div className="lt-root">
      <div className="lt-header">
        <span className={`lt-dot${live ? ' live' : ''}`} />
        <span>{live ? 'Live' : 'Connecting…'}</span>
        <span className="lt-langs">{sourceFlag} → {targetFlag}</span>
      </div>

      <div className="lt-body">
        {!latest && !interim && (
          <div className="lt-empty">Waiting for speech…</div>
        )}

        {previous?.translated && (
          <div className="lt-prev">{previous.translated}</div>
        )}

        {latest && (
          <div>
            <span className="lt-spk" style={{ color: color.text }}>
              <span className="lt-spk-dot" style={{ background: color.dot }} />
              Speaker {latest.speaker + 1}
            </span>
            <div className="lt-translated" style={{ color: color.text }}>
              {latest.translated ?? latest.original}
            </div>
            {latest.translated && <div className="lt-original">{latest.original}</div>}
          </div>
        )}

        {interim && (
          <div className="lt-interim">{interim.text}</div>
        )}
      </div>
    </div>,
    pipWindow.document.body,
  );
}
