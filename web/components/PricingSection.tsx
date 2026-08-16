'use client';

import { useState } from 'react';

// ── Paid core tiers ────────────────────────────────────────────────────────

type PaidTier = 'developer' | 'growth' | 'scale';

interface TierDef {
  key:      PaidTier;
  label:    string;
  price:    string;
  desc:     string;
  features: string[];
  featured: boolean;
}

const TIERS: TierDef[] = [
  {
    key:      'developer',
    label:    'Developer',
    price:    '29',
    desc:     'For solo devs and small teams shipping their first agentic products.',
    features: [
      'Up to 50K requests / month',
      'Semantic MCP tool filtering',
      'PII redaction',
      'Agent Replay Viewer (read-only)',
      'Prometheus metrics endpoint',
      'Community support',
    ],
    featured: false,
  },
  {
    key:      'growth',
    label:    'Growth',
    price:    '99',
    desc:     'For scaling teams with high-frequency agentic workloads.',
    features: [
      'Up to 500K requests / month',
      'Everything in Developer',
      'Redis-backed rate limiting',
      'Multi-core cluster mode',
      'Agent Replay Visualizer Pro',
      'Executive ROI dashboard',
      'Email support',
    ],
    featured: true,
  },
  {
    key:      'scale',
    label:    'Scale',
    price:    '299',
    desc:     'For enterprises running production AI infrastructure at scale.',
    features: [
      'Unlimited requests',
      'Everything in Growth',
      '30-day trace storage',
      'Air-gapped local routing',
      'Custom webhook integrations',
      'SLA & dedicated support',
      'Compliance package',
    ],
    featured: false,
  },
];

// ── Standalone add-ons ─────────────────────────────────────────────────────

type AddonKey = 'replay_pro' | 'replay_pro_oneshot' | 'storage_pack';

interface AddonDef {
  monthlyKey: AddonKey;
  oneshotKey?: AddonKey;
  label:      string;
  tagline:    string;
  priceMonth: string;
  priceOne?:  string;
  features:   string[];
}

const ADDONS: AddonDef[] = [
  {
    monthlyKey: 'replay_pro',
    oneshotKey: 'replay_pro_oneshot',
    label:      'Agent Replay Visualizer Pro',
    tagline:    'Embed the full trace viewer in your own dashboards.',
    priceMonth: '19',
    priceOne:   '49',
    features: [
      'Embeddable React component (npm)',
      'Custom branding / white-label',
      'Step diff & timeline view',
      'Export traces as JSON / NDJSON',
      'Your infra, your data',
    ],
  },
  {
    monthlyKey: 'storage_pack',
    label:      '30-Day Trace Storage Pack',
    tagline:    'Extended log retention for compliance and post-mortems.',
    priceMonth: '15',
    features: [
      '30-day rolling trace retention',
      'Compressed NDJSON archive',
      'REST API for trace retrieval',
      'Audit-friendly CSV / JSON export',
      'Works with any Aether plan',
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export function PricingSection() {
  const [loading, setLoading] = useState<string | null>(null);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  async function startCheckout(body: Record<string, string>): Promise<void> {
    const key = body.tier ?? body.addon ?? 'unknown';
    setLoading(key);
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });

    try {
      const res = await fetch('/api/checkout/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const payload = await res.json() as { url?: string; message?: string };

      if (!res.ok || !payload.url) {
        throw new Error(payload.message ?? `Server error (${res.status})`);
      }

      window.location.assign(payload.url);
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'Something went wrong — please try again.',
      }));
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <section id="pricing" className="pricing">
      <p className="section-label">Pricing</p>
      <h2 className="section-title">One product, three ways to pay</h2>
      <p className="section-sub">
        Start free and self-host forever. Upgrade for managed infrastructure,
        SLAs, and compliance — or pick only the modules you actually need.
      </p>

      <div className="trial-banner">
        <span className="trial-banner-icon">🎁</span>
        <span>
          <strong>7-day free trial on all paid plans</strong>
          {' '}— no credit card charged until your trial ends. Cancel any time.
        </span>
      </div>

      {/* ── Core plans (Free + 3 paid) ──────────────────── */}
      <div className="pricing-grid">
        {/* Free / Hacker — no Stripe, navigates straight to success */}
        <div className="pricing-card pricing-card--free">
          <span className="free-pill">Always free</span>
          <p className="pricing-tier">Free / Hacker</p>
          <div className="pricing-price">
            <span className="pricing-amount">
              <span className="pricing-currency">$</span>0
            </span>
            <span className="pricing-period">/ mo</span>
          </div>
          <p className="pricing-desc">
            Open-source build — self-host on any machine, no managed infra, no
            billing.
          </p>
          <ul className="pricing-features" aria-label="Free plan features">
            {[
              '10K requests / month',
              'Semantic MCP tool filtering',
              'Basic Agent Replay Viewer',
              'Standard rate limits',
              'MIT licence — keep the code',
            ].map(f => (
              <li key={f} className="pricing-feature">{f}</li>
            ))}
          </ul>
          <a className="btn-subscribe btn-subscribe--free" href="/success/?free=true">
            Get Started Free
          </a>
          <p className="trial-note">No credit card · No expiry</p>
        </div>

        {/* Paid tiers */}
        {TIERS.map(tier => {
          const isLoading = loading === tier.key;
          const tierError = errors[tier.key];

          return (
            <div
              key={tier.key}
              className={`pricing-card${tier.featured ? ' featured' : ''}`}
            >
              <span className="trial-pill">7-day free trial</span>
              {tier.featured && (
                <span className="pricing-badge">Most popular</span>
              )}
              <p className="pricing-tier">{tier.label}</p>
              <div className="pricing-price">
                <span className="pricing-amount">
                  <span className="pricing-currency">$</span>
                  {tier.price}
                </span>
                <span className="pricing-period">/ mo</span>
              </div>
              <p className="pricing-desc">{tier.desc}</p>
              <ul className="pricing-features" aria-label={`${tier.label} features`}>
                {tier.features.map(f => (
                  <li key={f} className="pricing-feature">{f}</li>
                ))}
              </ul>
              <button
                className="btn-subscribe"
                disabled={busy}
                onClick={() => startCheckout({ tier: tier.key })}
                aria-busy={isLoading}
              >
                {isLoading ? 'Loading…' : 'Start free trial'}
              </button>
              <p className="trial-note">No charge for 7 days · Cancel anytime</p>
              {tierError && (
                <p className="pricing-error" role="alert">{tierError}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Modular add-ons ──────────────────────────────── */}
      <div className="addons">
        <div className="addons-header">
          <p className="section-label" style={{ marginBottom: 8 }}>Modular Add-Ons</p>
          <h3 className="addons-title">Buy only what you need</h3>
          <p className="addons-sub">
            Standalone products that slot into any plan — or work entirely on
            their own.
          </p>
        </div>

        <div className="addon-grid">
          {ADDONS.map(addon => {
            const monthlyLoading = loading === addon.monthlyKey;
            const oneshotLoading = loading === addon.oneshotKey;
            const addonError     = errors[addon.monthlyKey] ?? errors[addon.oneshotKey ?? ''];

            return (
              <div key={addon.monthlyKey} className="addon-card">
                <div className="addon-meta">
                  <p className="addon-label">{addon.label}</p>
                  <p className="addon-tagline">{addon.tagline}</p>
                </div>

                <ul className="pricing-features addon-features" aria-label={`${addon.label} features`}>
                  {addon.features.map(f => (
                    <li key={f} className="pricing-feature">{f}</li>
                  ))}
                </ul>

                <div className="addon-cta">
                  <div className="addon-price-row">
                    <span className="addon-price-main">
                      ${addon.priceMonth}
                      <span className="addon-price-period">/mo</span>
                    </span>
                    {addon.priceOne && (
                      <span className="addon-price-divider">or</span>
                    )}
                    {addon.priceOne && (
                      <span className="addon-price-alt">
                        ${addon.priceOne} one-time
                      </span>
                    )}
                  </div>

                  <div className="addon-btn-row">
                    <button
                      className="btn-addon btn-addon--monthly"
                      disabled={busy}
                      onClick={() => startCheckout({ addon: addon.monthlyKey })}
                      aria-busy={monthlyLoading}
                    >
                      {monthlyLoading ? 'Loading…' : `Subscribe $${addon.priceMonth}/mo`}
                    </button>
                    {addon.oneshotKey && addon.priceOne && (
                      <button
                        className="btn-addon btn-addon--oneshot"
                        disabled={busy}
                        onClick={() => startCheckout({ addon: addon.oneshotKey! })}
                        aria-busy={oneshotLoading}
                      >
                        {oneshotLoading ? 'Loading…' : `Buy once $${addon.priceOne}`}
                      </button>
                    )}
                  </div>

                  {addonError && (
                    <p className="pricing-error" role="alert">{addonError}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
