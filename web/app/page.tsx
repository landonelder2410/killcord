import { CopyButton } from '../components/CopyButton';

const GITHUB_URL = 'https://github.com/landonelder2410/killcord';
const NPM_URL    = 'https://www.npmjs.com/package/killcord';

const INSTALL_CMD = 'npm install -g killcord';

const FRAMEWORK_SNIPPETS = [
  {
    label: 'Anthropic SDK',
    lang: 'python',
    code: `import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8080",
)`,
  },
  {
    label: 'OpenAI SDK',
    lang: 'python',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
)`,
  },
  {
    label: 'LangChain',
    lang: 'python',
    code: `from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    anthropic_api_url="http://localhost:8080",
)`,
  },
  {
    label: 'AutoGen',
    lang: 'python',
    code: `from autogen import AssistantAgent

agent = AssistantAgent(
    "assistant",
    llm_config={"base_url": "http://localhost:8080"},
)`,
  },
  {
    label: 'CrewAI',
    lang: 'python',
    code: `import os
os.environ["ANTHROPIC_BASE_URL"] = "http://localhost:8080"

# rest of your CrewAI setup unchanged`,
  },
];

// Real output from `npx tsx scripts/demo-runaway-agent.mjs` — Scenario 2.
// Exact-match sees 4 different tool names and never fires.
// Semantic trips at turn 4 (cosine similarity 0.969).
const DEMO_ROWS: Array<{
  turn: number;
  tool: string;
  query: string;
  status: 'ok' | 'trip' | 'already';
}> = [
  { turn: 1, tool: 'search_web',  query: '"how to fix docker permission denied error"',   status: 'ok'      },
  { turn: 2, tool: 'web_search',  query: '"fixing docker permission denied issue"',        status: 'ok'      },
  { turn: 3, tool: 'lookup_docs', query: '"resolve docker permission denied problem"',     status: 'ok'      },
  { turn: 4, tool: 'find_docs',   query: '"docker permission denied how do i solve it"',  status: 'trip'    },
  { turn: 5, tool: 'query_index', query: '"why does docker say permission denied"',       status: 'already' },
];

export default function Home() {
  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
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

        {/* ── 1. HERO ──────────────────────────────────────────────────── */}
        <section className="hero">
          <h1 className="hero-h1">killcord</h1>
          <p className="hero-sub">
            Agents that loop don't stop — they burn budget until something else breaks.
          </p>

          <div className="install-wrap">
            <code className="install-cmd">
              <span className="dollar">$</span>
              {INSTALL_CMD}
            </code>
            <CopyButton text={INSTALL_CMD} />
          </div>

          <div className="hero-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              GitHub
            </a>
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              npm
            </a>
          </div>
        </section>

        {/* ── 2. THE PROBLEM ───────────────────────────────────────────── */}
        <section className="section" id="problem">
          <p className="section-label">The problem</p>
          <h2 className="section-h2">Iteration caps count tool names. Agents that rotate names evade them forever.</h2>
          <p className="section-body">
            Every loop-detection scheme you already have counts how many times the same tool name
            appears. The moment your agent rotates — <code>search_web</code> this turn,{' '}
            <code>web_search</code> next turn, <code>lookup_docs</code> after that — exact-match
            never fires. The loop is <strong>unbounded</strong>: it runs until a rate limit, a
            billing cap, or a timeout you set somewhere else entirely.
          </p>
          <p className="section-body">
            Killcord embeds the <em>meaning</em> of each call, so rotating tool names doesn't help.
          </p>

          {/* Real demo output */}
          <div className="term-block">
            <div className="term-titlebar">
              <div className="term-dots">
                <span className="term-dot" />
                <span className="term-dot" />
                <span className="term-dot" />
              </div>
              <span className="term-filename">
                Scenario 2 — 10 rotating tool names. Exact-match: 0 trips. Semantic: trips at turn 4.
              </span>
            </div>
            <div className="term-body">
              <div className="term-rows">
                {DEMO_ROWS.map(row => (
                  <div
                    key={row.turn}
                    className={`term-row${row.status === 'trip' ? ' term-row-trip' : ''}`}
                  >
                    <span className="term-turn">{row.turn}</span>
                    <span className="term-tool">{row.tool}</span>
                    <span className="term-q">{row.query}</span>
                    {row.status === 'ok'      && <span className="term-ok">ok</span>}
                    {row.status === 'trip'    && <span className="term-tripped">TRIPPED</span>}
                    {row.status === 'already' && <span className="term-already">(already tripped)</span>}
                  </div>
                ))}
                <div className="term-trip-detail">
                  HTTP 429&nbsp;&nbsp;·&nbsp;&nbsp;similarity 0.969&nbsp;&nbsp;·&nbsp;&nbsp;exact-match: 0 trips after 40 turns with 10 rotating names
                </div>
              </div>
            </div>
          </div>

          <div className="comparison-table">
            <div className="ct-header">
              <span>Scenario</span>
              <span>exact-match</span>
              <span>Killcord</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">
                Same tool name, rephrased query × 5
              </span>
              <span className="ct-bad">trips at #6</span>
              <span className="ct-good">trips at #4</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">
                10 rotating names, same query intent × 40 turns
              </span>
              <span className="ct-bad">never fires</span>
              <span className="ct-good">trips at #4</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">
                Pagination list_orders page=1…5
              </span>
              <span className="ct-neutral">—</span>
              <span className="ct-good">no trip</span>
            </div>
            <div className="ct-row">
              <span className="ct-scenario">
                Batch get_user with distinct IDs
              </span>
              <span className="ct-neutral">—</span>
              <span className="ct-good">no trip</span>
            </div>
          </div>
        </section>

        {/* ── 3. HOW IT WORKS ──────────────────────────────────────────── */}
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
                (whitespace strings ≥ 8 chars, or ≥ 25 chars). Compares cosine similarity
                within a sliding window. Trips when ≥ 3 of the last 5 calls exceed 0.94.
                ~2–3 ms per request at steady state; tool name is intentionally excluded
                from the embed string so rotation doesn't help.
              </div>
            </li>
            <li>
              <div className="check-num">3</div>
              <div>
                <strong>Cross-request</strong> (optional, requires Redis) — sliding-window
                counters for request floods across calls from the same session key.
              </div>
            </li>
          </ol>

          <p className="section-body">When the semantic breaker trips, your agent gets:</p>
          <div className="code-block">
            <CopyButton text={`{
  "error": "circuit_breaker_tripped",
  "reason": "semantic_loop",
  "mechanism": "semantic",
  "similarity": 0.969,
  "detail": "Tool call #4 is 96.9% semantically similar to 3 of the previous 3 calls.",
  "retry_after": 60
}`} />
            <pre>{`{
  "error": "circuit_breaker_tripped",
  "reason": "semantic_loop",
  "mechanism": "semantic",
  "similarity": 0.969,
  "detail": "Tool call #4 is 96.9% semantically similar to 3 of the previous 3 calls.",
  "retry_after": 60
}`}</pre>
          </div>
          <p className="section-body muted">
            A structured reason your agent can act on: log it, escalate to a human, or change
            strategy. Not a silent token burn followed by a vague context error.
          </p>
        </section>

        {/* ── 4. RUNS ON YOUR MACHINE ──────────────────────────────────── */}
        <section className="section section-highlight" id="privacy">
          <p className="section-label">Privacy and data handling</p>
          <h2 className="section-h2">Runs on your machine. Nothing leaves.</h2>
          <p className="section-body">
            Killcord is a local proxy. It sits between your agent and the LLM API on your own
            infrastructure. Your prompts, API keys, tool schemas, and traces are never transmitted
            anywhere except the upstream API you configure.
          </p>

          <div className="privacy-grid">
            <div className="privacy-item">
              <span className="privacy-dot privacy-dot--green" />
              <div>
                <strong>Model runs locally</strong>
                MiniLM-L6-v2 (~90 MB) downloads once from HuggingFace on first run, then runs
                entirely on your CPU via ONNX Runtime. Zero per-request network calls for
                embeddings. Works offline after that initial download.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot privacy-dot--green" />
              <div>
                <strong>One upstream connection only</strong>
                The only outbound TCP connection is to the LLM API you point it at
                (<code>ANTHROPIC_UPSTREAM</code> / <code>OPENAI_UPSTREAM</code>). No telemetry,
                no analytics, no callbacks to any Killcord-controlled server.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot privacy-dot--green" />
              <div>
                <strong>Optional extras stay optional</strong>
                Redis (cross-request rate limiting) and Stripe (billing) are only contacted if you
                set <code>REDIS_URL</code> or <code>STRIPE_SECRET_KEY</code>. Neither is required
                for the core loop detection to work.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot privacy-dot--green" />
              <div>
                <strong>Verifiable</strong>
                Run <code>node scripts/verify-no-telemetry.mjs</code> to confirm no unexpected
                outbound connections. The script starts the proxy against a mock upstream, fires
                real requests, and asserts the only host contacted is the mock.
              </div>
            </div>
          </div>

          <p className="section-body muted">
            Every competitor in this space is hosted — you route your API keys through their
            servers. Killcord you run yourself and can audit line by line.
          </p>
        </section>

        {/* ── 5. QUICKSTART ────────────────────────────────────────────── */}
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

          <p className="section-body">
            Or override the upstream if needed:
          </p>
          <div className="code-block">
            <pre>{`ANTHROPIC_UPSTREAM=https://api.anthropic.com killcord
OPENAI_UPSTREAM=https://api.openai.com     killcord`}</pre>
          </div>
        </section>

        {/* ── 6. LICENSING ─────────────────────────────────────────────── */}
        <section className="section" id="licensing">
          <p className="section-label">Licensing</p>
          <h2 className="section-h2">Free for personal and evaluation use.</h2>
          <p className="section-body">
            Killcord 0.1.x is MIT-licensed and always will be. Starting from 0.2.0, new versions
            ship under the Business Source License: free for personal, educational, evaluation,
            and non-production use. A commercial license is required for production use inside a
            company.
          </p>
          <p className="section-body">
            See <a href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`} target="_blank" rel="noopener noreferrer" className="text-link">COMMERCIAL.md</a> for the full terms. To discuss a commercial
            license, open a{' '}
            <a href={`${GITHUB_URL}/issues/new?title=Commercial+license+enquiry`} target="_blank" rel="noopener noreferrer" className="text-link">GitHub issue</a>.
          </p>
          <div className="license-pills">
            <span className="pill pill--green">MIT — 0.1.x (current)</span>
            <span className="pill pill--blue">BSL — 0.2.0+ (upcoming)</span>
          </div>
        </section>

      </main>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <span className="logo">killcord</span>
          <span className="footer-meta">
            MIT 0.1.x ·{' '}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            {' '}·{' '}
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer">npm</a>
            {' '}·{' '}
            <a href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`} target="_blank" rel="noopener noreferrer">Commercial</a>
          </span>
        </div>
      </footer>
    </>
  );
}
