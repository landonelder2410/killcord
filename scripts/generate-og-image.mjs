#!/usr/bin/env node
/**
 * Generates web/app/opengraph-image.png (1200×630).
 * Run from repo root: node scripts/generate-og-image.mjs
 * Requires: sharp (already in web/node_modules)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

let sharp;
try {
  sharp = require(path.join(__dirname, '../web/node_modules/sharp'));
} catch {
  sharp = require('sharp');
}

const W = 1200;
const H = 630;

const BG     = '#0d0d0d';
const AMBER  = '#f5a623';
const TEXT   = '#e8e8e8';
const MUTED  = '#a3a3a3';
const CODEBG = '#1e1e1e';
const BORDER = '#363636';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Mark: vertical stem + detached chevron, viewBox 0 0 100 100 scaled to 90×90 -->
  <svg x="80" y="40" width="90" height="90" viewBox="0 0 100 100">
    <rect x="14" y="10" width="18" height="80" fill="${AMBER}"/>
    <path d="M86 10 L52 50 L86 90" stroke="${AMBER}" stroke-width="18"
          stroke-linejoin="miter" fill="none"/>
  </svg>

  <!-- Wordmark -->
  <text
    x="80" y="240"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="108"
    font-weight="700"
    letter-spacing="-4"
    fill="${AMBER}"
  >killcord</text>

  <!-- Tagline -->
  <text
    x="80" y="316"
    font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
    font-size="34"
    fill="${MUTED}"
  >Semantic circuit breaker for AI agent loops.</text>

  <!-- Install command block -->
  <rect x="80" y="368" width="560" height="72" rx="8" fill="${CODEBG}" stroke="${BORDER}" stroke-width="1.5"/>
  <text
    x="110" y="411"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="28"
    fill="${MUTED}"
  >$</text>
  <text
    x="144" y="411"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="28"
    fill="${TEXT}"
  >npm install -g killcord</text>

  <!-- Bottom-right attribution -->
  <text
    x="${W - 80}" y="${H - 48}"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="22"
    fill="${MUTED}"
    text-anchor="end"
  >github.com/landonelder2410/killcord</text>
</svg>`;

const outPath = path.join(__dirname, '../web/app/opengraph-image.png');

await sharp(Buffer.from(svg)).png().toFile(outPath);

console.log(`Generated: ${outPath}`);
