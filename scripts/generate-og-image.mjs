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

// Prefer sharp from web/node_modules, fall back to root
let sharp;
try {
  sharp = require(path.join(__dirname, '../web/node_modules/sharp'));
} catch {
  sharp = require('sharp');
}

const W = 1200;
const H = 630;

const BG      = '#0d0d0d';
const AMBER   = '#f5a623';
const TEXT    = '#e8e8e8';
const MUTED   = '#a3a3a3';
const CODEBG  = '#1e1e1e';
const BORDER  = '#363636';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Broken-circuit icon (scaled up) — 3x the favicon, left of wordmark -->
  <!-- Left segment -->
  <rect x="80" y="120" width="58" height="20" rx="6" fill="${AMBER}"/>
  <!-- Right segment -->
  <rect x="154" y="120" width="58" height="20" rx="6" fill="${AMBER}"/>

  <!-- Wordmark -->
  <text
    x="80" y="220"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="108"
    font-weight="700"
    letter-spacing="-4"
    fill="${AMBER}"
  >killcord</text>

  <!-- Tagline -->
  <text
    x="80" y="296"
    font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
    font-size="34"
    fill="${MUTED}"
  >Semantic circuit breaker for AI agent loops.</text>

  <!-- Install command block -->
  <rect x="80" y="352" width="560" height="72" rx="8" fill="${CODEBG}" stroke="${BORDER}" stroke-width="1.5"/>
  <text
    x="110" y="395"
    font-family="ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace"
    font-size="28"
    fill="${MUTED}"
  >$</text>
  <text
    x="144" y="395"
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
