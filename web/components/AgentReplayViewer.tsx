'use client'

import { useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type StepRole   = 'system' | 'user' | 'assistant' | 'tool'
type StepStatus = 'success' | 'error' | 'loop'

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  output?: unknown
}

interface TraceStep {
  step: number
  timestamp: string
  role: StepRole
  content: string
  tool_calls?: ToolCall[]
  latency_ms?: number
  tokens?: number
  status: StepStatus
}

interface DemoTrace {
  id: string
  label: string
  steps: TraceStep[]
}

// ── Demo traces ───────────────────────────────────────────────────────────────

const TRACES: DemoTrace[] = [
  {
    id: 'aapl-loop',
    label: 'AAPL Analysis — Loop Warning',
    steps: [
      { step:1,  timestamp:'2026-08-02T10:00:00.000Z', role:'system',    content:'You are a financial analysis assistant. Use tools to research and summarize stock performance.', latency_ms:0,    tokens:42,  status:'success' },
      { step:2,  timestamp:'2026-08-02T10:00:00.050Z', role:'user',      content:'Analyze Q2 performance of AAPL vs last quarter.', latency_ms:12,   tokens:28,  status:'success' },
      { step:3,  timestamp:'2026-08-02T10:00:00.062Z', role:'assistant', content:"I'll fetch Q2 data now.", latency_ms:843,  tokens:95,  status:'success',
        tool_calls:[{ id:'call_001', name:'fetch_stock_data', input:{ ticker:'AAPL', period:'Q2-2026' }, output:{ open:182.5, close:194.3, high:198.1, low:179.2, volume:'1.2B' } }] },
      { step:4,  timestamp:'2026-08-02T10:00:00.905Z', role:'tool',      content:'{"open":182.5,"close":194.3,"high":198.1,"low":179.2,"volume":"1.2B"}', latency_ms:220,  tokens:0,   status:'success',
        tool_calls:[{ id:'call_001', name:'fetch_stock_data', input:{ ticker:'AAPL', period:'Q2-2026' }, output:{ open:182.5, close:194.3, high:198.1, low:179.2, volume:'1.2B' } }] },
      { step:5,  timestamp:'2026-08-02T10:00:01.125Z', role:'assistant', content:"Fetching Q1 for comparison.", latency_ms:761,  tokens:88,  status:'success',
        tool_calls:[{ id:'call_002', name:'fetch_stock_data', input:{ ticker:'AAPL', period:'Q1-2026' }, output:{ open:175.0, close:183.9, high:186.4, low:170.1, volume:'980M' } }] },
      { step:6,  timestamp:'2026-08-02T10:00:01.886Z', role:'tool',      content:'{"open":175.0,"close":183.9,"high":186.4,"low":170.1,"volume":"980M"}', latency_ms:198,  tokens:0,   status:'success',
        tool_calls:[{ id:'call_002', name:'fetch_stock_data', input:{ ticker:'AAPL', period:'Q1-2026' }, output:{ open:175.0, close:183.9, high:186.4, low:170.1, volume:'980M' } }] },
      { step:7,  timestamp:'2026-08-02T10:00:02.084Z', role:'assistant', content:"Checking analyst sentiment.", latency_ms:654,  tokens:72,  status:'success',
        tool_calls:[{ id:'call_003', name:'get_analyst_ratings', input:{ ticker:'AAPL' }, output:null }] },
      { step:8,  timestamp:'2026-08-02T10:00:02.738Z', role:'tool',      content:'Error: Rate limit exceeded. Retry after 60s.', latency_ms:45,   tokens:0,   status:'error',
        tool_calls:[{ id:'call_003', name:'get_analyst_ratings', input:{ ticker:'AAPL' }, output:{ error:'Rate limit exceeded. Retry after 60s.' } }] },
      { step:9,  timestamp:'2026-08-02T10:00:02.783Z', role:'assistant', content:"Analyst API failed — retrying immediately.", latency_ms:590,  tokens:64,  status:'loop',
        tool_calls:[{ id:'call_004', name:'get_analyst_ratings', input:{ ticker:'AAPL' }, output:null }] },
      { step:10, timestamp:'2026-08-02T10:00:03.373Z', role:'tool',      content:'Error: Rate limit exceeded. Retry after 60s.', latency_ms:44,   tokens:0,   status:'error',
        tool_calls:[{ id:'call_004', name:'get_analyst_ratings', input:{ ticker:'AAPL' }, output:{ error:'Rate limit exceeded. Retry after 60s.' } }] },
      { step:11, timestamp:'2026-08-02T10:00:03.417Z', role:'assistant', content:"AAPL Q2 2026 → +6.5% (Open $182.50 → Close $194.30), Vol 1.2B\nAAPL Q1 2026 → +5.1% (Open $175.00 → Close $183.90), Vol 980M\n\nQ2 showed stronger momentum — 22% higher volume, broader gain.", latency_ms:1204, tokens:182, status:'success' },
    ],
  },
  {
    id: 'portfolio-rebalancer',
    label: 'Portfolio Rebalancer — Tool Chain',
    steps: [
      { step:1,  timestamp:'2026-08-02T11:00:00.000Z', role:'system',    content:'You are a portfolio management assistant. Analyze holdings and execute rebalancing trades using brokerage tools.', latency_ms:0,    tokens:55,  status:'success' },
      { step:2,  timestamp:'2026-08-02T11:00:00.060Z', role:'user',      content:'Rebalance my portfolio to 60/30/10 (equity/bond/cash). I am overweight tech.', latency_ms:18,   tokens:42,  status:'success' },
      { step:3,  timestamp:'2026-08-02T11:00:00.078Z', role:'assistant', content:"Fetching current positions.", latency_ms:922,  tokens:104, status:'success',
        tool_calls:[{ id:'tc_a1', name:'get_portfolio_positions', input:{ account:'primary' }, output:{ AAPL:{ shares:120, value:23316 }, MSFT:{ shares:85, value:36040 }, NVDA:{ shares:40, value:17200 }, BND:{ shares:200, value:15800 }, cash:4200 } }] },
      { step:4,  timestamp:'2026-08-02T11:00:01.000Z', role:'tool',      content:'{"AAPL":{"shares":120,"value":23316},"MSFT":{"shares":85,"value":36040},"NVDA":{"shares":40,"value":17200},"BND":{"shares":200,"value":15800},"cash":4200}', latency_ms:310,  tokens:0,   status:'success',
        tool_calls:[{ id:'tc_a1', name:'get_portfolio_positions', input:{ account:'primary' }, output:{ AAPL:{ shares:120, value:23316 }, MSFT:{ shares:85, value:36040 }, NVDA:{ shares:40, value:17200 }, BND:{ shares:200, value:15800 }, cash:4200 } }] },
      { step:5,  timestamp:'2026-08-02T11:00:01.310Z', role:'assistant', content:"Total: $96,556. Current allocation: equity 79.5%, bonds 16.4%, cash 4.3%.\nTarget: 60% / 30% / 10%.\nAction: sell $18,856 equity, buy $13,167 bonds.", latency_ms:1140, tokens:178, status:'success' },
      { step:6,  timestamp:'2026-08-02T11:00:02.450Z', role:'assistant', content:"Selling NVDA (highest P/E ratio, trim first).", latency_ms:834,  tokens:88,  status:'success',
        tool_calls:[{ id:'tc_b1', name:'place_trade', input:{ symbol:'NVDA', side:'sell', shares:30, order_type:'market' }, output:{ order_id:'ORD-7821', status:'filled', fill_price:430.10, total:12903 } }] },
      { step:7,  timestamp:'2026-08-02T11:00:03.284Z', role:'tool',      content:'{"order_id":"ORD-7821","status":"filled","fill_price":430.10,"total":12903}', latency_ms:290,  tokens:0,   status:'success',
        tool_calls:[{ id:'tc_b1', name:'place_trade', input:{ symbol:'NVDA', side:'sell', shares:30, order_type:'market' }, output:{ order_id:'ORD-7821', status:'filled', fill_price:430.10, total:12903 } }] },
      { step:8,  timestamp:'2026-08-02T11:00:03.574Z', role:'assistant', content:"Trimming AAPL to cover remaining overage.", latency_ms:791,  tokens:82,  status:'success',
        tool_calls:[{ id:'tc_b2', name:'place_trade', input:{ symbol:'AAPL', side:'sell', shares:15, order_type:'market' }, output:{ order_id:'ORD-7822', status:'filled', fill_price:394.5, total:5917.5 } }] },
      { step:9,  timestamp:'2026-08-02T11:00:04.365Z', role:'tool',      content:'{"order_id":"ORD-7822","status":"filled","fill_price":394.5,"total":5917.5}', latency_ms:280,  tokens:0,   status:'success',
        tool_calls:[{ id:'tc_b2', name:'place_trade', input:{ symbol:'AAPL', side:'sell', shares:15, order_type:'market' }, output:{ order_id:'ORD-7822', status:'filled', fill_price:394.5, total:5917.5 } }] },
      { step:10, timestamp:'2026-08-02T11:00:04.645Z', role:'assistant', content:"Deploying proceeds into BND (total bond market ETF).", latency_ms:873,  tokens:96,  status:'success',
        tool_calls:[{ id:'tc_c1', name:'place_trade', input:{ symbol:'BND', side:'buy', dollar_amount:18800, order_type:'market' }, output:{ order_id:'ORD-7823', status:'filled', shares:237, avg_price:79.32 } }] },
      { step:11, timestamp:'2026-08-02T11:00:05.518Z', role:'tool',      content:'{"order_id":"ORD-7823","status":"filled","shares":237,"avg_price":79.32}', latency_ms:298,  tokens:0,   status:'success',
        tool_calls:[{ id:'tc_c1', name:'place_trade', input:{ symbol:'BND', side:'buy', dollar_amount:18800, order_type:'market' }, output:{ order_id:'ORD-7823', status:'filled', shares:237, avg_price:79.32 } }] },
      { step:12, timestamp:'2026-08-02T11:00:05.816Z', role:'assistant', content:"Rebalancing complete.\n\nNew allocation: equity 60.2% / bonds 30.1% / cash 9.7%\n3 orders executed — $18,820.50 rotated into bonds.", latency_ms:1050, tokens:144, status:'success' },
    ],
  },
]

function computeSummary(steps: TraceStep[]) {
  return {
    total_steps:         steps.length,
    total_tokens:        steps.reduce((a, s) => a + (s.tokens ?? 0), 0),
    total_latency_ms:    steps.reduce((a, s) => a + (s.latency_ms ?? 0), 0),
    tool_execution_count:steps.filter(s => (s.tool_calls?.length ?? 0) > 0).length,
    loop_warnings:       steps.filter(s => s.status === 'loop').length,
    error_count:         steps.filter(s => s.status === 'error').length,
  }
}

// ── Syntax highlight JSON ─────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        let c = 'color:#fbbf24'
        if (/^"/.test(m)) c = /:$/.test(m) ? 'color:#7dd3fc' : 'color:#86efac'
        else if (/true|false/.test(m)) c = 'color:#f472b6'
        else if (/null/.test(m)) c = 'color:#6b7280'
        return `<span style="${c}">${m}</span>`
      }
    )
}

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<StepRole, string> = {
  system: 'System', user: 'User', assistant: 'LLM', tool: 'Tool',
}

const ROLE_BADGE_STYLE: Record<StepRole, React.CSSProperties> = {
  system:    { background: 'rgba(139,92,246,.18)', color: '#a78bfa' },
  user:      { background: 'rgba(34,197,94,.15)',  color: '#4ade80' },
  assistant: { background: 'rgba(99,102,241,.2)',  color: '#818cf8' },
  tool:      { background: 'rgba(59,130,246,.18)', color: '#60a5fa' },
}

const STATUS_COLOR: Record<StepStatus, string> = {
  success: '#22c55e',
  error:   '#f87171',
  loop:    '#f59e0b',
}

// Bug fix #1: Use deterministic UTC time slice — toLocaleTimeString() varies
// between Node.js (UTC) during SSR and the browser (local TZ), causing a React
// hydration mismatch on every page load.
function fmtTime(ts: string): string {
  return ts.length >= 19 ? ts.slice(11, 19) : ts
}

// ── ToolCard ──────────────────────────────────────────────────────────────────

function ToolCard({ tc, uid }: { tc: ToolCall; uid: string }) {
  const [open, setOpen] = useState(false)
  const inputHtml  = syntaxHighlight(safeStringify(tc.input))
  const outputHtml = tc.output != null ? syntaxHighlight(safeStringify(tc.output)) : null

  return (
    <div className="ar-tool-card">
      <button
        type="button"
        className="ar-tool-header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`tc-${uid}`}
      >
        <span className="ar-tool-name">{tc.name}</span>
        <span className="ar-tool-id">{tc.id}</span>
        <span className="ar-chevron" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
      </button>
      {open && (
        <div id={`tc-${uid}`} className="ar-tool-body">
          <p className="ar-json-label">Input</p>
          <pre className="ar-json-block" dangerouslySetInnerHTML={{ __html: inputHtml }} />
          {outputHtml && (
            <>
              <p className="ar-json-label">Output</p>
              <pre className="ar-json-block" dangerouslySetInnerHTML={{ __html: outputHtml }} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── StepCard ──────────────────────────────────────────────────────────────────

function StepCard({ step }: { step: TraceStep }) {
  const [open, setOpen] = useState(false)
  const hasTool = (step.tool_calls?.length ?? 0) > 0

  // Bug fix #4: CSS .ar-step-error / .ar-step-loop classes with !important already
  // control the left-border color — no inline style needed here.
  return (
    <div className={`ar-step-card ar-step-${step.status}`}>
      <button
        type="button"
        className="ar-step-header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`step-body-${step.step}`}
      >
        <span className="ar-step-num">#{step.step}</span>
        <span className="ar-role-badge" style={ROLE_BADGE_STYLE[step.role]}>
          {ROLE_LABELS[step.role]}
        </span>
        <span className="ar-step-preview">
          {step.content.replace(/\n/g, ' ')}
        </span>
        <span className="ar-step-meta">
          {step.latency_ms !== undefined && (
            <span className="ar-latency">{step.latency_ms}ms</span>
          )}
          {step.tokens !== undefined && step.tokens > 0 && (
            <span className="ar-tokens">{step.tokens} tok</span>
          )}
          {hasTool && (
            <span className="ar-tool-count">
              {step.tool_calls!.length} tool{step.tool_calls!.length > 1 ? 's' : ''}
            </span>
          )}
          <span className="ar-time">{fmtTime(step.timestamp)}</span>
          <span
            className="ar-dot"
            style={{ background: STATUS_COLOR[step.status] }}
            role="img"
            aria-label={step.status}
          />
          <span
            className="ar-chevron"
            aria-hidden="true"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >▶</span>
        </span>
      </button>

      {open && (
        <div id={`step-body-${step.step}`} className="ar-step-body">
          <div className={`ar-step-content${hasTool ? ' ar-step-content--bordered' : ''}`}>
            {step.content}
          </div>
          {hasTool && (
            <div className="ar-tools-section">
              <p className="ar-tools-label">Tool Calls</p>
              {step.tool_calls!.map((tc, ti) => (
                <ToolCard key={tc.id} tc={tc} uid={`${step.step}-${ti}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AgentReplayViewer() {
  const [activeId, setActiveId]     = useState(TRACES[0].id)
  const [activeRole, setActiveRole] = useState<StepRole | 'all'>('all')
  const [search, setSearch]         = useState('')
  const [issuesOnly, setIssuesOnly] = useState(false)

  const trace   = TRACES.find(t => t.id === activeId) ?? TRACES[0]
  const summary = computeSummary(trace.steps)

  const visible = trace.steps.filter(s => {
    if (activeRole !== 'all' && s.role !== activeRole) return false
    if (issuesOnly && s.status === 'success') return false
    if (search && !s.content.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
  }, [])

  const ROLES: Array<StepRole | 'all'> = ['all', 'system', 'user', 'assistant', 'tool']

  return (
    <section className="ar-section">
      <div className="ar-glow" aria-hidden="true" />

      <div className="ar-inner">
        <div className="ar-header">
          <p className="section-label">Agent Replay</p>
          <h2 className="section-title">
            Watch every agent step,{' '}
            <span className="gradient-text">live.</span>
          </h2>
          <p className="section-sub">
            Every prompt, tool call, and token logged. Loop warnings surface before
            they become runaway API bills — intercepted directly inside Killcord.
          </p>
        </div>

        <div className="ar-shell">
          {/* Title bar */}
          <div className="ar-titlebar">
            <span className="ar-titlebar-dot" style={{ background:'#f87171' }} aria-hidden="true" />
            <span className="ar-titlebar-dot" style={{ background:'#f59e0b' }} aria-hidden="true" />
            <span className="ar-titlebar-dot" style={{ background:'#22c55e' }} aria-hidden="true" />
            <span className="ar-titlebar-label">agent-replay</span>
            {/* Bug fix #3: scrollable tabs prevent long labels from overflowing on mobile */}
            <div className="ar-trace-tabs" role="tablist">
              {TRACES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeId === t.id}
                  className={`ar-trace-tab${activeId === t.id ? ' ar-trace-tab--active' : ''}`}
                  onClick={() => {
                    setActiveId(t.id)
                    setActiveRole('all')
                    setSearch('')
                    setIssuesOnly(false)
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Metrics */}
          <div className="ar-metrics" aria-label="Trace summary">
            {[
              { label: 'Steps',      value: String(summary.total_steps),              accent: 'var(--text)' },
              { label: 'Tokens',     value: summary.total_tokens.toLocaleString(),    accent: 'var(--text)' },
              { label: 'Latency',    value: `${summary.total_latency_ms}ms`,           accent: 'var(--text)' },
              { label: 'Tool Calls', value: String(summary.tool_execution_count),     accent: 'var(--accent)' },
              { label: 'Loops',      value: String(summary.loop_warnings),             accent: summary.loop_warnings > 0 ? '#f59e0b' : 'var(--text-muted)' },
              { label: 'Errors',     value: String(summary.error_count),              accent: summary.error_count    > 0 ? '#f87171' : 'var(--text-muted)' },
            ].map(m => (
              <div key={m.label} className="ar-metric">
                <div className="ar-metric-label">{m.label}</div>
                <div className="ar-metric-value" style={{ color: m.accent }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="ar-controls" role="toolbar" aria-label="Filter controls">
            <input
              className="ar-search"
              type="search"
              placeholder="Search steps..."
              value={search}
              onChange={handleSearch}
              aria-label="Search trace steps"
            />
            {ROLES.map(r => (
              <button
                key={r}
                type="button"
                className={`ar-filter-btn${activeRole === r ? ' ar-filter-btn--active' : ''}`}
                onClick={() => setActiveRole(r)}
                aria-pressed={activeRole === r}
              >
                {r === 'all' ? 'All' : ROLE_LABELS[r as StepRole]}
              </button>
            ))}
            {/* Bug fix #6: removed dead 'ar-issues-btn' class */}
            <button
              type="button"
              className={`ar-filter-btn${issuesOnly ? ' ar-filter-btn--issues' : ''}`}
              onClick={() => setIssuesOnly(v => !v)}
              aria-pressed={issuesOnly}
              style={{ marginLeft: 'auto' }}
            >
              {issuesOnly ? '⚠ Issues only' : 'Show issues'}
            </button>
          </div>

          {/* Timeline */}
          <div className="ar-timeline" role="feed" aria-label="Agent trace steps">
            {visible.length === 0 ? (
              <div className="ar-empty">
                <p>No matching steps — adjust filters or search.</p>
              </div>
            ) : (
              visible.map(step => (
                <StepCard key={`${activeId}-${step.step}`} step={step} />
              ))
            )}
          </div>

          {/* Status bar */}
          <div className="ar-statusbar">
            <span className="ar-status-dot" aria-hidden="true" />
            <span className="ar-status-text">
              Killcord · {summary.total_steps} steps intercepted · {visible.length} shown
            </span>
            {summary.loop_warnings > 0 && (
              <span className="ar-loop-badge" role="alert">
                ⚠ {summary.loop_warnings} loop{summary.loop_warnings > 1 ? 's' : ''} — circuit breaker tripped
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
