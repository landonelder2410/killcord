import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Killcord — Stop runaway AI agent loops';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        background: '#ffffff',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '80px 80px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 56,
          fontWeight: 800,
          fontFamily: 'ui-monospace, monospace',
          color: '#111827',
          letterSpacing: '-2px',
          marginBottom: 20,
        }}
      >
        killcord
      </div>
      <div style={{ fontSize: 28, color: '#374151', marginBottom: 40, lineHeight: 1.4 }}>
        Semantic circuit breaker for AI agent loops.
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '14px 24px',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 22,
          color: '#374151',
        }}
      >
        <span style={{ color: '#9ca3af', marginRight: 12 }}>$</span>
        npm install -g killcord
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          right: 80,
          fontSize: 18,
          color: '#9ca3af',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        github.com/landonelder2410/killcord
      </div>
    </div>,
    { ...size }
  );
}
