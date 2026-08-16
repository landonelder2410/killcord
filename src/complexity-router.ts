/**
 * Request complexity classifier for dynamic model routing.
 *
 * Simple requests  → local/quantized model (low latency, zero cloud cost)
 * Complex requests → primary cloud LLM API (best reasoning quality)
 *
 * Routing is opt-in via AUTO_ROUTE=true env var. When disabled, complexity
 * is still computed and exposed as the X-Killcord-Complexity response header
 * so downstream observers can act on it.
 */
import { recordComplexity } from './telemetry';

export type Complexity = 'simple' | 'complex';

export interface ComplexityResult {
  complexity: Complexity;
  score:      number;
  reasons:    string[];
}

// Phrases that strongly suggest multi-step reasoning or code generation.
// Note: uses stem prefixes (analyz*, synthesi*, etc.) without a trailing \b so
// that "analyze", "analyzing", "synthesize" etc. all match.
const COMPLEX_RE = /\b(analyz|synthesi|reason|evaluat|compar|debug|refactor|architect|strateg|hypothes|infer|deduc|assess|investigat|research|explain why|why does|how does|what causes|derive|implement|design|review|critique|optimiz|troubleshoot)/i;

// Phrases that strongly suggest a simple lookup or transformation
const SIMPLE_RE  = /^(list |get |fetch |show |tell me |what is |who is |when |where |how many |convert |translate |what time|define |summarize in one)/i;

export function classifyRequest(
  prompt:       string,
  toolCount:    number,
  messageCount: number,
): ComplexityResult {
  let score = 0;
  const reasons: string[] = [];

  if (prompt.length > 200) { score += 1; reasons.push('medium prompt'); }
  if (prompt.length > 600) { score += 2; reasons.push('long prompt');   }

  if (toolCount > 2)  { score += 2; reasons.push(`${toolCount} tools`); }
  if (toolCount > 5)  { score += 2; reasons.push('many tools');          }

  if (messageCount > 6)  { score += 1; reasons.push('deep conversation'); }
  if (messageCount > 12) { score += 2; reasons.push('very deep conv');    }

  if (COMPLEX_RE.test(prompt)) { score += 3; reasons.push('reasoning keyword'); }
  if (SIMPLE_RE.test(prompt.trim())) { score -= 2; reasons.push('simple keyword'); }

  const complexity: Complexity = score >= 3 ? 'complex' : 'simple';
  recordComplexity(complexity);
  return { complexity, score, reasons: reasons.length ? reasons : ['default'] };
}

/**
 * Returns true when a simple request should be re-routed to the local engine.
 * Requires AUTO_ROUTE=true and a reachable LOCAL_ENGINE_URL.
 */
export function shouldAutoRoute(complexity: Complexity): boolean {
  return complexity === 'simple' && process.env.AUTO_ROUTE === 'true';
}
