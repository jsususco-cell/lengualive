import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LinguaLive — AI Real-Time Meeting Translator",
  description: "Real-time AI translation for Google Meet, Microsoft Teams, and Zoom. Break language barriers in every meeting.",
  keywords: ["translation", "AI", "meeting", "real-time", "Google Meet", "Teams", "Zoom", "Filipino", "Tagalog"],
  openGraph: {
    title: "LinguaLive — AI Meeting Translator",
    description: "Real-time AI translation powered by Claude",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0C0C0F] text-[#F4F4F5] overflow-hidden h-screen`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
