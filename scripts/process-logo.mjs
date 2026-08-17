#!/usr/bin/env node
/**
 * Processes web/logo-raw.png into:
 *   web/app/icon.png        512×512  — amber K on #0a0a0a rounded square
 *   web/app/apple-icon.png  180×180  — same
 *   web/public/logo.png     256×256  — transparent, for in-page use
 *   web/app/opengraph-image.png
 *
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

// ── Step 1: ensureAlpha + raw pixel pass ────────────────────────────────────
// ensureAlpha adds an alpha=255 channel to the flat RGB source.
// Raw pass: r < 60 AND g < 60 AND b < 60 → alpha = 0 (black bg keyed out).
// Amber pixels (r ≈ 252, g ≈ 162, b ≈ 11) all have r > 60, so they stay.
const { data: px, info } = await sharp(input)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width: W, height: H } = info; // channels is 4 after ensureAlpha

for (let i = 0; i < W * H; i++) {
  if (px[i*4] < 60 && px[i*4+1] < 60 && px[i*4+2] < 60) {
    px[i*4+3] = 0;
  }
}

// ── Verify ──────────────────────────────────────────────────────────────────
const corner = { r: px[0], g: px[1], b: px[2], a: px[3] };
let amberFound = null;
for (let i = 0; i < W * H; i++) {
  if (px[i*4] > 200 && px[i*4+3] === 255) {
    amberFound = { r: px[i*4], g: px[i*4+1], b: px[i*4+2], a: px[i*4+3] };
    break;
  }
}
console.log('corner alpha:', corner.a, '— expected 0');
console.log('first amber pixel:', JSON.stringify(amberFound), '— expected a=255');

// ── Step 2: find bounding box of non-transparent pixels ─────────────────────
let minX = W, maxX = 0, minY = H, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (px[(y*W+x)*4+3] > 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const kw = maxX - minX + 1, kh = maxY - minY + 1;
console.log(`K bounding box: ${kw}×${kh} at (${minX},${minY})`);

// ── Step 3: extract K, add transparent padding so K fills ~85% ──────────────
const maxDim = Math.max(kw, kh);
const pad    = Math.round(maxDim * (7.5 / 85));

// Extract → PNG buffer (avoids the raw→chain resize bug in sharp)
const kPng = await sharp(px, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: minX, top: minY, width: kw, height: kh })
  .png()
  .toBuffer();

// Extend with transparent padding → PNG buffer
const extPng = await sharp(kPng)
  .extend({ top: pad, bottom: pad, left: pad, right: pad,
            background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

// ── Step 4: logo.png — transparent, 256×256 ──────────────────────────────────
await sharp(extPng)
  .resize(256, 256)
  .png()
  .toFile(path.join(webDir, 'public/logo.png'));
console.log('  ✓ public/logo.png (transparent)');

// ── Step 5: favicon versions — K on dark rounded square ─────────────────────
async function makeIconWithBg(size, outPath) {
  const radius = Math.round(size * 0.22);   // 22% corner radius
  const kSize  = Math.round(size * 0.70);   // K fills 70% of frame
  const offset = Math.round((size - kSize) / 2);

  // Dark rounded-rect backdrop via SVG
  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#000000"/>` +
    `</svg>`
  );

  const kBuf = await sharp(extPng).resize(kSize, kSize).png().toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4,
                          background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: bgSvg },
      { input: kBuf, top: offset, left: offset },
    ])
    .png()
    .toFile(outPath);
  console.log(`  ✓ ${outPath}`);
}

await makeIconWithBg(512, path.join(webDir, 'app/icon.png'));
await makeIconWithBg(180, path.join(webDir, 'app/apple-icon.png'));

// ── Step 6: OG image (1200×630) ──────────────────────────────────────────────
const W_OG = 1200, H_OG = 630;
const AMBER = '#f5a623', MUTED = '#a3a3a3', TEXT = '#e8e8e2';
const CODEBG = '#111111', BORDER = '#2a2a2a';

const svgBase = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W_OG}" height="${H_OG}">` +
  `<rect width="${W_OG}" height="${H_OG}" fill="#000000"/>` +
  `<text x="80" y="232" font-family="ui-monospace,'Cascadia Code',monospace" ` +
    `font-size="108" font-weight="700" letter-spacing="-4" fill="${AMBER}">killcord</text>` +
  `<text x="80" y="308" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="34" fill="${MUTED}">Semantic circuit breaker for AI agent loops.</text>` +
  `<rect x="80" y="360" width="560" height="72" rx="8" fill="${CODEBG}" stroke="${BORDER}" stroke-width="1.5"/>` +
  `<text x="110" y="403" font-family="ui-monospace,'Cascadia Code',monospace" ` +
    `font-size="28" fill="${MUTED}">$</text>` +
  `<text x="144" y="403" font-family="ui-monospace,'Cascadia Code',monospace" ` +
    `font-size="28" fill="${TEXT}">npm install -g killcord</text>` +
  `<text x="${W_OG - 80}" y="${H_OG - 48}" font-family="ui-monospace,'Cascadia Code',monospace" ` +
    `font-size="22" fill="${MUTED}" text-anchor="end">github.com/landonelder2410/killcord</text>` +
  `</svg>`
);

const logoBuf = await sharp(extPng).resize(110, 110).png().toBuffer();
const ogPath  = path.join(webDir, 'app/opengraph-image.png');

await sharp(svgBase)
  .composite([{ input: logoBuf, top: 42, left: 80 }])
  .png()
  .toFile(ogPath);
console.log(`  ✓ ${ogPath}`);
