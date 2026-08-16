#!/usr/bin/env node
/**
 * Provision the Aether Proxy product and three-tier pricing in Stripe.
 *
 * Usage (run from the project root):
 *   npx tsx scripts/setup-stripe.ts
 *
 * Reads STRIPE_SECRET_KEY from .env (or the system environment).
 * Must be sk_live_... — this script targets your production account.
 *
 * On success:
 *   • Creates (or reuses) the "Aether Proxy" product
 *   • Creates three monthly recurring prices: Developer / Growth / Scale
 *   • Writes STRIPE_PRICE_ID_DEVELOPER / _GROWTH / _SCALE into .env
 *   • Prints all three IDs in bold for copy-paste into Vercel
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import Stripe                          from 'stripe';

// ── Bootstrap .env ─────────────────────────────────────────────────────────
// Parses the .env file without requiring the dotenv package.
function loadDotenv(filePath: string): void {
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const t  = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // No .env file — fall through to system environment
  }
}

loadDotenv(join(process.cwd(), '.env'));

// ── Guard ──────────────────────────────────────────────────────────────────
const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
if (!secretKey.startsWith('sk_live_')) {
  console.error('\n✗  STRIPE_SECRET_KEY must start with sk_live_ — this script targets production.\n');
  process.exit(1);
}

const stripe = new Stripe(secretKey);

// ── Tier definitions ───────────────────────────────────────────────────────
const PRODUCT_NAME = 'Aether Proxy';

const TIERS = [
  { label: 'Developer', envKey: 'STRIPE_PRICE_ID_DEVELOPER', unitAmount:  4900 },
  { label: 'Growth',    envKey: 'STRIPE_PRICE_ID_GROWTH',    unitAmount: 19900 },
  { label: 'Scale',     envKey: 'STRIPE_PRICE_ID_SCALE',     unitAmount: 49900 },
] as const;

// ── Terminal helpers ───────────────────────────────────────────────────────
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── .env upsert ────────────────────────────────────────────────────────────
// Replaces an existing KEY=value line, or appends a new one.
function upsertEnvLine(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content.trimEnd() + `\n${key}=${value}\n`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${bold('Provisioning Aether Proxy in Stripe LIVE mode...')}\n`);

  // ── Product ──────────────────────────────────────────────────────────────
  let product: Stripe.Product;

  const found = await stripe.products.search({
    query: `name:"${PRODUCT_NAME}" active:"true"`,
    limit: 1,
  });

  if (found.data.length > 0) {
    product = found.data[0];
    console.log(`  ${dim('Product (reused):')} ${product.id}`);
  } else {
    product = await stripe.products.create({
      name:        PRODUCT_NAME,
      description: 'Semantic MCP gateway — eliminates schema bloat between AI agents and LLM APIs.',
      metadata:    { source: 'setup-stripe-script' },
    });
    console.log(`  ${green('Product created:')}  ${product.id}`);
  }

  console.log();

  // ── Prices ───────────────────────────────────────────────────────────────
  type Result = { label: string; envKey: string; priceId: string; amount: string };
  const results: Result[] = [];

  for (const tier of TIERS) {
    const price = await stripe.prices.create({
      product:     product.id,
      unit_amount: tier.unitAmount,
      currency:    'usd',
      recurring:   { interval: 'month' },
      nickname:    `${PRODUCT_NAME} — ${tier.label}`,
      metadata:    { tier: tier.label.toLowerCase(), source: 'setup-stripe-script' },
    });

    const amount = `$${(tier.unitAmount / 100).toFixed(2)}/mo`;
    console.log(`  ${green('✓')} ${tier.label.padEnd(11)} ${dim(amount.padEnd(12))} ${price.id}`);
    results.push({ label: tier.label, envKey: tier.envKey, priceId: price.id, amount });
  }

  // ── Inject into .env ─────────────────────────────────────────────────────
  const envPath = join(process.cwd(), '.env');
  let envContent = '';
  try { envContent = readFileSync(envPath, 'utf8'); } catch { /* new file */ }

  for (const { envKey, priceId } of results) {
    envContent = upsertEnvLine(envContent, envKey, priceId);
  }
  writeFileSync(envPath, envContent, 'utf8');

  console.log(`\n  ${green('✓')} .env updated (STRIPE_PRICE_ID_DEVELOPER / _GROWTH / _SCALE)\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const bar = '─'.repeat(51);
  console.log(bold(bar));
  console.log(bold('  Copy these to your Vercel Dashboard:'));
  console.log(bold(bar));
  console.log();
  for (const { envKey, priceId, amount } of results) {
    console.log(`  ${bold(`${envKey}=${priceId}`)}  ${dim(amount)}`);
  }
  console.log();
  console.log(`  ${dim('Product:  ' + product.id)}`);
  console.log(`  ${dim('Stripe dashboard: https://dashboard.stripe.com/products/' + product.id)}`);
  console.log();
}

main().catch(err => {
  console.error('\n✗  Setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
