import Stripe                from 'stripe';
import { Router }            from 'express';
import cors                  from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { rateLimitMiddleware } from './rate-limit';
import {
  generateLicenseKey,
  createLicense,
  getLicenseBySession,
  getLicenseByKey,
  setLicenseStatus,
  saveLicenseState,
  getLicenseStore,
} from './license-db';

// ── Stripe client ──────────────────────────────────────────────────────────

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

// ── Tier routing ───────────────────────────────────────────────────────────

const TIER_ENV_KEYS: Record<string, string> = {
  developer: 'STRIPE_PRICE_ID_DEVELOPER',
  growth:    'STRIPE_PRICE_ID_GROWTH',
  scale:     'STRIPE_PRICE_ID_SCALE',
};

function resolveTierPriceId(tier: string): string | undefined {
  const envKey = TIER_ENV_KEYS[tier.toLowerCase()];
  return envKey ? (process.env[envKey]?.trim() || undefined) : undefined;
}

// ── Allowed-price guard ────────────────────────────────────────────────────

function getAllowedPrices(): Set<string> {
  const listed = (process.env.STRIPE_ALLOWED_PRICE_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const tiers  = Object.values(TIER_ENV_KEYS)
    .map(k => process.env[k]?.trim() ?? '').filter(Boolean);
  const single = process.env.STRIPE_PRICE_ID?.trim();
  return new Set([...listed, ...tiers, ...(single ? [single] : [])]);
}

// ── IPC broadcast helper ───────────────────────────────────────────────────
// Workers call this after mutating the license store so the primary can
// persist and rebroadcast the updated snapshot to all sibling workers.
// In single-process mode this is a no-op (process.send is undefined).

function broadcastLicenseUpdate(): void {
  if (typeof process.send === 'function') {
    process.send({ type: 'license_upsert', store: getLicenseStore() });
  } else {
    saveLicenseState();
  }
}

// ── Request body shape ─────────────────────────────────────────────────────

interface CheckoutBody {
  tier?:          string;
  priceId?:       string;
  mode?:          'subscription' | 'payment';
  customerEmail?: string;
  quantity?:      number;
}

// ── Webhook handler ────────────────────────────────────────────────────────
// Exported separately so index.ts can mount it with express.raw() BEFORE
// express.json() is applied globally — Stripe signature verification
// requires the unmodified raw request body.

export function createWebhookHandler() {
  return async function stripeWebhook(req: Request, res: Response): Promise<void> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      res.status(400).json({
        error:   'webhook_not_configured',
        message: 'Set STRIPE_WEBHOOK_SECRET to enable webhook processing.',
      });
      return;
    }

    const sig = req.headers['stripe-signature'] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: 'missing_signature' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[killcord] Stripe webhook signature verification failed:', msg);
      res.status(400).json({ error: 'invalid_signature', message: msg });
      return;
    }

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const key     = session.metadata?.licenseKey;

          if (!key) {
            console.warn('[killcord] checkout.session.completed with no licenseKey in metadata', session.id);
            break;
          }

          const existing = getLicenseBySession(session.id);
          if (existing) {
            // Already activated via /key endpoint — just confirm status
            setLicenseStatus(key, 'active');
          } else {
            createLicense({
              key,
              sessionId:  session.id,
              customerId: typeof session.customer === 'string' ? session.customer : '',
              email:      session.customer_details?.email ?? session.customer_email ?? '',
              tier:       session.metadata?.tier ?? 'developer',
              status:     'active',
              trialEnd:   null,
            });
          }

          broadcastLicenseUpdate();
          console.log(`[killcord] License activated via webhook: ${key.slice(0, 16)}… tier=${session.metadata?.tier ?? '?'}`);
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const meta = sub.metadata as Record<string, string> | undefined;
          const key  = meta?.licenseKey;
          if (key) {
            setLicenseStatus(key, 'revoked');
            broadcastLicenseUpdate();
            console.log(`[killcord] License revoked (subscription deleted): ${key.slice(0, 16)}…`);
          }
          break;
        }

        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          if (sub.status === 'canceled' || sub.status === 'unpaid') {
            const meta = sub.metadata as Record<string, string> | undefined;
            const key  = meta?.licenseKey;
            if (key) {
              setLicenseStatus(key, 'revoked');
              broadcastLicenseUpdate();
              console.log(`[killcord] License revoked (subscription ${sub.status}): ${key.slice(0, 16)}…`);
            }
          }
          break;
        }

        default:
          // Ignore other event types — we don't need to handle them
          break;
      }
    } catch (err) {
      console.error('[killcord] Webhook handler error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'webhook_handler_error' });
      return;
    }

    res.json({ received: true });
  };
}

// ── Router factory ─────────────────────────────────────────────────────────

export function billingRouter(): Router {
  const router = Router();

  /**
   * POST /checkout
   *
   * Creates a Stripe Checkout Session. Generates a unique license key for this
   * customer and embeds it in the session metadata so it survives the redirect.
   * The key is activated in our store either via the webhook
   * (checkout.session.completed) or via GET /key below.
   */
  router.post('/checkout', rateLimitMiddleware(10, 60_000, 'checkout'), async (req: Request, res: Response): Promise<void> => {
    if (process.env.KILLCORD_BILLING_ENABLED !== 'true') {
      res.status(503).json({
        error:   'billing_disabled',
        message: 'Billing is not enabled on this instance. Set KILLCORD_BILLING_ENABLED=true to enable.',
      });
      return;
    }

    const allowed = getAllowedPrices();

    if (allowed.size === 0) {
      res.status(503).json({
        error:   'billing_unavailable',
        message: 'Configure STRIPE_PRICE_ID_DEVELOPER / _GROWTH / _SCALE to enable billing.',
      });
      return;
    }

    const body     = req.body as CheckoutBody;
    let priceId    = (body.priceId ?? process.env.STRIPE_PRICE_ID ?? '').trim();
    const mode     = body.mode === 'payment' ? 'payment' : 'subscription';
    const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));

    if (body.tier !== undefined) {
      const resolved = resolveTierPriceId(body.tier);
      if (!resolved) {
        res.status(400).json({
          error:   'invalid_tier',
          message: 'Unknown tier. Valid values: developer, growth, scale.',
        });
        return;
      }
      priceId = resolved;
    }

    if (!priceId) {
      res.status(400).json({ error: 'missing_price', message: '`tier` or `priceId` is required.' });
      return;
    }

    if (!allowed.has(priceId)) {
      res.status(400).json({ error: 'invalid_price', message: 'Unrecognised price ID.' });
      return;
    }

    // Generate a unique license key for this customer now, before the session
    // is created. We embed it in the Stripe metadata so we can retrieve it on
    // the success page without waiting for the webhook to fire.
    const licenseKey = generateLicenseKey();

    // The success URL includes {CHECKOUT_SESSION_ID} which Stripe replaces with
    // the real session ID. The success page uses it to retrieve the license key.
    const baseSuccessUrl = (process.env.STRIPE_SUCCESS_URL ?? 'http://localhost:3000/success')
      .replace(/\/+$/, '');
    const successUrl = `${baseSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = process.env.STRIPE_CANCEL_URL ?? 'http://localhost:3000?checkout=cancelled';

    try {
      const session = await getStripe().checkout.sessions.create({
        mode,
        line_items:                 [{ price: priceId, quantity }],
        ...(body.customerEmail      ? { customer_email: body.customerEmail } : {}),
        ...(mode === 'subscription' ? { subscription_data: { trial_period_days: 7 } } : {}),
        success_url:                successUrl,
        cancel_url:                 cancelUrl,
        allow_promotion_codes:      true,
        billing_address_collection: 'required',
        tax_id_collection:          { enabled: true },
        metadata: {
          source:     'killcord',
          tier:       body.tier ?? '',
          licenseKey,
        },
      });

      console.log(`[killcord] Checkout session created: ${session.id} tier=${body.tier ?? '?'} key=${licenseKey.slice(0, 16)}…`);

      res.status(201).json({ url: session.url });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[killcord] Stripe checkout error:', message);
      res.status(502).json({ error: 'stripe_error', message });
    }
  });

  /**
   * GET /key?session_id=cs_live_...
   *
   * Called by the success page immediately after checkout. Retrieves the
   * session from Stripe, verifies it is complete, and returns the license key
   * embedded in the metadata. Also activates the key in our store so proxy
   * requests can be validated immediately (the webhook may not have fired yet).
   *
   * Open to cross-origin requests (cors *) because only the customer who
   * completed checkout knows the session_id; the key is not sensitive beyond
   * that scope.
   */
  router.get('/key', cors({ origin: '*' }), async (req: Request, res: Response): Promise<void> => {
    if (process.env.KILLCORD_BILLING_ENABLED !== 'true') {
      res.status(503).json({ error: 'billing_disabled' });
      return;
    }
    const sessionId = (req.query['session_id'] as string | undefined)?.trim();

    if (!sessionId) {
      res.status(400).json({ error: 'missing_session_id', message: 'Provide ?session_id=...' });
      return;
    }

    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);

      if (session.status !== 'complete') {
        res.status(202).json({
          error:   'pending',
          message: 'Checkout not yet complete. Please wait a moment and try again.',
        });
        return;
      }

      const licenseKey = session.metadata?.licenseKey;
      if (!licenseKey) {
        res.status(404).json({
          error:   'key_not_found',
          message: 'No license key found for this session. Open an issue at https://github.com/landonelder2410/killcord/issues',
        });
        return;
      }

      // Activate the key in our store if not already present (success page arrived
      // before the webhook fired, which is normal — webhooks can lag 1–10 seconds).
      if (!getLicenseBySession(sessionId) && !getLicenseByKey(licenseKey)) {
        createLicense({
          key:        licenseKey,
          sessionId,
          customerId: typeof session.customer === 'string' ? session.customer : '',
          email:      session.customer_details?.email ?? session.customer_email ?? '',
          tier:       session.metadata?.tier ?? 'developer',
          status:     'active',
          trialEnd:   null,
        });
        broadcastLicenseUpdate();
        console.log(`[killcord] License activated via /key endpoint: ${licenseKey.slice(0, 16)}… tier=${session.metadata?.tier ?? '?'}`);
      }

      res.json({
        key:   licenseKey,
        tier:  session.metadata?.tier ?? 'developer',
        email: session.customer_details?.email ?? session.customer_email ?? '',
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[killcord] /key lookup error:', message);
      res.status(502).json({ error: 'stripe_error', message });
    }
  });

  return router;
}
