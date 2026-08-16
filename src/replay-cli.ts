/**
 * `killcord replay`            — list recent captured traces
 * `killcord replay <traceId>`  — open the viewer on :3030 for one trace
 *
 * Reads the JSONL trace files written by src/trace.ts from KILLCORD_TRACE_DIR.
 * The viewer HTML is self-contained (inlined below) so it ships with the npm
 * package, which only includes dist/.
 */
import http               from 'node:http';
import { listTraces, findTrace, type KillcordTrace } from './trace';

const PORT = parseInt(process.env.AGENT_REPLAY_PORT ?? '3030', 10);

// ── list mode ────────────────────────────────────────────────────────────────

function runList(): void {
  const traces = listTraces(undefined, 50);
  const dir = process.env.KILLCORD_TRACE_DIR ?? './.killcord/traces';

  if (traces.length === 0) {
    console.log(`\n  No traces found in ${dir}`);
    console.log('  Start the proxy and send a request to capture traces.');
    console.log('  (Tracing is on by default; disable with KILLCORD_TRACE_ENABLED=false.)\n');
    return;
  }

  console.log(`\n  Killcord traces  ${dir}\n`);
  const head = ['Trace ID'.padEnd(38), 'Time'.padEnd(22), 'Model'.padEnd(22), 'ms'.padEnd(7), 'Steps'.padEnd(6), 'CB'];
  console.log('  ' + head.join(' '));
  console.log('  ' + '─'.repeat(head.join(' ').length));
  for (const t of traces) {
    const cb = t.cbTripped ? '\x1b[33mTRIP\x1b[0m' : '\x1b[32mok\x1b[0m';
    console.log('  ' + [
      t.traceId.padEnd(38),
      t.timestamp.slice(0, 21).padEnd(22),
      t.model.slice(0, 21).padEnd(22),
      String(t.latencyMs).padEnd(7),
      String(t.stepCount).padEnd(6),
      cb,
    ].join(' '));
  }
  console.log(`\n  killcord replay <traceId>   opens the viewer\n`);
}

// ── viewer mode ──────────────────────────────────────────────────────────────

async function openBrowser(url: string): Promise<void> {
  try {
    // `open` is an optional peer — resolved dynamically so it isn't a hard dep.
    // The `as string` defeats TS module resolution (no @types/open required).
    const mod = await import('open' as string).catch(() => null) as { default?: (u: string) => Promise<unknown> } | null;
    if (mod?.default) await mod.default(url);
  } catch { /* user opens manually */ }
}

function runViewer(traceId: string): void {
  const trace = findTrace(traceId);
  if (!trace) {
    console.error(`\n  Trace "${traceId}" not found. Run \`killcord replay\` to list traces.\n`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/api/trace') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(trace));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(VIEWER_HTML);
  });

  server.listen(PORT, '127.0.0.1', async () => {
    const url = `http://localhost:${PORT}`;
    const cb = trace!.circuitBreaker;
    console.log(`\n  Killcord Replay — ${trace!.traceId}`);
    console.log(`  model=${trace!.model}  status=${trace!.upstreamStatus}  latency=${trace!.latencyMs}ms  steps=${trace!.steps.length}`);
    if (cb.tripped) console.log(`  \x1b[33m⚠ circuit breaker: ${cb.mechanism} — ${cb.detail}\x1b[0m`);
    console.log(`\n  Viewer: ${url}\n`);
    await openBrowser(url);
  });

  process.on('SIGINT', () => { console.log(); server.close(() => process.exit(0)); });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

// ── entry ────────────────────────────────────────────────────────────────────

export function runReplay(arg?: string): void {
  if (!arg) runList();
  else runViewer(arg);
}

// ── self-contained viewer HTML ───────────────────────────────────────────────

const VIEWER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Killcord Replay</title>
<style>
  :root{--bg:#0b0d12;--panel:#12151d;--line:#232838;--text:#e6e9ef;--muted:#8b93a7;--accent:#7c9cff;--warn:#f5b544;--err:#f87171;--ok:#4ade80}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{padding:20px 24px;border-bottom:1px solid var(--line)}
  h1{margin:0;font-size:15px;letter-spacing:.5px}.sub{color:var(--muted);margin-top:6px;font-size:12px}
  .cb{margin:14px 24px;padding:12px 14px;border:1px solid var(--warn);border-radius:8px;background:rgba(245,181,68,.08);color:var(--warn)}
  .wrap{padding:16px 24px;max-width:920px}
  .step{border:1px solid var(--line);border-radius:8px;margin:10px 0;overflow:hidden;background:var(--panel)}
  .step.loop{border-color:var(--warn)}
  .shead{display:flex;gap:10px;align-items:center;padding:10px 12px;cursor:pointer}
  .num{color:var(--muted)}
  .badge{font-size:11px;padding:1px 8px;border-radius:20px;background:rgba(124,156,255,.16);color:var(--accent)}
  .badge.user{background:rgba(74,222,128,.14);color:var(--ok)}
  .badge.tool{background:rgba(139,148,167,.18);color:var(--muted)}
  .prev{flex:1;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .body{padding:0 12px 12px;display:none}.step.open .body{display:block}
  .tc{border:1px solid var(--line);border-radius:6px;margin:8px 0;padding:8px 10px;background:#0d1017}
  .tc .name{color:var(--accent)}.tc .hash{color:var(--muted);font-size:11px;margin-left:8px}
  pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;color:#c7cede}
  .meta{display:flex;gap:20px;padding:14px 24px;border-top:1px solid var(--line);color:var(--muted);flex-wrap:wrap}
  .meta b{color:var(--text)}
</style></head><body>
<header><h1>⟁ Killcord Replay</h1><div class="sub" id="sub"></div></header>
<div id="cb"></div>
<div class="meta" id="meta"></div>
<div class="wrap" id="steps"></div>
<script>
fetch('/api/trace').then(r=>r.json()).then(t=>{
  document.getElementById('sub').textContent = t.traceId+'  ·  '+t.model+'  ·  '+t.timestamp;
  const cb=t.circuitBreaker;
  if(cb&&cb.tripped){const d=document.getElementById('cb');d.className='cb';
    d.textContent='⚠ Circuit breaker tripped ['+cb.mechanism+']  —  '+(cb.detail||cb.reason);}
  document.getElementById('meta').innerHTML=
    'Status <b>'+t.upstreamStatus+'</b>'+
    'Latency <b>'+t.latencyMs+'ms</b>'.replace('Latency','&nbsp;&nbsp;Latency ')+
    '&nbsp;&nbsp;Tools offered <b>'+(t.toolsOffered||[]).length+'</b>'+
    '&nbsp;&nbsp;Tools forwarded <b>'+(t.toolsForwarded||[]).length+'</b>'+
    '&nbsp;&nbsp;Tokens in/out <b>'+t.tokensIn+'/'+t.tokensOut+'</b>';
  const wrap=document.getElementById('steps');
  const tripIdx = (cb&&cb.tripped)? t.steps.length-1 : -1;
  (t.steps||[]).forEach((s,i)=>{
    const el=document.createElement('div');
    el.className='step'+(i===tripIdx?' loop':'');
    const role=s.role||'assistant';
    const calls=(s.toolCalls||[]).map(tc=>
      '<div class="tc"><span class="name">'+esc(tc.name)+'</span><span class="hash">'+esc(tc.argsHash||'')+'</span>'+
      (tc.inputPreview?'<pre>'+esc(tc.inputPreview)+'</pre>':'')+'</div>').join('');
    el.innerHTML='<div class="shead"><span class="num">#'+((s.index??i)+1)+'</span>'+
      '<span class="badge '+role+'">'+role+'</span>'+
      '<span class="prev">'+esc(s.textPreview|| (s.toolCalls&&s.toolCalls.length?('['+s.toolCalls.map(c=>c.name).join(', ')+']'):'(empty)'))+'</span></div>'+
      '<div class="body">'+(s.textPreview?'<pre>'+esc(s.textPreview)+'</pre>':'')+calls+'</div>';
    el.querySelector('.shead').onclick=()=>el.classList.toggle('open');
    wrap.appendChild(el);
  });
});
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
</script></body></html>`;
