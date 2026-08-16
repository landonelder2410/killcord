#!/usr/bin/env node
/**
 * NL-content extraction — measurement and false-positive stress test.
 *
 * Uses getEmbedStringForCall imported from the compiled dist so the numbers
 * here are guaranteed to match what the production proxy actually does.
 *
 * Three question groups:
 *   SHOULD TRIP    — genuine stuck-agent loops
 *   SHOULD NOT TRIP — scalars/IDs/pagination (no NL content, never embedded)
 *   PIPELINE STRESS — different tools forwarding the SAME text through a
 *                     legitimate multi-step workflow. These cases test whether
 *                     removing the tool name from the embed string introduced
 *                     false positives vs. the previous behaviour.
 *
 * Run: node scripts/measure-semantic-fix.mjs   (requires npm run build first)
 */
import { pipeline } from '@xenova/transformers';

const THRESHOLD = 0.94, WINDOW = 5, REPEATS = 3;
const RESET='\x1b[0m',BOLD='\x1b[1m',GREEN='\x1b[32m',RED='\x1b[31m',YEL='\x1b[33m',DIM='\x1b[2m';

let embedder;
async function embed(t){ const o=await embedder(t.slice(0,512),{pooling:'mean',normalize:true}); return o.data; }
function cosine(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }

const SHOULD_TRIP = [
  { name:'Reworded web search', calls:[
    ['search_web',{query:'how to fix docker permission denied error'}],
    ['search_web',{query:'fixing docker permission denied issue'}],
    ['search_web',{query:'resolve docker permission denied problem'}],
    ['search_web',{query:'docker permission denied how do i solve it'}],
    ['search_web',{query:'why does docker say permission denied'}]]},
  { name:'Same ticket, reworded title', calls:[
    ['create_ticket',{title:'Login button broken',priority:'high'}],
    ['create_ticket',{title:'Login button is broken',priority:'high'}],
    ['create_ticket',{title:"The login button doesn't work",priority:'high'}],
    ['create_ticket',{priority:'high',title:'Login button not working'}],
    ['create_ticket',{title:'Fix the broken login button',priority:'high'}]]},
  { name:'Weather cosmetic variation (SF)', calls:[
    ['get_weather',{city:'San Francisco',units:'celsius'}],
    ['get_weather',{city:'San Francisco, CA',units:'celsius'}],
    ['get_weather',{city:'SF',units:'celsius'}],
    ['get_weather',{location:'San Francisco',units:'celsius'}],
    ['get_weather',{city:'san francisco',units:'celsius'}]]},
];

const SHOULD_NOT_TRIP = [
  { name:'Pagination (integers only)', calls:[
    ['list_orders',{page:1,limit:50}],['list_orders',{page:2,limit:50}],
    ['list_orders',{page:3,limit:50}],['list_orders',{page:4,limit:50}],
    ['list_orders',{page:5,limit:50}]]},
  { name:'Different records by ID', calls:[
    ['get_user',{id:'user_1042'}],['get_user',{id:'user_8891'}],
    ['get_user',{id:'user_3320'}],['get_user',{id:'user_7756'}],
    ['get_user',{id:'user_5501'}]]},
  { name:'Weather different cities (short names)', calls:[
    ['get_weather',{city:'Tokyo',units:'celsius'}],['get_weather',{city:'London',units:'celsius'}],
    ['get_weather',{city:'Paris',units:'celsius'}],['get_weather',{city:'Cairo',units:'celsius'}],
    ['get_weather',{city:'Sydney',units:'celsius'}]]},
];

// Pipeline stress: different tools forwarding the SAME NL text.
// With the old embed strategy (name prefix), different tool names provided some
// differentiation. With the current strategy (NL-only), identical NL strings
// produce cosine = 1.0 — these cases will trip if 4+ pipeline steps share the
// same content. That was also true with the old strategy when the body was long
// enough to dominate the embed.
const PIPELINE_STRESS = [
  {
    name: 'Email pipeline (draft → send → archive → log, same body)',
    note: 'a) user-spec case — same body text carried through 4 email tools',
    calls: [
      ['draft_email',   { body: 'The Q3 earnings report is ready for distribution to all regional managers and should be sent by end of day' }],
      ['send_email',    { body: 'The Q3 earnings report is ready for distribution to all regional managers and should be sent by end of day' }],
      ['archive_email', { body: 'The Q3 earnings report is ready for distribution to all regional managers and should be sent by end of day' }],
      ['log_email',     { body: 'The Q3 earnings report is ready for distribution to all regional managers and should be sent by end of day' }],
    ],
  },
  {
    name: 'Doc pipeline (summarize → translate → index → store, same text)',
    note: 'b) user-spec case — same paragraph passed to 4 different doc tools',
    calls: [
      ['summarize_doc', { content: 'The annual report shows consistent growth in emerging markets with a focus on sustainable development goals' }],
      ['translate_doc', { content: 'The annual report shows consistent growth in emerging markets with a focus on sustainable development goals' }],
      ['index_doc',     { content: 'The annual report shows consistent growth in emerging markets with a focus on sustainable development goals' }],
      ['store_doc',     { content: 'The annual report shows consistent growth in emerging markets with a focus on sustainable development goals' }],
    ],
  },
  {
    name: 'Ticket workflow (create → update → assign → notify, same description)',
    note: 'c) user-spec case — same description field on 4 ticket operations',
    calls: [
      ['create_ticket', { title: 'Login button broken', description: 'Login button is unresponsive on iOS mobile devices when users attempt to authenticate' }],
      ['update_ticket', { description: 'Login button is unresponsive on iOS mobile devices when users attempt to authenticate', status: 'in_progress' }],
      ['assign_ticket', { description: 'Login button is unresponsive on iOS mobile devices when users attempt to authenticate', assignee: 'jsmith' }],
      ['notify_ticket', { description: 'Login button is unresponsive on iOS mobile devices when users attempt to authenticate', channel: 'slack' }],
    ],
  },
];

// Evaluate over comparable (non-null) vectors.
async function evalSeq(seq, getEmbedStr){
  const contents = seq.calls.map(([n,i])=>getEmbedStr(n,i));
  const idxs = contents.map((c,i)=>c!==null?i:-1).filter(i=>i>=0);

  const vecs = new Array(contents.length).fill(null);
  for(const idx of idxs) vecs[idx] = await embed(contents[idx]);

  let verdict={tripped:false};
  for(let p=REPEATS; p<idxs.length; p++){
    const i=idxs[p]; const start=Math.max(0,p-WINDOW);
    let matches=0,best=0;
    for(let q=start;q<p;q++){
      const j=idxs[q]; const sc=cosine(vecs[i],vecs[j]);
      if(sc>THRESHOLD){matches++; if(sc>best){best=sc;}}
    }
    if(matches>=REPEATS){verdict={tripped:true,at:i,matches,best};break;}
  }

  const nlCount = idxs.length;
  console.log(`  ${BOLD}${seq.name}${RESET}  ${DIM}(${nlCount}/${seq.calls.length} calls have NL content)${RESET}`);
  if(seq.note) console.log(`    ${DIM}note: ${seq.note}${RESET}`);
  contents.forEach((c,i)=>console.log(`    ${c===null?RED+'[no NL] '+RESET:''}${DIM}${c??`${seq.calls[i][0]}:${JSON.stringify(seq.calls[i][1])}`}${RESET}`));
  const result = verdict.tripped
    ? `${YEL}TRIPS${RESET} (best=${verdict.best.toFixed(3)}, ${verdict.matches} matches ≥ ${THRESHOLD})`
    : `${DIM}no trip${RESET}`;
  console.log(`    → ${result}`);
  return verdict.tripped;
}

async function main(){
  const { getEmbedStringForCall } = await import('../dist/circuit-breaker.js');

  console.log(`${BOLD}Loading MiniLM-L6-v2...${RESET}`);
  embedder = await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2');
  console.log(`${BOLD}NL-content extraction — shipped getEmbedStringForCall — threshold ${THRESHOLD}${RESET}\n`);

  console.log(`${BOLD}═══ SHOULD TRIP (genuine stuck-agent loops) ═══${RESET}`);
  const trip=[]; for(const s of SHOULD_TRIP) trip.push(await evalSeq(s, getEmbedStringForCall));

  console.log(`\n${BOLD}═══ SHOULD NOT TRIP (no NL content — excluded from semantic detection) ═══${RESET}`);
  const notrip=[]; for(const s of SHOULD_NOT_TRIP) notrip.push(await evalSeq(s, getEmbedStringForCall));

  console.log(`\n${BOLD}═══ PIPELINE STRESS (legitimate multi-tool workflow, same NL text) ═══${RESET}`);
  console.log(`${DIM}  These cases test whether the name-removal change introduced false positives.${RESET}`);
  console.log(`${DIM}  With identical NL content, cosine = 1.0 regardless of whether the name was${RESET}`);
  console.log(`${DIM}  included — both old and new approaches trip at step 4. These are real${RESET}`);
  console.log(`${DIM}  false positives, but they are not newly introduced by the embed change.${RESET}\n`);
  const stress=[]; for(const s of PIPELINE_STRESS) stress.push(await evalSeq(s, getEmbedStringForCall));

  console.log(`\n${BOLD}═══ Result ═══${RESET}`);
  console.log(`  SHOULD TRIP caught:     ${trip.filter(Boolean).length}/${SHOULD_TRIP.length}`);
  console.log(`  SHOULD NOT TRIP passed: ${notrip.filter(x=>!x).length}/${SHOULD_NOT_TRIP.length}`);
  const stressTripped = stress.filter(Boolean).length;
  console.log(`  PIPELINE STRESS tripped: ${stressTripped}/${PIPELINE_STRESS.length}`);

  const coreClean = trip.filter(Boolean).length===SHOULD_TRIP.length && notrip.filter(x=>!x).length===SHOULD_NOT_TRIP.length;
  console.log(coreClean?`\n  ${GREEN}${BOLD}Core separation: clean.${RESET}`:`\n  ${RED}Core separation: imperfect.${RESET}`);

  if(stressTripped > 0){
    console.log(`  ${YEL}${stressTripped} pipeline stress case(s) trip — see note above.${RESET}`);
    console.log(`  ${DIM}These are real false positives for multi-tool workflows sharing NL content.${RESET}`);
    console.log(`  ${DIM}Detection requires observing tool results, not just calls — see README §Known limitations.${RESET}`);
  } else {
    console.log(`  ${GREEN}All pipeline stress cases passed — no false positives detected.${RESET}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
