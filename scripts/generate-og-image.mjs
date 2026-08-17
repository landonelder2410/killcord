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

// Geometric K mark — viewBox 0 0 20 24, scaled ×4, offset (80, 48)
// Shape 1 (upper): stem-top + upper arm, cut by diagonal gap
// Shape 2 (lower): stem-bottom + lower arm, cut by diagonal gap
const S = 4, MX = 80, MY = 48;
const pt = ([x, y]) => `${MX + x * S},${MY + y * S}`;
const s1 = [[0,0],[5,0],[20,0],[20,5],[10,9],[5,8.5],[0,8]].map(pt).join(' ');
const s2 = [[0,10],[0,24],[5,24],[20,24],[20,17],[5,11],[5,10.5]].map(pt).join(' ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Geometric K mark -->
  <polygon points="${s1}" fill="${AMBER}"/>
  <polygon points="${s2}" fill="${AMBER}"/>

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
