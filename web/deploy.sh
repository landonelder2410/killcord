#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "▶ Installing dependencies..."
npm install

echo "▶ Building..."
npm run build

echo "▶ Deploying to Vercel (production)..."
npx vercel --prod --yes

echo "✓ Deployed."
