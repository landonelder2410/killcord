'use client';

import { useState } from 'react';

type Tok = string | { c: string; t: string };
type TLine = Tok[];
const T = (c: string, t: string): Tok => ({ c, t });

type ScenarioData = { id: string; label: string; title: string; lines: TLine[] };
type FrameworkData = { id: string; label: string; code: string };

const SCENARIOS: ScenarioData[] = [
  {
    id: 'rotating',
    label: 'Rotating tool names',
    title: 'scenario — 10 rotating tool names',
    lines: [
      ['  ', T('t-dim','turn 1'), '  ', T('t-tool','search_web '), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 2'), '  ', T('t-tool','web_search '), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 3'), '  ', T('t-tool','lookup_docs'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 4'), '  ', T('t-tool','find_docs  '), '  ', T('t-trip','TRIPPED')],
      [],
      [T('t-dim','  # exact-match: never fires')],
      [T('t-dim','  # semantic:    0.969 tripped')],
      [],
      ['  ', T('t-trip','429 Too Many Requests')],
      [],
      ['  ', T('t-key','"mechanism"'),  ':  ', T('t-str','"semantic"')],
      ['  ', T('t-key','"similarity"'), ': ', T('t-num','0.969')],
      ['  ', T('t-key','"retry_after"'), ': ', T('t-num','60')],
    ],
  },
  {
    id: 'rephrased',
    label: 'Rephrased args',
    title: 'scenario — same tool, rephrased query',
    lines: [
      ['  ', T('t-dim','turn 1'), '  ', T('t-tool','search_web '), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 2'), '  ', T('t-tool','search_web '), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 3'), '  ', T('t-tool','search_web '), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 4'), '  ', T('t-tool','search_web '), '  ', T('t-trip','TRIPPED')],
      [],
      [T('t-dim','  # rephrased query each turn')],
      [T('t-dim','  # exact-match: trips at turn 6')],
      [T('t-dim','  # semantic:    0.941 tripped at turn 4')],
      [],
      ['  ', T('t-trip','429 Too Many Requests')],
      [],
      ['  ', T('t-key','"mechanism"'),  ':  ', T('t-str','"semantic"')],
      ['  ', T('t-key','"similarity"'), ': ', T('t-num','0.941')],
      ['  ', T('t-key','"retry_after"'), ': ', T('t-num','60')],
    ],
  },
  {
    id: 'pagination',
    label: 'Pagination (no trip)',
    title: 'control — paginated integers',
    lines: [
      ['  ', T('t-dim','turn 1'), '  ', T('t-tool','list_orders'), '  ', T('t-dim','page=1'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 2'), '  ', T('t-tool','list_orders'), '  ', T('t-dim','page=2'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 3'), '  ', T('t-tool','list_orders'), '  ', T('t-dim','page=3'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 4'), '  ', T('t-tool','list_orders'), '  ', T('t-dim','page=4'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 5'), '  ', T('t-tool','list_orders'), '  ', T('t-dim','page=5'), '  ', T('t-ok','ok')],
      [],
      [T('t-dim','  # integers only — nothing to embed')],
      [T('t-dim','  # exact-match: 5 calls, limit 5 — ok')],
      [],
      ['  ', T('t-ok','→ all 5 calls forwarded')],
    ],
  },
  {
    id: 'batch',
    label: 'Batch lookups (no trip)',
    title: 'control — distinct IDs',
    lines: [
      ['  ', T('t-dim','turn 1'), '  ', T('t-tool','get_user   '), '  ', T('t-dim','user_1042'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 2'), '  ', T('t-tool','get_user   '), '  ', T('t-dim','user_2891'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 3'), '  ', T('t-tool','get_user   '), '  ', T('t-dim','user_0034'), '  ', T('t-ok','ok')],
      ['  ', T('t-dim','turn 4'), '  ', T('t-tool','get_user   '), '  ', T('t-dim','user_7123'), '  ', T('t-ok','ok')],
      [],
      [T('t-dim','  # short IDs — nothing to embed')],
      [T('t-dim','  # exact-match: 4 calls, limit 5 — ok')],
      [],
      ['  ', T('t-ok','→ all 4 calls forwarded')],
    ],
  },
];

const FRAMEWORKS: FrameworkData[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    code: `import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8080",
)`,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
)`,
  },
  {
    id: 'langchain',
    label: 'LangChain',
    code: `from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    anthropic_api_url="http://localhost:8080",
)`,
  },
];

function renderLines(lines: TLine[]) {
  return lines.map((line, i) => (
    <span key={i}>
      {line.map((tok, j) =>
        typeof tok === 'string'
          ? tok
          : <span key={j} className={tok.c}>{tok.t}</span>
      )}
      {i < lines.length - 1 ? '\n' : ''}
    </span>
  ));
}

export function CodeTabs() {
  const [sId, setSId] = useState('rotating');
  const [fId, setFId] = useState('anthropic');

  const scenario = SCENARIOS.find(s => s.id === sId)!;
  const framework = FRAMEWORKS.find(f => f.id === fId)!;

  return (
    <div className="code-tabs">

      {/* Row 1: scenario tabs */}
      <div className="ctabs-row">
        {SCENARIOS.map(s => (
          <button
            key={s.id}
            className={`ctab${sId === s.id ? ' ctab--active' : ''}`}
            onClick={() => setSId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Terminal panel */}
      <div className="ctabs-terminal">
        <div className="demo-titlebar">
          <div className="demo-dots">
            <span className="demo-dot" />
            <span className="demo-dot" />
            <span className="demo-dot" />
          </div>
          <span className="demo-title">{scenario.title}</span>
        </div>
        <div className="demo-body">
          <pre className="demo-pre">{renderLines(scenario.lines)}</pre>
        </div>
      </div>

      {/* Row 2: framework tabs */}
      <div className="ctabs-row ctabs-row--fw">
        {FRAMEWORKS.map(f => (
          <button
            key={f.id}
            className={`ctab${fId === f.id ? ' ctab--active' : ''}`}
            onClick={() => setFId(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Code panel */}
      <div className="ctabs-code">
        <pre>{framework.code}</pre>
      </div>

    </div>
  );
}
