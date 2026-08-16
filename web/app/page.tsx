import { CopyButton } from '../components/CopyButton';

const GITHUB_URL  = 'https://github.com/landonelder2410/killcord';
const NPM_URL     = 'https://www.npmjs.com/package/killcord';
const INSTALL_CMD = 'npm install -g killcord';

const FRAMEWORK_SNIPPETS = [
  {
    label: 'Anthropic SDK',
    code: `import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8080",
)`,
  },
  {
    label: 'OpenAI SDK',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
)`,
  },
  {
    label: 'LangChain',
    code: `from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    anthropic_api_url="http://localhost:8080",
)`,
  },
  {
    label: 'AutoGen',
    code: `from autogen import AssistantAgent

agent = AssistantAgent(
    "assistant",
    llm_config={"base_url": "http://localhost:8080"},
)`,
  },
  {
    label: 'CrewAI',
    code: `import os
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8080"

# rest of your CrewAI setup unchanged`,
  },
];

export default function Home() {
  return (
    <>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="site-header">
        <div className="header-inner">
          <span className="logo">killcord</span>
          <nav className="header-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={NPM_URL}    target="_blank" rel="noopener noreferrer">npm</a>
            <a href="#quickstart" className="header-cta">Get started</a>
          </nav>
        </div>
      </header>

      <main className="main-col">

        {/* ── 1. HERO ────────────────────────────────────────────────── */}
        <section className="hero">
          <h1 className="hero-h1">killcord</h1>
          <p className="hero-sub">
            Agents that loop don't stop — they burn budget until something else breaks.
          </p>
          <div className="install-wrap">
            <code className="install-cmd">
              <span className="dollar">$</span>{INSTALL_CMD}
            </code>
            <CopyButton text={INSTALL_CMD} />
          </div>
          <div className="hero-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">GitHub</a>
            <a href={NPM_URL}    target="_blank" rel="noopener noreferrer" className="btn btn-ghost">npm</a>
          </div>
        </section>

        {/* ── TERMINAL DEMO ─────────────────────────────────────────────
            Content sized to fit 375px viewport without horizontal scroll.
            Max line length ~31 chars at 14px Geist Mono (8.4px/char):
            335px content area - 40px demo-body padding = 295px / 8.4 ≈ 35ch.
            Query strings dropped — tool name rotation is the point anyway.  */}
        <div className="demo-wrap">
          <div className="demo-terminal">
            <div className="demo-titlebar">
              <div className="demo-dots">
                <span className="demo-dot" />
                <span className="demo-dot" />
                <span className="demo-dot" />
              </div>
              <span className="demo-title">scenario 2 — 10 rotating tool names</span>
            </div>
            <div className="demo-body">
              <pre className="demo-pre">{
`  `}<span className="t-dim">turn 1</span>{`  `}<span className="t-tool">{`search_web  `}</span>{`  `}<span className="t-ok">ok</span>{`
  `}<span className="t-dim">turn 2</span>{`  `}<span className="t-tool">{`web_search  `}</span>{`  `}<span className="t-ok">ok</span>{`
  `}<span className="t-dim">turn 3</span>{`  `}<span className="t-tool">{`lookup_docs `}</span>{`  `}<span className="t-ok">ok</span>{`
  `}<span className="t-dim">turn 4</span>{`  `}<span className="t-tool">{`find_docs   `}</span>{`  `}<span className="t-trip">TRIPPED</span>{`

`}<span className="t-dim">{`  # exact-match   never fires
  # semantic       0.969 at turn 4
`}</span>{`
  `}<span className="t-trip">429 Too Many Requests</span>{`

  `}<span className="t-key">"error"</span>{`:      `}<span className="t-str">"circuit_breaker_tripped"</span>{`
  `}<span className="t-key">"mechanism"</span>{`:  `}<span className="t-str">"semantic"</span>{`
  `}<span className="t-key">"similarity"</span>{`: `}<span className="t-num">0.969</span>{`
  `}<span className="t-key">"retry_after"</span>{`: `}<span className="t-num">60</span>
              </pre>
            </div>
          </div>
        </div>

        {/* ── 2. THE PROBLEM ─────────────────────────────────────────── */}
        <section className="section" id="problem">
          <p className="section-label">The problem</p>
          <h2 className="section-h2">Exact-match counts names. Rotating names makes the loop unbounded.</h2>

          <div className="comparison-table">
            <div className="ct-header">
              <span>Scenario</span>
              <span>exact-match</span>
              <span>Killcord</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">Same tool name, rephrased query × 5</span>
              <span className="ct-bad">trips at #6</span>
              <span className="ct-good">trips at #4</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">10 rotating names, same intent × 40 turns</span>
              <span className="ct-bad">never fires</span>
              <span className="ct-good">trips at #4</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">Pagination list_orders page=1…5</span>
              <span className="ct-neutral">—</span>
              <span className="ct-good">no trip</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">Batch get_user with distinct IDs</span>
              <span className="ct-neutral">—</span>
              <span className="ct-good">no trip</span>
            </div>
          </div>

          <p className="section-body">
            Every loop-detection scheme you already have counts how many times the same tool name
            appears. The moment your agent rotates — <code>search_web</code> this turn,{' '}
            <code>web_search</code> next turn, <code>lookup_docs</code> after that — exact-match
            never fires. The loop is <strong>unbounded</strong>: it runs until a rate limit, a
            billing cap, or a timeout you set somewhere else entirely.
          </p>
          <p className="section-body">
            Killcord embeds the <em>meaning</em> of each call, not the name. Rotating tool names doesn't help.
          </p>
        </section>

        {/* ── 3. HOW IT WORKS ────────────────────────────────────────── */}
        <section className="section" id="how-it-works">
          <p className="section-label">How it works</p>
          <h2 className="section-h2">Three checks. Cheapest first.</h2>

          <ol className="checks-list">
            <li>
              <div className="check-num">1</div>
              <div>
                <strong>Exact-match</strong> — counts identical tool names per request in O(n).
                Trips at <code>CB_TOOL_REPEAT_LIMIT</code> (default 5). No model required.
              </div>
            </li>
            <li>
              <div className="check-num">2</div>
              <div>
                <strong>Semantic</strong> — embeds the natural-language content of each call
                (whitespace strings ≥ 8 chars, or any string ≥ 25 chars). Compares cosine similarity
                within a sliding window of 5. Trips when ≥ 3 calls exceed 0.94 similarity.
                ~2–3 ms at steady state. Tool name excluded from embed string — rotation doesn't help.
              </div>
            </li>
            <li>
              <div className="check-num">3</div>
              <div>
                <strong>Cross-request flood</strong> (optional, requires Redis) — sliding-window
                counters per session key across separate HTTP requests.
              </div>
            </li>
          </ol>

          <p className="section-body">The full 429 body your agent receives:</p>
          <div className="code-block">
            <CopyButton text={`HTTP/1.1 429 Too Many Requests

{
  "error":       "circuit_breaker_tripped",
  "reason":      "semantic_loop",
  "mechanism":   "semantic",
  "similarity":  0.969,
  "detail":      "Tool call #4 is 96.9% semantically similar to 3 of the previous 3 calls.",
  "retry_after": 60
}`} />
            <pre>{`HTTP/1.1 429 Too Many Requests

{
  "error":       "circuit_breaker_tripped",
  "reason":      "semantic_loop",
  "mechanism":   "semantic",
  "similarity":  0.969,
  "detail":      "Tool call #4 is 96.9% similar to 3 of the previous 3 calls.",
  "retry_after": 60
}`}</pre>
          </div>
          <p className="section-body muted">
            Structured enough to log, escalate, or act on programmatically. Not a silent timeout.
          </p>
        </section>

        {/* ── 4. RUNS ON YOUR MACHINE ────────────────────────────────── */}
        <section className="section section-highlight" id="privacy">
          <p className="section-label">Privacy and data handling</p>
          <h2 className="section-h2">Runs on your machine. Nothing leaves.</h2>
          <p className="section-body">
            Killcord is a local proxy. Your prompts, API keys, tool schemas, and traces are never
            transmitted anywhere except the upstream LLM API you configure.
          </p>

          <div className="privacy-grid">
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Model runs locally</strong>
                MiniLM-L6-v2 (~90 MB) downloads once from HuggingFace on first run, then runs
                on your CPU via ONNX Runtime. Zero per-request network calls for embeddings.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>One upstream connection only</strong>
                The only outbound TCP connection is to the LLM API you configure
                (<code>ANTHROPIC_UPSTREAM</code> / <code>OPENAI_UPSTREAM</code>). No telemetry,
                no callbacks to any Killcord-controlled server.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Optional extras stay optional</strong>
                Redis and Stripe are only contacted if you set <code>REDIS_URL</code> or{' '}
                <code>STRIPE_SECRET_KEY</code>. Neither is required for loop detection.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Verifiable</strong>
                Run <code>node scripts/verify-no-telemetry.mjs</code> — starts the proxy against
                a mock upstream, fires real requests, and asserts no unexpected outbound connections.
              </div>
            </div>
          </div>

          <p className="section-body muted">
            Every competitor in this space is hosted — you route your API keys through their servers.
            Killcord runs on your infrastructure and can be audited line by line.
          </p>
        </section>

        {/* ── 5. QUICKSTART ──────────────────────────────────────────── */}
        <section className="section" id="quickstart">
          <p className="section-label">Quick start</p>
          <h2 className="section-h2">One URL change. No other modifications.</h2>

          <div className="code-block">
            <pre>{`# Install
$ npm install -g killcord

# Start (downloads ~90 MB model on first run, then cached)
$ killcord
  Listening on http://localhost:8080
  Anthropic  →  https://api.anthropic.com
  OpenAI     →  https://api.openai.com`}</pre>
          </div>

          <p className="section-body">Point your existing framework at the proxy:</p>

          <div className="snippet-grid">
            {FRAMEWORK_SNIPPETS.map(s => (
              <div key={s.label} className="snippet-card">
                <div className="snippet-header">
                  <span className="snippet-label">{s.label}</span>
                  <CopyButton text={s.code} />
                </div>
                <pre className="snippet-code">{s.code}</pre>
              </div>
            ))}
          </div>

          <div className="code-block">
            <pre>{`ANTHROPIC_UPSTREAM=https://api.anthropic.com killcord
OPENAI_UPSTREAM=https://api.openai.com     killcord`}</pre>
          </div>
        </section>

        {/* ── 6. LICENSING ───────────────────────────────────────────── */}
        <section className="section" id="licensing">
          <p className="section-label">Licensing</p>
          <h2 className="section-h2">Free for personal and evaluation use.</h2>
          <p className="section-body">
            Killcord 0.1.x is MIT-licensed and always will be. From 0.2.0, new versions ship under
            the Business Source License (BSL 1.1): free for personal, educational, evaluation, and
            non-production use. A commercial license is required for production use inside a company.
          </p>
          <p className="section-body">
            See{' '}
            <a href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`} target="_blank" rel="noopener noreferrer" className="text-link">COMMERCIAL.md</a>
            {' '}for full terms.
            To discuss a commercial license, open a{' '}
            <a href={`${GITHUB_URL}/issues/new?title=Commercial+license+enquiry`} target="_blank" rel="noopener noreferrer" className="text-link">GitHub issue</a>.
          </p>
          <div className="license-pills">
            <span className="pill pill--green">MIT — 0.1.x (current)</span>
            <span className="pill pill--blue">BSL 1.1 — 0.2.0+ (upcoming)</span>
          </div>
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-left">
            <span className="logo">killcord</span>
            <span className="footer-copy">MIT 0.1.x · Driftflow LLC</span>
          </div>
          <nav className="footer-meta">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={NPM_URL}    target="_blank" rel="noopener noreferrer">npm</a>
            <a href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`} target="_blank" rel="noopener noreferrer">Commercial</a>
            <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">License</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
