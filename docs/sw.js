import { readTrack } from './storage.js?v=20261101-2';
import { audioResponse } from './media-response.js?v=20261101-2';
const VERSION='20261101-2';
const CACHE=`mp3-easy-player-${VERSION}`;
const base=new URL('./',self.location.href);
const assets=['./','./index.html','./style.css?v='+VERSION,'./app.js?v='+VERSION,'./model.js?v='+VERSION,'./storage.js?v='+VERSION,'./sha256.js?v='+VERSION,'./mp3.js?v='+VERSION,'./media-response.js?v='+VERSION,'./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(assets.map(path=>new Request(new URL(path,base),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for (const name of await caches.keys()) if(name.startsWith('mp3-easy-player-')&&name!==CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==base.origin || !url.pathname.startsWith(base.pathname)) return;
  const prefix=base.pathname+'_audio/';
  if(url.pathname.startsWith(prefix)) {
    event.respondWith((async()=>{
      const id=url.pathname.slice(prefix.length);
      if(!/^[a-f0-9]{64}$/.test(id)) return new Response('Invalid audio identifier',{status:400});
      try {
        const track=await readTrack(id);
        return track?.blob ? audioResponse(track.blob,event.request.headers.get('range'),event.request.method) : new Response('保存した曲が見つかりません。',{status:404});
      } catch {return new Response('保存した曲を読み取れません。',{status:503});}
    })());
    return;
  }
  if(event.request.method!=='GET') return;
  if(event.request.mode==='navigate') {
    event.respondWith((async()=>{
      try {const response=await fetch(event.request);if(response.ok)return response;}catch{}
      return (await caches.open(CACHE)).match(new URL('./index.html',base));
    })());
    return;
  }
  if(assets.some(path=>new URL(path,base).href===url.href)) event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    return (await cache.match(event.request)) || fetch(event.request);
  })());
});
