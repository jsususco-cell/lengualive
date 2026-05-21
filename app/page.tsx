'use client';

import dynamic from 'next/dynamic';

// LinguaLive is a fully browser-dependent app: it uses the Web Speech API,
// AudioContext, getUserMedia, and the Screen Capture API. None of that can run
// on the server, so the UI is loaded client-only (`ssr: false`). This keeps the
// Next.js production build from ever trying to prerender browser-only code.
const LinguaLive = dynamic(() => import('@/components/LinguaLive'), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center text-zinc-600 text-sm">
      Loading LinguaLive...
    </div>
  ),
});

export default function Page() {
  return <LinguaLive />;
}
