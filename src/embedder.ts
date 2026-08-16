/**
 * Shared MiniLM-L6-v2 embedder — a single model instance reused by both the
 * semantic tool filter (router.ts) and the semantic loop detector
 * (circuit-breaker.ts). There is exactly one model loaded per process.
 *
 * The model resolves lazily on first use and stays resident. warmup() is
 * called at server startup so the ~90 MB download happens before real traffic.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline, env } = require('@xenova/transformers');

try {
  env.backends.onnx.wasm.numThreads = 4;
} catch (_) {
  // Older versions may not expose this config; safe to ignore
}

export type EmbedPipeline = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

// Promise-based singleton — concurrent callers before the model resolves all
// await the same promise instead of each starting a fresh download.
let _embedderPromise: Promise<EmbedPipeline> | null = null;
let _ready = false;

export function getEmbedder(): Promise<EmbedPipeline> {
  if (!_embedderPromise) {
    _embedderPromise = (async () => {
      console.log('[killcord] Loading embedding model (first run downloads ~90 MB to cache)...');
      try {
        const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        _ready = true;
        console.log('[killcord] Embedding model ready.');
        return model as EmbedPipeline;
      } catch (err) {
        // Reset so a later call can retry rather than caching a rejected promise.
        _embedderPromise = null;
        throw err;
      }
    })();
  }
  return _embedderPromise;
}

/**
 * True once the model has finished loading. Used by the semantic loop detector
 * to fail open (skip semantic detection) rather than block a request behind a
 * cold-start download.
 */
export function isEmbedderReady(): boolean {
  return _ready;
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder();
  const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return output.data;
}

// Dot product of two L2-normalized vectors == cosine similarity.
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export async function warmup(): Promise<void> {
  await getEmbedder();
}
