#!/usr/bin/env node
/**
 * Processes web/logo-raw.png → transparent icon.png (512), apple-icon.png (180),
 * public/logo.png (256), and regenerates opengraph-image.png.
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

// ── Step 1: trim dark background ─────────────────────────────────────────────
const trimmed = await sharp(input)
  .trim({ background: '#000000', threshold: 30 })
  .toBuffer();

// ── Step 2: get raw RGB pixels of trimmed image ───────────────────────────────
const { data: px, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
const { width: kw, height: kh, channels } = info;

// ── Step 3: key out near-black → alpha 0; soft edge zone ─────────────────────
//   Background max-brightness ≈ 0–2; K fill ≈ 252; threshold range 20–55
const rgba = Buffer.alloc(kw * kh * 4);
for (let i = 0; i < kw * kh; i++) {
  const r = px[i * channels];
  const g = px[i * channels + 1];
  const b = px[i * channels + 2];
  rgba[i * 4]     = r;
  rgba[i * 4 + 1] = g;
  rgba[i * 4 + 2] = b;
  const bright = Math.max(r, g, b);
  if (bright <= 20) {
    rgba[i * 4 + 3] = 0;
  } else if (bright < 55) {
    rgba[i * 4 + 3] = Math.round(((bright - 20) / 35) * 255);
  } else {
    rgba[i * 4 + 3] = 255;
  }
}

// ── Step 4: add transparent padding so K fills ~85% of frame ─────────────────
const maxDim = Math.max(kw, kh);
const pad = Math.round(maxDim * (7.5 / 85));

// Flush extend to PNG first — chaining extend+resize from raw buffer in one
// sharp pipeline produces wrong dimensions; the two-step version is correct.
const extendedPng = await sharp(rgba, { raw: { width: kw, height: kh, channels: 4 } })
  .extend({ top: pad, bottom: pad, left: pad, right: pad,
            background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

async function makeIcon(size, outPath) {
  await sharp(extendedPng).resize(size, size).png().toFile(outPath);
  console.log(`  ✓ ${outPath}`);
}

await makeIcon(512, path.join(webDir, 'app/icon.png'));
await makeIcon(180, path.join(webDir, 'app/apple-icon.png'));
await makeIcon(256, path.join(webDir, 'public/logo.png'));

// ── OG image (1200×630) ──────────────────────────────────────────────────────
const W = 1200, H = 630;
const AMBER  = '#f5a623';
const MUTED  = '#a3a3a3';
const TEXT   = '#e8e8e8';
const CODEBG = '#111111';
const BORDER = '#2a2a2a';

const svgBase = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <text x="80" y="232"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="108" font-weight="700" letter-spacing="-4" fill="${AMBER}"
  >killcord</text>
  <text x="80" y="308"
    font-family="ui-sans-serif,system-ui,-apple-system,sans-serif"
    font-size="34" fill="${MUTED}"
  >Semantic circuit breaker for AI agent loops.</text>
  <rect x="80" y="360" width="560" height="72" rx="8"
    fill="${CODEBG}" stroke="${BORDER}" stroke-width="1.5"/>
  <text x="110" y="403"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="28" fill="${MUTED}">$</text>
  <text x="144" y="403"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="28" fill="${TEXT}">npm install -g killcord</text>
  <text x="${W - 80}" y="${H - 48}"
    font-family="ui-monospace,'Cascadia Code','JetBrains Mono',monospace"
    font-size="22" fill="${MUTED}" text-anchor="end"
  >github.com/landonelder2410/killcord</text>
</svg>`);

// Logo 110×110, top-left above the wordmark
const logoBuf = await sharp(extendedPng).resize(110, 110).png().toBuffer();

const ogPath = path.join(webDir, 'app/opengraph-image.png');
await sharp(svgBase)
  .composite([{ input: logoBuf, top: 42, left: 80 }])
  .png()
  .toFile(ogPath);

console.log(`  ✓ ${ogPath}`);
