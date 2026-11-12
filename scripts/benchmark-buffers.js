// Offline benchmark; does not modify the HTTP transport.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const data=await readFile(process.argv[2] ?? 'fixtures/iphone.html');
const chunks=[];
for(let i=0;i<data.length;i+=16384) chunks.push(new Uint8Array(data.buffer,data.byteOffset+i,Math.min(16384,data.length-i)));
const old=()=>Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));
const candidate=()=>Buffer.concat(chunks);
assert.deepEqual(old(),candidate());
for(let i=0;i<20;i++){old();candidate();}
for(const [name,fn] of [['current',old],['candidate',candidate]]) {
 const start=performance.now();
 for(let i=0;i<200;i++) fn();
 console.log(JSON.stringify({name,iterations:200,bytes:data.length,elapsedMs:performance.now()-start}));
}
