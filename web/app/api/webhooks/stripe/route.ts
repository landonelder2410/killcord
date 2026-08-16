import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key);
}

// Next.js App Router passes the raw body when using req.text() — no body
// parser middleware intercepts it, so Stripe signature verification works.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 400 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[aether] Stripe signature verification failed:', msg);
    return NextResponse.json({ error: 'invalid_signature', message: msg }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(
        `[aether] checkout.session.completed: ${session.id} ` +
        `tier=${session.metadata?.tier ?? '?'} ` +
        `key=${(session.metadata?.licenseKey ?? '').slice(0, 16)}…`,
      );
      break;
    }
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated': {
      const sub  = event.data.object as Stripe.Subscription;
      const meta = sub.metadata as Record<string, string> | undefined;
      if (meta?.licenseKey) {
        console.log(`[aether] Subscription ${event.type}: key=${meta.licenseKey.slice(0, 16)}… status=${sub.status}`);
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
