import { CopyButton }         from '../components/CopyButton';
import { PricingSection }     from '../components/PricingSection';
import { AgentReplayViewer }  from '../components/AgentReplayViewer';

const INSTALL_CMD = 'npm install -g aether-proxy';
const GITHUB_URL  = 'https://github.com/landonelder2410/aether-proxy';

export default function Home() {
  return (
    <>
      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-inner">
          <span className="logo">⟁ Aether Proxy</span>
          <div className="nav-links">
            <a className="nav-link" href="#how-it-works">How it works</a>
            <a className="nav-link" href="#features">Features</a>
            <a className="nav-link" href="#quickstart">Quick start</a>
            <a className="nav-link" href="#pricing">Pricing</a>
            <a className="nav-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="nav-link-cta" href="#pricing">
              Start Free Trial →
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-badge">Open Source · MIT · Zero API Cost</div>
        <h1 className="hero-headline">
          Stop Paying the<br />
          <span className="gradient-text">Tools Tax.</span>
        </h1>
        <p className="hero-sub">
          Cut your AI API bills by up to 90%. Aether Proxy intercepts every request,
          runs a local vector search in milliseconds, and forwards only the 2 tools
          your agent actually needs — before the LLM ever sees them.
        </p>
        <div className="install-wrap">
          <code className="install-cmd">
            <span className="dollar">$</span>
            {INSTALL_CMD}
          </code>
          <CopyButton text={INSTALL_CMD} />
        </div>
        <p className="hero-note">
          Then point your client to <code>localhost:8080</code> — no other changes needed.
        </p>
        <a className="hero-cta" href="#pricing">
          Start your 7-day free trial →
        </a>
      </section>

      {/* ── Agent Replay ────────────────────────────────── */}
      <AgentReplayViewer />

      {/* ── How it Works ────────────────────────────────── */}
      <section id="how-it-works" className="how">
        <p className="section-label">Architecture</p>
        <h2 className="section-title">
          Invisible Push vs. LLM Pull
        </h2>
        <p className="section-sub">
          Every other tool-routing system asks the LLM to figure out which tools to use.
          Aether does it locally — before the tokens hit the wire.
        </p>

        <div className="comparison">
          <div className="approach approach-bad">
            <div className="approach-header">
              <span className="approach-icon">❌</span>
              <span>LLM Pull <span className="tag-bad">today</span></span>
            </div>
            <p>
              Your agent ships every MCP tool schema on every request. The LLM reads
              them all, picks one, and responds. You pay for thousands of prompt tokens
              that describe tools the LLM will never call.
            </p>
            <div className="flow-steps">
              <div className="flow-step">
                <span className="step-num">1</span> Agent → API: 50 tool schemas
              </div>
              <div className="flow-step strike">
                <span className="step-num">2</span> LLM reads 47 useless schemas
              </div>
              <div className="flow-step strike">
                <span className="step-num">3</span> ~12 000 wasted input tokens
              </div>
              <div className="flow-step">
                <span className="step-num">4</span> LLM responds — finally
              </div>
            </div>
          </div>

          <div className="approach approach-good">
            <div className="approach-header">
              <span className="approach-icon">✅</span>
              <span>Invisible Push <span className="tag-good">Aether</span></span>
            </div>
            <p>
              Aether sits between your agent and the API. It embeds the user prompt
              locally, cosine-searches against all tool descriptions in microseconds,
              and rewrites the payload to include only the top 2 matches.
            </p>
            <div className="flow-steps">
              <div className="flow-step">
                <span className="step-num">1</span> Agent → Aether: 50 tool schemas
              </div>
              <div className="flow-step highlight">
                <span className="step-num">2</span> Local MiniLM: filter to top 2
              </div>
              <div className="flow-step highlight">
                <span className="step-num">3</span> Aether → API: 2 tool schemas
              </div>
              <div className="flow-step highlight">
                <span className="step-num">4</span> LLM responds — faster, cheaper
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────── */}
      <section id="features" className="features">
        <p className="section-label">Features</p>
        <h2 className="section-title">Built for the agent era</h2>

        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Zero-cost embeddings</h3>
            <p>
              MiniLM-L6 runs entirely on your CPU via ONNX Runtime. No embedding API,
              no network round-trip, no extra bill. Cold-start is a one-time ~90 MB download.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔍</div>
            <h3>Semantic tool routing</h3>
            <p>
              Cosine similarity between the user prompt and each tool description.
              Works across domains without training or configuration — just plug it in.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔌</div>
            <h3>Drop-in replacement</h3>
            <p>
              Change one URL in your client config. Supports Anthropic{' '}
              <code>/v1/messages</code> and OpenAI <code>/v1/chat/completions</code>{' '}
              — streaming included.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🛡️</div>
            <h3>Stays local</h3>
            <p>
              Your prompts and tool schemas never leave your machine for routing
              decisions. Aether only forwards the final, filtered request to the
              upstream API you configure.
            </p>
          </div>
        </div>
      </section>

      {/* ── Quick Start ──────────────────────────────────── */}
      <section id="quickstart" className="quickstart">
        <p className="section-label">Quick start</p>
        <h2 className="section-title">Up in 60 seconds</h2>

        <div className="code-block">
          <div><span className="comment"># 1. Install globally</span></div>
          <div><span className="dollar">$</span><span className="cmd">npm install -g aether-proxy</span></div>
          <br />
          <div><span className="comment"># 2. Start the proxy (model downloads on first run)</span></div>
          <div><span className="dollar">$</span><span className="cmd">aether-proxy</span></div>
          <br />
          <div><span className="comment"># 3. Point your client here instead of the real API</span></div>
          <div>
            <span className="env-var">ANTHROPIC_BASE_URL</span>
            <span className="cmd">=</span>
            <span className="value">http://localhost:8080</span>
          </div>
          <div>
            <span className="comment"># or for OpenAI-compatible clients:</span>
          </div>
          <div>
            <span className="env-var">OPENAI_BASE_URL</span>
            <span className="cmd">=</span>
            <span className="value">http://localhost:8080</span>
          </div>
          <br />
          <div><span className="comment"># Override the upstream target if needed</span></div>
          <div>
            <span className="env-var">ANTHROPIC_UPSTREAM</span>
            <span className="cmd">=https://api.anthropic.com</span>
            <span className="cmd"> aether-proxy</span>
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────── */}
      <PricingSection />

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="footer">
        <div className="footer-inner">
          {/* Brand column */}
          <div className="footer-brand">
            <span className="logo footer-logo">⟁ Aether Proxy</span>
            <p className="footer-tagline">
              Local semantic gateway for AI agents.<br />
              Cut tool-schema token costs by up to 92%.
            </p>
            <p className="footer-copy">
              © 2026 Aether Proxy. All rights reserved.
            </p>
            <a className="footer-email" href="mailto:landon@bankdrift.com">
              landon@bankdrift.com
            </a>
          </div>

          {/* Link columns */}
          <div className="footer-links-grid">
            <div className="footer-col">
              <p className="footer-col-heading">Product</p>
              <a href="#how-it-works">How it works</a>
              <a href="#features">Features</a>
              <a href="#quickstart">Quick start</a>
              <a href="#pricing">Pricing</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">Issues</a>
            </div>
            <div className="footer-col">
              <p className="footer-col-heading">Legal &amp; Docs</p>
              <a href={`${GITHUB_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              <a href={`${GITHUB_URL}/blob/main/TERMS.md`} target="_blank" rel="noopener noreferrer">Terms of Service</a>
              <a href={`${GITHUB_URL}/blob/main/API.md`} target="_blank" rel="noopener noreferrer">API Reference</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
