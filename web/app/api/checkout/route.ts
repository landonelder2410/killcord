import Stripe         from 'stripe';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

// ── Price ID maps ──────────────────────────────────────────────────────────

const TIER_PRICE_IDS: Record<string, string | undefined> = {
  developer: process.env.STRIPE_PRICE_ID_DEVELOPER,
  growth:    process.env.STRIPE_PRICE_ID_GROWTH,
  scale:     process.env.STRIPE_PRICE_ID_SCALE,
};

// Add-on price IDs — set in .env.local / Vercel environment.
// replay_pro_oneshot is a one-time payment; all others are subscriptions.
const ADDON_PRICE_IDS: Record<string, string | undefined> = {
  replay_pro:         process.env.STRIPE_PRICE_ID_ADDON_REPLAY_PRO,
  replay_pro_oneshot: process.env.STRIPE_PRICE_ID_ADDON_REPLAY_PRO_ONESHOT,
  storage_pack:       process.env.STRIPE_PRICE_ID_ADDON_STORAGE_PACK,
};

const ADDON_ONE_TIME = new Set(['replay_pro_oneshot']);

// ── Helpers ────────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key);
}

function baseUrl(req: NextRequest): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host  = req.headers.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.KILLCORD_BILLING_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'billing_disabled', message: 'Billing is not enabled on this instance.' },
      { status: 503 },
    );
  }

  const body = await req.json() as { tier?: string; addon?: string };
  const origin    = baseUrl(req);
  const successUrl = `${origin}/success/?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${origin}/#pricing`;

  // ── Add-on purchase ──────────────────────────────────────────────────────
  if (body.addon) {
    const addonKey = body.addon.toLowerCase().trim();
    const priceId  = ADDON_PRICE_IDS[addonKey];

    if (!priceId) {
      return NextResponse.json(
        {
          message:
            `The "${addonKey}" add-on isn't live yet — ` +
            'open an issue at https://github.com/OWNER/killcord/issues to be notified on launch.',
        },
        { status: 503 },
      );
    }

    const isOneTime  = ADDON_ONE_TIME.has(addonKey);
    const licenseKey = `kc_${randomBytes(32).toString('hex')}`;

    try {
      const session = await getStripe().checkout.sessions.create({
        mode:       isOneTime ? 'payment' : 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        ...(isOneTime ? {} : { subscription_data: { trial_period_days: 7 } }),
        success_url:                successUrl,
        cancel_url:                 cancelUrl,
        allow_promotion_codes:      true,
        billing_address_collection: 'required',
        metadata: { source: 'killcord', addon: addonKey, licenseKey },
      });

      return NextResponse.json({ url: session.url }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[killcord] Stripe addon checkout error:', message);
      return NextResponse.json({ message }, { status: 502 });
    }
  }

  // ── Core tier purchase ───────────────────────────────────────────────────
  const tier    = (body.tier ?? '').toLowerCase().trim();
  const priceId = TIER_PRICE_IDS[tier];

  if (!priceId) {
    return NextResponse.json(
      { message: 'Invalid tier. Valid values: developer, growth, scale.' },
      { status: 400 },
    );
  }

  const licenseKey = `kc_${randomBytes(32).toString('hex')}`;

  try {
    const session = await getStripe().checkout.sessions.create({
      mode:                       'subscription',
      line_items:                 [{ price: priceId, quantity: 1 }],
      subscription_data:          { trial_period_days: 7 },
      success_url:                successUrl,
      cancel_url:                 cancelUrl,
      allow_promotion_codes:      true,
      billing_address_collection: 'required',
      tax_id_collection:          { enabled: true },
      metadata: { source: 'killcord', tier, licenseKey },
    });

    return NextResponse.json({ url: session.url }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[killcord] Stripe checkout error:', message);
    return NextResponse.json({ message }, { status: 502 });
  }
}
