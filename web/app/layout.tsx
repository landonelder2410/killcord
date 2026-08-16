import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
