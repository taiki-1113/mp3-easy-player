import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { audioResponse } from '../docs/media-response.js';

function worker({ failInstall=false }={}) {
  const handlers={}, cached=new Map(), deleted=[];
  let network=0, skipped=0, claimed=0;
  const cache={
    async addAll(requests) {
      if(failInstall)throw new Error('network unavailable');
      for(const request of requests)cached.set(request.url,new Response('cached '+request.url));
    },
    async match(request){return cached.get(typeof request==='string'?request:request.href||request.url)?.clone();},
  };
  const context={ URL, Request, Response, console, audioResponse,
    readTrack:async()=>({blob:new Blob(['0123456789'],{type:'audio/mpeg'})}),
    fetch:async()=>{network++;throw new Error('offline');},
    caches:{open:async()=>cache,keys:async()=>['mp3-easy-player-old','another-app'],delete:async name=>{deleted.push(name);}},
    self:{location:{href:'https://example.test/mp3-easy-player/sw.js?v=20261101-2'},
      addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}},
  };
  const source=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source,context);
  const lifecycle=async name=>{let pending;handlers[name]({waitUntil:value=>{pending=value;}});await pending;};
  const request=async value=>{let pending;handlers.fetch({request:value,respondWith:response=>{pending=response;}});return pending;};
  return {cached,deleted,lifecycle,request,counts:()=>({network,skipped,claimed})};
}

test('オフライン用資材は全件保存してから有効化し、実ファイルと参照版が一致する',async()=>{
  const w=worker();await w.lifecycle('install');
  assert.equal(w.counts().skipped,1);
  const urls=[...w.cached.keys()];
  const asset=new Set(urls);
  for(const url of urls) {
    const path=new URL(url).pathname.replace('/mp3-easy-player/','')||'index.html';
    const local=new URL('../docs/'+path,import.meta.url);
    assert.equal(existsSync(local),true,path);
    if(path.endsWith('.js')||path.endsWith('.html')) {
      for(const match of readFileSync(local,'utf8').matchAll(/(?:from\s*|(?:src|href)=)["'](\.\/[^"']+)["']/g)) {
        const reference=new URL(match[1],url);
        assert.equal(asset.has(reference.href),true,reference.href);
      }
    }
  }
  await w.lifecycle('activate');assert.deepEqual(w.deleted,['mp3-easy-player-old']);assert.equal(w.counts().claimed,1);
  const failed=worker({failInstall:true});await assert.rejects(failed.lifecycle('install'));assert.equal(failed.counts().skipped,0);
});

test('通信不能時の画面要求は保存済みHTMLに戻る',async()=>{
  const w=worker();await w.lifecycle('install');
  const response=await w.request({url:'https://example.test/mp3-easy-player/',method:'GET',mode:'navigate'});
  assert.equal(response.status,200);assert.match(await response.text(),/index.html/);assert.equal(w.counts().network,1);
});

test('端末内音声のRange要求は外部通信せず、他サイトを横取りしない',async()=>{
  const w=worker();const id='a'.repeat(64);
  const response=await w.request(new Request('https://example.test/mp3-easy-player/_audio/'+id,{headers:{Range:'bytes=2-5'}}));
  assert.equal(response.status,206);assert.equal(await response.text(),'2345');assert.equal(w.counts().network,0);
  assert.equal(await w.request(new Request('https://other.test/file.mp3')),undefined);
  const invalid=await w.request(new Request('https://example.test/mp3-easy-player/_audio/bad'));
  assert.equal(invalid.status,400);
});
