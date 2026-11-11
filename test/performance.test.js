import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHttpAcquirer } from '../src/acquisition.js';
import { executeSearch } from '../src/runtime.js';
import { runSearch } from '../src/search.js';
const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const logger = () => { const lines=[]; return {lines,info:line=>lines.push(line),warning:line=>lines.push(line)}; };
test('medidas HTTP incluyen encabezados, bytes y cuerpo sin alterar Unicode', async () => {
  let timing, sent;
  const text='<html>\u00e1\u6f22\ud83d\ude00</html>';
  const source=createHttpAcquirer({fetchImpl:async u=>{sent=u;return new Response(text,{headers:{'content-type':'text/html'}})},onTiming:t=>{timing=t}});
  assert.equal(await source({query:'iPhone \u00e1'}),text);
  assert.equal(new URL(sent).searchParams.get('q'),'iPhone \u00e1');
  assert.equal(timing.htmlBytes,Buffer.byteLength(text)); assert.equal(timing.requests,1);
  assert.ok(timing.headersMs>=0); assert.ok(timing.bodyReadMs>=0); assert.ok(timing.elapsedMs>=timing.headersMs);
});
test('metricas de deduplicacion no cambian contrato, orden o precio',async()=>{
 const item=(title,price)=>({title,price,url:'/en-us/p/'+title});
 const source=async()=>({results:[item('a',20),item('a',20),item('b',5)]});
 let observed, saved;
 const output=await runSearch({query:'x'},{source,write:async x=>{saved=x},onDeduplication:x=>{observed=x}});
 assert.deepEqual(output,saved); assert.deepEqual(output.results.map(x=>[x.title,x.price]),[['a',20],['b',5]]);
 assert.equal(observed.candidates,3); assert.equal(observed.results,2); assert.ok(observed.elapsedMs>=0);
});
test('html real mantiene Dataset y contabiliza fases', {skip:!html}, async()=>{
 let saved; const log=logger();
 const out=await executeSearch({query:'iPhone 15 Pro',proxyConfiguration:{useApifyProxy:false},maxResults:2},{actor:{pushData:async x=>{saved=x}},log,fetchImpl:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
 assert.deepEqual(out,saved); assert.equal(out.total,2); assert.equal(out.results[0].price,480.2);
 const timing=JSON.parse(log.lines.find(x=>x.startsWith('[TIEMPO_HTTP] ')).slice(14));
 const metrics=JSON.parse(log.lines.find(x=>x.startsWith('[RENDIMIENTO] ')).slice(14));
 assert.ok(timing.htmlBytes>0 && timing.headersMs>=0 && timing.bodyReadMs>=0);
 assert.ok(metrics.cardsParsed>=2 && metrics.parsingMs>=0 && metrics.deduplicationMs>=0 && metrics.datasetMs>=0);
});
test('limite de 4 MiB sigue vigente tambien sin content-length',async()=>{
 const body=new Uint8Array(4*1024*1024+1);
 const source=createHttpAcquirer({fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/html'}})});
 await assert.rejects(source({query:'x'}),{code:'RESPONSE_TOO_LARGE'});
});
