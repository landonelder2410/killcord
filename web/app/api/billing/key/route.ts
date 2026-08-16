import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (process.env.KILLCORD_BILLING_ENABLED !== 'true') {
    return NextResponse.json({ error: 'billing_disabled' }, { status: 503 });
  }

  const sessionId = req.nextUrl.searchParams.get('session_id')?.trim();

  if (!sessionId) {
    return NextResponse.json(
      { error: 'missing_session_id', message: 'Provide ?session_id=...' },
      { status: 400 },
    );
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.status !== 'complete') {
      return NextResponse.json(
        { error: 'pending', message: 'Checkout not yet complete. Please wait a moment.' },
        { status: 202 },
      );
    }

    const licenseKey = session.metadata?.licenseKey;
    if (!licenseKey) {
      return NextResponse.json(
        { error: 'key_not_found', message: 'No license key for this session. Open an issue at https://github.com/landonelder2410/killcord/issues.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      key:   licenseKey,
      tier:  session.metadata?.tier ?? 'developer',
      email: session.customer_details?.email ?? (session.customer_email ?? ''),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[killcord] /api/billing/key error:', message);
    return NextResponse.json({ error: 'stripe_error', message }, { status: 502 });
  }
}
