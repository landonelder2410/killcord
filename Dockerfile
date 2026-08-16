# ── Stage 1: builder ─────────────────────────────────────────────────────────
# Install all dependencies (including devDeps) and compile TypeScript.
# Build image — node:24-slim provides glibc required by onnxruntime-node
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
# Install production dependencies only, copy compiled output from builder.
# src/ is intentionally absent — only dist/ is needed at runtime.
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 8080

# Run as the built-in non-root node user for least-privilege execution.
USER node

CMD ["node", "dist/index.js"]
