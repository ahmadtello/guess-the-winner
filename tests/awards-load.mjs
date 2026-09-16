import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const N=500, port=Number(process.env.AWARDS_TEST_PORT||18788), base=`http://127.0.0.1:${port}`;
const tmp=await mkdtemp(path.join(os.tmpdir(),'guess-the-winner-load-'));
const shortlist=JSON.parse(await readFile('src/awards-shortlist.json','utf8'));
const fixture={dataset:shortlist.dataset,winners:Object.fromEntries(shortlist.categories.map((c,i)=>[c.id,c.nominees.slice(0,[8,10].includes(i)?2:1).map(n=>n.id)]))};
await writeFile(path.join(tmp,'awards-answer-key.json'),JSON.stringify(fixture));
const password=process.env.AWARDS_TEST_PASSWORD||'isolated-awards-load-password-2026';
const headers={Origin:'http://localhost:5173','X-Awards-Request':'1','Content-Type':'application/json'};
let child,serverLog='',cookie='';const streams=[];const phases=[];const checks=[];
const environment={...process.env,AWARDS_PORT:String(port),AWARDS_STORAGE_DIR:tmp,AWARDS_ADMIN_PASSWORD:password,AWARDS_ANSWER_KEY_FILE:path.join(tmp,'awards-answer-key.json'),NODE_ENV:'test'};
async function start(){child=spawn(process.execPath,['server/awards-server.js'],{env:environment,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>serverLog+=d);child.stderr.on('data',d=>serverLog+=d);}
async function waitReady(){for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/awards/health`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Test service did not start: '+serverLog);}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
const agent=new http.Agent({keepAlive:true,maxSockets:500,maxFreeSockets:500});
async function call(route,body,extra={}){return new Promise((resolve,reject)=>{const encoded=body?JSON.stringify(body):null;const req=http.request(`${base}/api/awards/${route}`,{method:body?'POST':'GET',agent,headers:{...headers,...extra,...(encoded?{'Content-Length':Buffer.byteLength(encoded)}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});res.on('error',reject);});req.setTimeout(12000,()=>req.destroy(new Error('HTTP request timed out')));req.on('error',reject);req.end(encoded);});}
const host=(route,body)=>call(route,body,{Cookie:cookie});
const retryStats={retries:0,recoveredRequests:0,errors:{}};
async function cmd(body){const r=await host('host/command',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
async function burst(name,job,allowed=[200]){
  const starts=[],latencies=[];const begin=performance.now();
  const results=await Promise.all(Array.from({length:N},async(_,i)=>{const start=performance.now();starts.push(start);const r=await job(i);latencies.push(performance.now()-start);assert.ok(allowed.includes(r.status),`${name}: ${r.status}: ${JSON.stringify(r.body)}`);return r;}));
  latencies.sort((a,b)=>a-b);const statuses={};for(const r of results)statuses[r.status]=(statuses[r.status]||0)+1;
  const row={name,requests:N,dispatchWindowMs:+(Math.max(...starts)-Math.min(...starts)).toFixed(1),durationMs:+(performance.now()-begin).toFixed(1),p50Ms:+latencies[Math.ceil(N*.5)-1].toFixed(1),p95Ms:+latencies[Math.ceil(N*.95)-1].toFixed(1),p99Ms:+latencies[Math.ceil(N*.99)-1].toFixed(1),maxMs:+latencies.at(-1).toFixed(1),statuses};
  phases.push(row);console.log(JSON.stringify(row));return results;
}
function connectStream(){return new Promise((resolve,reject)=>{const item={req:null,res:null,revision:-1};const req=http.get(`${base}/api/awards/events`,{agent:false},res=>{item.res=res;let buffer='';let ready=false;res.setEncoding('utf8');res.on('data',chunk=>{buffer+=chunk;let cut;while((cut=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const match=block.match(/data: (\d+)/);if(match){item.revision=Number(match[1]);if(!ready){ready=true;resolve(item);}}}});res.on('error',()=>{});});item.req=req;req.on('error',reject);streams.push(item);});}
let result;
try{
  await start();await waitReady();
  const login=await fetch(`${base}/api/awards/session`,{method:'POST',headers,body:JSON.stringify({password})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('host/state')).status,401);assert.equal((await call('host/command',{type:'reveal',categoryId:shortlist.categories[0].id})).status,401);
  const publicState=(await call('state')).body;assert.equal(publicState.confirmedWinners,undefined);assert.equal(publicState.rankings,undefined);assert.equal(publicState.answers,undefined);assert.equal(publicState.correctAnswers,undefined);assert.ok(publicState.categories.every(c=>!('winners' in c)));checks.push('Unauthenticated host access rejected; unrevealed answers and leaderboard absent from public response.');
  await cmd({type:'open',categoryId:shortlist.categories[0].id});
  const streamStart=performance.now();await Promise.all(Array.from({length:N},connectStream));console.log(`Opened ${N} simultaneous event streams in ${(performance.now()-streamStart).toFixed(1)}ms.`);
  const devices=Array.from({length:N},()=>randomUUID());
  const joined=await burst('500 simultaneous joins',i=>call('join',{deviceId:devices[i],tableNumber:String(i%50+1),name:`Load guest ${String(i+1).padStart(3,'0')}`}));
  joined.forEach((r,i)=>assert.equal(r.body.player.tableNumber,String(i%50+1))); checks.push("All 500 table numbers saved and returned correctly."); const tokens=joined.map(r=>r.body.token);const ids=joined.map(r=>r.body.player.id);assert.equal(new Set(ids).size,N);
  const replayJoins=await burst('500 retried joins',i=>call('join',{deviceId:devices[i],tableNumber:String(i%50+1),name:`Load guest ${i+1}`}));replayJoins.forEach((r,i)=>assert.equal(r.body.player.id,ids[i]));assert.equal((await host('host/state')).body.playerCount,N);
  const c=shortlist.categories[0];const initial=Array.from({length:N},(_,i)=>({categoryId:c.id,nomineeId:c.nominees[i%c.nominees.length].id,expectedVersion:0,requestId:randomUUID()}));
  await burst('500 simultaneous first-category votes',i=>call('votes',initial[i],{'X-Awards-Token':tokens[i]}));
  const replay=await burst('500 identical vote retries',i=>call('votes',initial[i],{'X-Awards-Token':tokens[i]}));assert.ok(replay.every(r=>r.body.duplicate));
  const updated=Array.from({length:N},(_,i)=>({...initial[i],nomineeId:c.nominees[(i+1)%c.nominees.length].id,expectedVersion:1,requestId:randomUUID()}));
  await burst('500 simultaneous changed guesses',i=>call('votes',updated[i],{'X-Awards-Token':tokens[i]}));
  await burst('500 stale-version submissions',i=>call('votes',{...updated[i],requestId:randomUUID()},{'X-Awards-Token':tokens[i]}),[409]);
  let lockPromise;const racePayload=updated.map((v,i)=>({...v,nomineeId:c.nominees[(i+2)%c.nominees.length].id,expectedVersion:2,requestId:randomUUID()}));
  const race=await burst('500 votes racing the host lock',i=>{if(i===250)lockPromise=cmd({type:'lock',categoryId:c.id});return call('votes',racePayload[i],{'X-Awards-Token':tokens[i]});},[200,409]);await lockPromise;
  let state=(await host('host/state')).body;const byId=new Map(state.players.map(p=>[p.id,p]));race.forEach((r,i)=>assert.equal(byId.get(ids[i]).picks[c.id],r.status===200?racePayload[i].nomineeId:updated[i].nomineeId));assert.equal(Object.values(state.voteTotals[c.id]).reduce((a,b)=>a+b,0),N);checks.push('One vote per participant/category; retries did not duplicate votes; stale changes rejected; lock race reconciled exactly.');
  await burst('500 submissions after lock',i=>call('votes',{...racePayload[i],requestId:randomUUID()},{'X-Awards-Token':tokens[i]}),[409]);
  for(const [j,category] of shortlist.categories.entries())if(j){await cmd({type:'open',categoryId:category.id});await burst(`500 votes in category ${j+1}`,i=>call('votes',{categoryId:category.id,nomineeId:category.nominees[i%category.nominees.length].id,expectedVersion:0,requestId:randomUUID()},{'X-Awards-Token':tokens[i]}));await cmd({type:'lock',categoryId:category.id});}
  state=await cmd({type:'finalize'});assert.equal(state.playerCount,N);assert.equal(state.categories.filter(c=>c.status==='locked').length,shortlist.categories.length);
  for(const p of state.players){assert.equal(Object.keys(p.picks).length,shortlist.categories.length);assert.equal(p.score,shortlist.categories.reduce((n,c)=>n+Number(fixture.winners[c.id].includes(p.picks[c.id])),0));}
  checks.push(`All ${N*shortlist.categories.length} participant/category answers persisted; every cumulative score reconciled, including any joint winner earning one point.`);
  await burst('500 authenticated guest state refreshes',i=>call('state',null,{'X-Awards-Token':tokens[i]}));
  const deadline=Date.now()+5000;while(streams.some(s=>s.revision<state.revision)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert.ok(streams.every(s=>s.revision>=state.revision));checks.push('All 500 open event streams received the final revision.');
  for(const s of streams){s.req.destroy();s.res?.destroy();}streams.length=0;
  await stop();await start();await waitReady();
  const after=(await host('host/state')).body;assert.equal(after.playerCount,N);assert.equal(after.finalPublished,true);assert.deepEqual(after.players.map(p=>[p.id,p.picks,p.score]),state.players.map(p=>[p.id,p.picks,p.score]));
  await burst('500 guest reconnects after server restart',i=>call('state',null,{'X-Awards-Token':tokens[i]}));await stop();
  const db=new DatabaseSync(path.join(tmp,'awards.sqlite'),{readOnly:true});assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('SELECT count(*) n FROM votes').get().n,N*shortlist.categories.length);db.close();checks.push('Restart preserved sessions, all votes and scores; SQLite integrity check passed.');
  result={passed:true,generatedAt:new Date().toISOString(),concurrentUsers:N,simultaneousEventStreams:N,totalHttpBurstRequests:phases.reduce((n,p)=>n+p.requests,0),unexpectedFailures:0,retryStats,environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,ramGB:+(os.totalmem()/1024**3).toFixed(1),target:'Isolated local Node/SQLite API; not production hosting or venue Wi-Fi'},phases,checks,limitations:['HTTP/SSE clients, not 500 full browser renderers.','One local API process with durable SQLite WAL; no multi-server failover test.','Production reverse proxy, TLS, DNS and venue Wi-Fi are not covered.']};
  await mkdir('output',{recursive:true});await writeFile('output/awards-load-results.json',JSON.stringify(result,null,2)+'\n');
  const table=phases.map(p=>`| ${p.name} | ${p.requests} | ${p.dispatchWindowMs} | ${p.p95Ms} | ${p.p99Ms} | ${p.maxMs} | ${JSON.stringify(p.statuses)} |`).join('\n');
  await writeFile('output/AWARDS-LOAD-TEST.md',`# Awards concurrency test\n\nPassed on ${result.generatedAt}. **500 concurrent clients, 500 SSE connections, zero unexpected failures.**\n\nTests used isolated temporary data and a synthetic answer key. HTTP requests in each burst were scheduled together; dispatch windows below show the measured spread.\n\n| Phase | Requests | Dispatch window ms | p95 ms | p99 ms | Max ms | HTTP outcomes |\n|---|---:|---:|---:|---:|---:|---|\n${table}\n\n## Verified\n\n${checks.map(c=>'- '+c).join('\n')}\n\n## Environment and limits\n\n${JSON.stringify(result.environment,null,2)}\n\n${result.limitations.map(c=>'- '+c).join('\n')}\n\nExpected HTTP 409 responses are rejected stale or locked submissions, not lost votes. These measurements cover the tested environment and traffic pattern; they cannot guarantee zero issues under all future conditions.\n`);
  console.log(`PASS: 500 clients; ${N*shortlist.categories.length} answers; no unexpected failures; persistence and joint-winner scoring verified.`);
}catch(error){console.error(error.stack);await writeFile('output/awards-load-failure.json',JSON.stringify({error:error.message,phases,checks,serverLog},null,2));process.exitCode=1;}
finally{agent.destroy();for(const s of streams){s.req.destroy();s.res?.destroy();}await stop();const resolved=path.resolve(tmp);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('guess-the-winner-load-'))await rm(resolved,{recursive:true,force:true});}
