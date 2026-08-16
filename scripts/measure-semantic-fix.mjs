#!/usr/bin/env node
/**
 * Follow-up: does extracting only the NATURAL-LANGUAGE content of a tool call
 * (rather than the whole JSON) separate genuine reworded loops from
 * legitimate scalar-varying repeats (pagination, ID lookups)?
 *
 * Heuristic: a string arg value is "semantic content" iff it contains
 * whitespace and length >= 8, OR length >= 25. Numbers, IDs, enums, short
 * tokens (page=2, "high", "SF", "user_1042", "Tokyo") are excluded. A call
 * with NO semantic content cannot form a semantic loop — it falls through to
 * exact-match only.
 */
import { pipeline } from '@xenova/transformers';

const THRESHOLD = 0.94, WINDOW = 5, REPEATS = 3;
const RESET='\x1b[0m',BOLD='\x1b[1m',GREEN='\x1b[32m',RED='\x1b[31m',YEL='\x1b[33m',DIM='\x1b[2m';

let embedder;
async function embed(t){ const o=await embedder(t.slice(0,512),{pooling:'mean',normalize:true}); return o.data; }
function cosine(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }

function isNL(v){ return typeof v==='string' && ((/\s/.test(v) && v.length>=8) || v.length>=25); }
function semanticContent(name, input){
  const parts=[];
  const walk=(v)=>{ if(isNL(v)) parts.push(v); else if(v&&typeof v==='object') for(const k of Object.keys(v)) walk(v[k]); };
  walk(input);
  return parts.length ? `${name}: ${parts.join(' ')}` : null;  // null => no semantic content
}

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
  { name:'Weather cosmetic variation', calls:[
    ['get_weather',{city:'San Francisco',units:'celsius'}],
    ['get_weather',{city:'San Francisco, CA',units:'celsius'}],
    ['get_weather',{city:'SF',units:'celsius'}],
    ['get_weather',{location:'San Francisco',units:'celsius'}],
    ['get_weather',{city:'san francisco',units:'celsius'}]]},
];
const SHOULD_NOT_TRIP = [
  { name:'Pagination', calls:[
    ['list_orders',{page:1,limit:50}],['list_orders',{page:2,limit:50}],
    ['list_orders',{page:3,limit:50}],['list_orders',{page:4,limit:50}],
    ['list_orders',{page:5,limit:50}]]},
  { name:'Different records by ID', calls:[
    ['get_user',{id:'user_1042'}],['get_user',{id:'user_8891'}],
    ['get_user',{id:'user_3320'}],['get_user',{id:'user_7756'}],
    ['get_user',{id:'user_5501'}]]},
  { name:'Weather different cities', calls:[
    ['get_weather',{city:'Tokyo',units:'celsius'}],['get_weather',{city:'London',units:'celsius'}],
    ['get_weather',{city:'Paris',units:'celsius'}],['get_weather',{city:'Cairo',units:'celsius'}],
    ['get_weather',{city:'Sydney',units:'celsius'}]]},
];

// Evaluate over calls, skipping (as index gaps) any with null semantic content.
async function evalSeq(seq){
  const contents = seq.calls.map(([n,i])=>semanticContent(n,i));
  const vecs = [];
  for(const c of contents) vecs.push(c===null?null:await embed(c));

  // Build the list of comparable (non-null) vectors in order.
  const idxs = vecs.map((v,i)=>v!==null?i:-1).filter(i=>i>=0);

  let verdict={tripped:false};
  for(let p=REPEATS; p<idxs.length; p++){
    const i=idxs[p]; const start=Math.max(0,p-WINDOW);
    let matches=0,best=0,bestP=-1;
    for(let q=start;q<p;q++){
      const j=idxs[q]; const sc=cosine(vecs[i],vecs[j]);
      if(sc>THRESHOLD){matches++; if(sc>best){best=sc;bestP=q;}}
    }
    if(matches>=REPEATS){verdict={tripped:true,at:i,matches,best};break;}
  }

  const nlCount = contents.filter(c=>c!==null).length;
  console.log(`  ${BOLD}${seq.name}${RESET}  ${DIM}(${nlCount}/${seq.calls.length} calls have NL content)${RESET}`);
  contents.forEach((c,i)=>console.log(`    ${c===null?RED+'[skipped: no NL content] '+RESET:''}${DIM}${c??seq.calls[i][0]+':'+JSON.stringify(seq.calls[i][1])}${RESET}`));
  console.log(`    → ${verdict.tripped?YEL+`TRIPS (best=${verdict.best.toFixed(3)}, ${verdict.matches} matches)`+RESET:DIM+'no trip'+RESET}`);
  return verdict.tripped;
}

async function main(){
  console.log(`${BOLD}Loading MiniLM-L6-v2...${RESET}`);
  embedder = await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2');
  console.log(`${BOLD}NL-content extraction — threshold ${THRESHOLD}${RESET}\n`);

  console.log(`${BOLD}═══ SHOULD TRIP ═══${RESET}`);
  const trip=[]; for(const s of SHOULD_TRIP) trip.push(await evalSeq(s));
  console.log(`\n${BOLD}═══ SHOULD NOT TRIP ═══${RESET}`);
  const notrip=[]; for(const s of SHOULD_NOT_TRIP) notrip.push(await evalSeq(s));

  console.log(`\n${BOLD}═══ Result ═══${RESET}`);
  console.log(`  SHOULD TRIP caught:     ${trip.filter(Boolean).length}/3`);
  console.log(`  SHOULD NOT TRIP passed: ${notrip.filter(x=>!x).length}/3`);
  const clean = trip.filter(Boolean).length===3 && notrip.filter(x=>!x).length===3;
  console.log(clean?`  ${GREEN}${BOLD}Clean separation.${RESET}`:`  ${RED}Still imperfect.${RESET}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
