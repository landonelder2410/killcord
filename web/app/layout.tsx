import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const SpaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['400', '500', '600', '700'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL('https://killcord.vercel.app'),
  title: 'Killcord — Stop runaway AI agent loops',
  description:
    'Local proxy that detects and trips semantic circuit breakers on AI agent loops. ' +
    'Catches tool-name rotation attacks that exact-match misses. ' +
    'Runs on your machine — no prompts or API keys leave your infrastructure.',
  openGraph: {
    title: 'Killcord — Stop runaway AI agent loops',
    description:
      'Agents that loop don\'t stop — they burn budget until something else breaks. ' +
      'Killcord embeds the meaning of each tool call so rotating names doesn\'t help.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${SpaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
