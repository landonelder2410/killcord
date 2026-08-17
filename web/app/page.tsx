import { CopyButton } from '../components/CopyButton';
import { CodeTabs } from '../components/CodeTabs';

const GITHUB_URL  = 'https://github.com/landonelder2410/killcord';
const NPM_URL     = 'https://www.npmjs.com/package/killcord';
const INSTALL_CMD = 'npm install -g killcord';

export default function Home() {
  return (
    <>
      {/* ── Floating pill nav ─────────────────────────────────────────────── */}
      <nav className="pill-nav">
        <span className="logo">
          <img src="/logo.png" alt="" width={22} height={22} className="logo-img" />
          killcord
        </span>
        <div className="pill-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href={NPM_URL}    target="_blank" rel="noopener noreferrer">npm</a>
          <a href="#resources" className="pill-cta">Get started</a>
        </div>
      </nav>

      {/* ── 1. Hero ──────────────────────────────────────────────────────── */}
      <div className="hero-outer">
        <div className="hero-inner">

          {/* Left col: pitch */}
          <div className="hero-copy">
            <h1 className="hero-h1">
              Your agent is stuck.<br />
              Your bill isn't.
            </h1>
            <p className="hero-sub">
              Killcord kills runaway agent loops that iteration caps never catch.
            </p>
            <div className="install-wrap">
              <code className="install-cmd">
                <span className="dollar">$</span>{INSTALL_CMD}
              </code>
              <CopyButton text={INSTALL_CMD} />
            </div>
            <div className="hero-btns">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">GitHub</a>
              <a href={NPM_URL}    target="_blank" rel="noopener noreferrer" className="btn btn-ghost">npm</a>
            </div>
          </div>

          {/* Right col: 2. Tabbed code block */}
          <div className="hero-code">
            <CodeTabs />
          </div>

        </div>
      </div>

      {/* ── Content sections ──────────────────────────────────────────────── */}
      <div className="main-col">

        {/* ── 3. Stat row ─────────────────────────────────────────────────── */}
        <section className="section section-alt" id="stats">
          <div className="stats-row">
            <div className="stat-item">
              <div className="stat-num">0.94</div>
              <div className="stat-label">similarity threshold</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">~3ms</div>
              <div className="stat-label">per request</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">5/5</div>
              <div className="stat-label">turn separation</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">0 bytes</div>
              <div className="stat-label">transmitted</div>
            </div>
          </div>
        </section>

        {/* ── 4. Feature cards ─────────────────────────────────────────────── */}
        <section className="section" id="features">
          <p className="section-label">Why Killcord</p>
          <div className="feature-cards">

            <div className="feature-card">
              <h3 className="feature-card-h">
                Semantic detection,<br />
                <em>not name counting</em>
              </h3>
              <ul className="feature-card-bullets">
                <li>Embeds the meaning of each tool call</li>
                <li>Rotating names don't fool it</li>
                <li>0.94 cosine threshold, tuned on measured data</li>
              </ul>
            </div>

            <div className="feature-card">
              <h3 className="feature-card-h">
                Runs on your machine,<br />
                <em>nothing transmitted</em>
              </h3>
              <ul className="feature-card-bullets">
                <li>Local proxy, your infrastructure</li>
                <li>Model cached locally after first run</li>
                <li>Verify with scripts/verify-no-telemetry.mjs</li>
              </ul>
            </div>

            <div className="feature-card">
              <h3 className="feature-card-h">
                Three checks,<br />
                <em>cheapest first</em>
              </h3>
              <ul className="feature-card-bullets">
                <li>Exact-match counter, no model needed</li>
                <li>Semantic scan at ~3ms per request</li>
                <li>Optional Redis for cross-request limits</li>
              </ul>
            </div>

          </div>
        </section>

        {/* ── 5. Comparison table ──────────────────────────────────────────── */}
        <section className="section section-alt" id="comparison">
          <p className="section-label">Capabilities</p>
          <h2 className="section-h2">Exact-match counts names. Semantic embeds meaning.</h2>
          <div className="cap-table-wrap">
            <div className="cap-table">
              <div className="cap-header">
                <span className="cap-h-label" />
                <span>repeated calls</span>
                <span>rephrased args</span>
                <span>rotated names</span>
                <span>needs daemon</span>
              </div>
              <div className="cap-row">
                <span className="cap-label">Iteration caps</span>
                <span className="cap-yes">✓</span>
                <span className="cap-no">—</span>
                <span className="cap-no">—</span>
                <span className="cap-no">—</span>
              </div>
              <div className="cap-row">
                <span className="cap-label">Spend caps</span>
                <span className="cap-no">—</span>
                <span className="cap-no">—</span>
                <span className="cap-no">—</span>
                <span className="cap-no">—</span>
              </div>
              <div className="cap-row cap-row--killcord">
                <span className="cap-label">Killcord</span>
                <span className="cap-yes">✓</span>
                <span className="cap-yes">✓</span>
                <span className="cap-yes">✓</span>
                <span className="cap-cost">yes — local proxy</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Privacy ───────────────────────────────────────────────────── */}
        <section className="section section-highlight" id="privacy">
          <p className="section-label">Privacy and data handling</p>
          <h2 className="section-h2">Runs on your machine. Nothing leaves.</h2>
          <p className="section-body">
            Your prompts, API keys, tool schemas, and traces never leave your infrastructure.
          </p>
          <div className="privacy-grid">
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Model runs locally</strong>
                MiniLM-L6-v2 (~90 MB) downloads once from HuggingFace on first run,
                then runs on your CPU via ONNX Runtime. Zero per-request network calls.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>One upstream connection only</strong>
                The only outbound TCP connection is to the LLM API you configure.
                No telemetry, no callbacks to any Killcord-controlled server.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Optional extras stay optional</strong>
                Redis and Stripe are only contacted if you set{' '}
                <code>REDIS_URL</code> or <code>STRIPE_SECRET_KEY</code>.
                Neither is required for loop detection.
              </div>
            </div>
            <div className="privacy-item">
              <span className="privacy-dot" />
              <div>
                <strong>Verifiable</strong>
                Run <code>node scripts/verify-no-telemetry.mjs</code> — starts the proxy
                against a mock upstream and asserts no unexpected outbound connections.
              </div>
            </div>
          </div>
          <p className="section-body muted">
            Every competitor routes your API keys through their servers. Killcord
            runs on your infrastructure and can be audited line by line.
          </p>
        </section>

        {/* ── 7. Licensing ─────────────────────────────────────────────────── */}
        <section className="section" id="licensing">
          <p className="section-label">Licensing</p>
          <h2 className="section-h2">Free for personal and evaluation use.</h2>
          <p className="section-body">
            Killcord 0.1.x is MIT-licensed. From 0.2.0, new versions ship under the Business
            Source License (BSL 1.1): free for personal, educational, evaluation, and
            non-production use. A commercial license is required for production use inside a company.
          </p>
          <p className="section-body">
            See{' '}
            <a
              href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >COMMERCIAL.md</a>{' '}
            for full terms. To discuss a commercial license, open a{' '}
            <a
              href={`${GITHUB_URL}/issues/new?title=Commercial+license+enquiry`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >GitHub issue</a>.
          </p>
          <div className="license-pills">
            <span className="pill pill--green">MIT — 0.1.x (current)</span>
            <span className="pill pill--blue">BSL 1.1 — 0.2.0+ (upcoming)</span>
          </div>
        </section>

        {/* ── 8. Resources strip ───────────────────────────────────────────── */}
        <section className="section section-alt" id="resources">
          <p className="section-label">Resources</p>
          <div className="resources-strip">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="resource-card">
              <div className="resource-card-title">GitHub</div>
              <div className="resource-card-desc">Source code, issues, contributing</div>
            </a>
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="resource-card">
              <div className="resource-card-title">npm</div>
              <div className="resource-card-desc">npm install -g killcord</div>
            </a>
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="resource-card">
              <div className="resource-card-title">Issues</div>
              <div className="resource-card-desc">Bug reports and calibration cases</div>
            </a>
            <a href={`${GITHUB_URL}/blob/main/COMMERCIAL.md`} target="_blank" rel="noopener noreferrer" className="resource-card">
              <div className="resource-card-title">COMMERCIAL.md</div>
              <div className="resource-card-desc">Licensing for production use</div>
            </a>
          </div>
        </section>

      </div>{/* /main-col */}

      {/* ── 9. Footer ────────────────────────────────────────────────────── */}
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
            <a href={`${GITHUB_URL}/blob/main/LICENSE`}       target="_blank" rel="noopener noreferrer">License</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
