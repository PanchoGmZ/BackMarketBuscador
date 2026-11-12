import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeSearch } from '../src/runtime.js';
import { effectiveProxyConfiguration } from '../src/input.js';
import { assertLocalProxyAuth } from '../src/local-auth.js';
import { validateInput } from '../src/search.js';

const html=await readFile(new URL('../fixtures/iphone.html',import.meta.url),'utf8').catch(e=>{if(e.code==='ENOENT') return null;throw e;});
const log=()=>({info(){},warning(){}});
const unblocker={useApifyProxy:true,apifyProxyGroups:['UNBLOCKER']};
test('formulario solo admite query y usa el ejemplo solicitado', async()=>{
 const schema=JSON.parse(await readFile(new URL('../.actor/input_schema.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(schema.properties),['query']); assert.deepEqual(schema.required,['query']);
 assert.equal(schema.properties.query.prefill,'iphone 13');
 assert.deepEqual(validateInput({query:'iphone 13'}),{query:'iphone 13',maxResults:10,page:1});
});
test('defaults locales directos no requieren credenciales y se conservan opciones anteriores',()=>{
 const input={query:'iphone 13'};
 assert.deepEqual(effectiveProxyConfiguration(input,false),{useApifyProxy:false});
 assert.doesNotThrow(()=>assertLocalProxyAuth({...input,proxyConfiguration:effectiveProxyConfiguration(input,false)},{}));
 assert.deepEqual(validateInput({query:'iphone 13',maxResults:3,page:1,diagnosticMode:true}),{query:'iphone 13',maxResults:3,page:1});
 assert.deepEqual(effectiveProxyConfiguration({proxyConfiguration:{useApifyProxy:true,apifyProxyGroups:['UNBLOCKER']}},false),unblocker);
});
for (const oldProxy of [undefined,{useApifyProxy:false},{useApifyProxy:true,apifyProxyGroups:['OTHER']},{proxyUrls:['http://example.test:1234']}]) {
 test('Cloud usa UNBLOCKER para proxy previo '+JSON.stringify(oldProxy),{skip:!html},async()=>{
  let config,saved,calls=0,closed=0;
  const agent={close:async()=>{closed++}};
  const actor={isAtHome:()=>true,createProxyConfiguration:async c=>{config=c;return {newUrl:async()=> 'http://user:pass@proxy.test:8000'}},pushData:async value=>{saved=value}};
  const input={query:'iPhone 15 Pro',...(oldProxy===undefined?{}:{proxyConfiguration:oldProxy})};
  const result=await executeSearch(input,{actor,log:log(),makeProxyAgent:(_url,opts)=>{assert.deepEqual(opts,{requestTls:{rejectUnauthorized:false}});return agent;},fetchImpl:async (_url,opts)=>{assert.equal(opts.dispatcher,agent);calls++;return new Response(html,{headers:{'content-type':'text/html'}})}});
  assert.deepEqual(config,unblocker);assert.equal(result.total,10);assert.deepEqual(saved,result);assert.equal(calls,1);assert.equal(closed,1);
 });
}
test('local query unico es directo, sin ProxyAgent, y guarda resultados', {skip:!html},async()=>{
 let saved;
 const actor={isAtHome:()=>false,createProxyConfiguration:()=>assert.fail('proxy innecesario'),pushData:async x=>{saved=x}};
 const output=await executeSearch({query:'iPhone 15 Pro'},{actor,log:log(),makeProxyAgent:()=>assert.fail('proxy innecesario'),fetchImpl:async (_url,o)=>{assert.equal(o.dispatcher,undefined);return new Response(html,{headers:{'content-type':'text/html'}})}});
 assert.equal(output.total,10);assert.deepEqual(output,saved);assert.equal(output.results[0].price,480.2);
});
test('Cloud propaga error de UNBLOCKER sin fallback directo',async()=>{
 let called=0;
 const actor={isAtHome:()=>true,createProxyConfiguration:async()=>{throw Error('unavailable')}};
 await assert.rejects(executeSearch({query:'iphone 13'},{actor,log:log(),fetchImpl:async()=>{called++}}),{code:'PROXY_ERROR'});
 assert.equal(called,0);
});
