'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const GITHUB = 'https://github.com/landonelder2410/killcord';

type State =
  | { phase: 'loading' }
  | { phase: 'free' }
  | { phase: 'success'; key: string; tier: string; email: string }
  | { phase: 'pending' }
  | { phase: 'error'; message: string };

export function SuccessContent() {
  const params    = useSearchParams();
  const sessionId = params.get('session_id');
  const isFree    = params.get('free') === 'true';

  const [state, setState] = useState<State>(isFree ? { phase: 'free' } : { phase: 'loading' });
  const [copied, setCopied] = useState(false);
  const attemptsRef = useRef(0);

  useEffect(() => {
    // Free tier — no session needed
    if (isFree) return;

    if (!sessionId) {
      const id = setTimeout(() => {
        setState({
          phase: 'error',
          message: 'No session ID in URL. Check your email for your license key or open an issue at https://github.com/landonelder2410/killcord/issues.',
        });
      }, 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;

    async function poll(): Promise<void> {
      if (cancelled) return;
      try {
        const res  = await fetch(`/api/billing/key?session_id=${encodeURIComponent(sessionId!)}`);
        const body = await res.json() as Record<string, string>;

        if (cancelled) return;

        if (res.status === 202 && body.error === 'pending') {
          attemptsRef.current += 1;
          if (attemptsRef.current < 6) {
            setState({ phase: 'pending' });
            setTimeout(poll, 2_000);
          } else {
            setState({
              phase: 'error',
              message: 'Checkout is taking longer than expected. Check your email or open an issue at https://github.com/landonelder2410/killcord/issues.',
            });
          }
          return;
        }

        if (!res.ok) {
          setState({ phase: 'error', message: body.message ?? `Unexpected error (${res.status})` });
          return;
        }

        setState({ phase: 'success', key: body.key, tier: body.tier ?? 'developer', email: body.email ?? '' });

      } catch (err) {
        if (!cancelled) {
          setState({ phase: 'error', message: err instanceof Error ? err.message : 'Network error — please try again.' });
        }
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [sessionId, isFree]);

  async function copyKey(key: string): Promise<void> {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  // ── Free tier ────────────────────────────────────────────────────────────
  if (state.phase === 'free') {
    return (
      <div className="success-wrap">
        <div className="success-icon success-icon--ok">✓</div>
        <h1 className="success-heading">You&apos;re ready — start building!</h1>
        <p className="success-sub">
          You&apos;re on the Free / Hacker plan. Self-host Killcord and
          start cutting token costs today — no credit card, no expiry.
        </p>

        <div className="success-tier-badge">Free / Hacker plan</div>

        <section className="success-quickstart">
          <p className="success-qs-label">Get up and running in 60 seconds</p>
          <pre className="success-code-block">{`# 1. Install globally
$ npm install -g killcord

# 2. Start the proxy
$ killcord

# 3. Point your client here
ANTHROPIC_BASE_URL=http://localhost:8080`}</pre>
        </section>

        <div className="success-links">
          <Link href="/#pricing" className="success-link">Upgrade your plan →</Link>
          <a href={`${GITHUB}/blob/main/API.md`} className="success-link" target="_blank" rel="noopener noreferrer">API reference →</a>
          <a href={GITHUB} className="success-link" target="_blank" rel="noopener noreferrer">GitHub →</a>
        </div>
      </div>
    );
  }

  // ── Loading / pending ────────────────────────────────────────────────────
  if (state.phase === 'loading' || state.phase === 'pending') {
    return (
      <div className="success-wrap">
        <div className="success-spinner" aria-label="Loading" />
        <p className="success-status">
          {state.phase === 'pending' ? 'Finalising your subscription…' : 'Loading your license key…'}
        </p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state.phase === 'error') {
    return (
      <div className="success-wrap">
        <div className="success-icon success-icon--error">✕</div>
        <h1 className="success-heading">Something went wrong</h1>
        <p className="success-sub">{state.message}</p>
        <a className="success-cta" href="https://github.com/landonelder2410/killcord/issues">Open an issue →</a>
      </div>
    );
  }

  // ── Paid success ─────────────────────────────────────────────────────────
  const { key, tier, email } = state;

  const snippet =
`import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="https://YOUR_PROXY_URL",
    default_headers={"x-killcord-key": "${key}"},
)`;

  return (
    <div className="success-wrap">
      <div className="success-icon success-icon--ok">✓</div>

      <h1 className="success-heading">You&apos;re in — trial started!</h1>
      <p className="success-sub">
        Your 7-day free trial is active. No charge until the trial ends.
        {email && <> Receipt sent to <strong>{email}</strong>.</>}
      </p>

      <div className="success-tier-badge">{tier.charAt(0).toUpperCase() + tier.slice(1)} plan</div>

      <section className="success-key-box" aria-label="License key">
        <p className="success-key-label">Your license key — save this now</p>
        <div className="success-key-row">
          <code className="success-key-code">{key}</code>
          <button
            className="success-copy-btn"
            type="button"
            onClick={() => copyKey(key)}
            aria-label="Copy license key"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="success-key-note">
          This key is shown once. Store it securely — treat it like a password.
        </p>
      </section>

      <section className="success-quickstart">
        <p className="success-qs-label">Quick start — add the header to your client</p>
        <pre className="success-code-block">{snippet}</pre>
      </section>

      <div className="success-links">
        <a href={`${GITHUB}/blob/main/API.md`} className="success-link" target="_blank" rel="noopener noreferrer">API reference →</a>
        <a href={GITHUB} className="success-link" target="_blank" rel="noopener noreferrer">GitHub →</a>
        <a href="https://github.com/landonelder2410/killcord/issues" className="success-link">Support →</a>
      </div>
    </div>
  );
}
