// PII redaction — applied to every outbound message before it leaves the proxy.
// Patterns are intentionally broad: a false positive (masking a benign string)
// is always preferable to a false negative (leaking real credentials or PII).
// Each pattern is compiled once at module load so repeated calls are cheap.

// ── Financial ─────────────────────────────────────────────────────────────

// 13-19 digit card numbers, optionally space- or dash-grouped
// e.g. 4111 1111 1111 1111 / 4111-1111-1111-1111 / 4111111111111111
const CREDIT_CARD = /\b(?:\d[ -]?){13,18}\d\b/g;

// ── Identity ──────────────────────────────────────────────────────────────

// Standard RFC-5321 email address
const EMAIL = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// US Social Security Number in canonical dashed form (XXX-XX-XXXX).
// Plain 9-digit form is intentionally excluded to avoid false positives on
// phone numbers, zip codes, and other numeric IDs.
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

// ── API Credentials ───────────────────────────────────────────────────────

// OpenAI-style secret keys:  sk-<alphanum 20+>
// Anthropic-style keys:      sk-ant-<alphanum 20+>
// Generic sk- prefix used by many providers
const SK_API_KEY = /\bsk-(?:[a-zA-Z0-9\-_]{2,10}-)?[a-zA-Z0-9\-_]{20,}\b/g;

// HTTP Authorization Bearer tokens appearing in prompt text or tool output
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

// AWS IAM access key IDs — always begin with AKIA and are 20 chars total
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;

// ── Redaction ─────────────────────────────────────────────────────────────

export function redactPII(text: string): string {
  return text
    .replace(CREDIT_CARD,   '[REDACTED]')
    .replace(EMAIL,         '[REDACTED]')
    .replace(SSN,           '[REDACTED]')
    .replace(SK_API_KEY,    '[REDACTED]')
    .replace(BEARER_TOKEN,  'Bearer [REDACTED]')
    .replace(AWS_ACCESS_KEY,'[REDACTED]');
}
