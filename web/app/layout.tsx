import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Killcord — Stop Paying the Tools Tax',
  description:
    'Local semantic gateway that cuts AI API costs by 90%. Intercepts MCP tool schemas, runs vector search locally, forwards only what the LLM needs.',
  openGraph: {
    title: 'Killcord',
    description: 'Stop Paying the Tools Tax. Cut AI API costs by 90%.',
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
