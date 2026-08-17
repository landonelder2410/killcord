#!/usr/bin/env node
/**
 * Processes web/logo-raw.png → icon.png, apple-icon.png, public/logo.png,
 * and regenerates opengraph-image.png.
 * Run from web/: node ../scripts/process-logo.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const sharp     = require(path.join(__dirname, '../web/node_modules/sharp'));

const webDir = path.join(__dirname, '../web');
const input  = path.join(webDir, 'logo-raw.png');

// ── Trim black background, add near-black padding so K fills ~85% ───────────
const trimmed = await sharp(input)
  .trim({ background: '#000000', threshold: 30 })
  .toBuffer({ resolveWithObject: true });

const { width: kw, height: kh } = trimmed.info;
const maxDim = Math.max(kw, kh);
// pad = 7.5% of final frame = 7.5/85 of the K dimension
const pad = Math.round(maxDim * (7.5 / 85));

const base = () =>
  sharp(trimmed.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad,
              background: '#0d0d0d' });

async function makeIcon(size, outPath) {
  await base().resize(size, size, { fit: 'fill' }).png().toFile(outPath);
  console.log(`  ✓ ${outPath}`);
}

await makeIcon(512, path.join(webDir, 'app/icon.png'));
await makeIcon(180, path.join(webDir, 'app/apple-icon.png'));
await makeIcon(256, path.join(webDir, 'public/logo.png'));

// ── OG image (1200×630) ─────────────────────────────────────────────────────
const W = 1200, H = 630;
const AMBER = '#f5a623';
const MUTED = '#a3a3a3';
const TEXT  = '#e8e8e8';
const CODEBG = '#1e1e1e';
const BORDER = '#363636';

// Logo at 120×120 in upper-left
const logoSize  = 120;
const logoBuf   = await base().resize(logoSize, logoSize, { fit: 'fill' }).png().toBuffer();

const baseSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0d0d0d"/>

  <text x="80" y="236"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="108" font-weight="700" letter-spacing="-4" fill="${AMBER}"
  >killcord</text>

  <text x="80" y="312"
    font-family="ui-sans-serif,system-ui,-apple-system,sans-serif"
    font-size="34" fill="${MUTED}"
  >Semantic circuit breaker for AI agent loops.</text>

  <rect x="80" y="364" width="560" height="72" rx="8"
    fill="${CODEBG}" stroke="${BORDER}" stroke-width="1.5"/>
  <text x="110" y="407"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="28" fill="${MUTED}">$</text>
  <text x="144" y="407"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="28" fill="${TEXT}">npm install -g killcord</text>

  <text x="${W - 80}" y="${H - 48}"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="22" fill="${MUTED}" text-anchor="end"
  >github.com/landonelder2410/killcord</text>
</svg>`);

const ogPath = path.join(webDir, 'app/opengraph-image.png');

await sharp(baseSvg)
  .composite([{ input: logoBuf, top: 40, left: 80 }])
  .png()
  .toFile(ogPath);

console.log(`  ✓ ${ogPath}`);
