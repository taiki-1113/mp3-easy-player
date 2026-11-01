import { removeTrack, removeFolder } from './model.js?v=20261101-6';
export const DATABASE = 'mp3-easy-player';
let opening;
const empty = () => ({ folders:[], members:[], revision:0 });
export function openDatabase() {
  if (!opening) opening = new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('tracks',{keyPath:'id'});
      request.result.createObjectStore('meta');
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('他の画面を閉じて、もう一度開いてください。'));
    request.onsuccess=()=>{
      request.result.onversionchange=()=>{request.result.close();opening=null;};
      resolve(request.result);
    };
  }).catch(error=>{opening=null;throw error;});
  return opening;
}
const requestValue = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
function completion(transaction) {
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(transaction.error || new DOMException('保存処理が中断されました。','AbortError'));
    transaction.onerror=()=>{};
  });
}
export async function readLibrary() {
  const db=await openDatabase(), tx=db.transaction('meta','readonly');
  return (await requestValue(tx.objectStore('meta').get('library'))) || empty();
}
export async function readTrack(id) {
  const db=await openDatabase(), tx=db.transaction('tracks','readonly');
  return requestValue(tx.objectStore('tracks').get(id));
}
export async function storeTrack(file, entry) {
  const db=await openDatabase(), tx=db.transaction(['tracks','meta'],'readwrite'), done=completion(tx);
  try {
    const tracks=tx.objectStore('tracks'), meta=tx.objectStore('meta');
    const [saved,record]=await Promise.all([requestValue(meta.get('library')),requestValue(tracks.get(entry.id))]);
    const library=saved || empty();
    if (record && record.size!==file.size) throw new Error('保存済みのデータと一致しません。');
    const duplicate=library.members.some(item=>item.id===entry.id && item.folder===entry.folder);
    if (!record) tracks.put({id:entry.id,size:file.size,blob:file.slice(0,file.size,'audio/mpeg'),importedAt:Date.now()});
    if (!duplicate) {
      library.members.push({id:entry.id,name:entry.name,folder:entry.folder});
      if (!library.folders.includes(entry.folder)) library.folders.push(entry.folder);
      library.revision=(library.revision || 0)+1;
      meta.put(library,'library');
    }
    await done;
    return {library,newTrack:!record,newMembership:!duplicate};
  } catch(error) {
    try {tx.abort();} catch {}
    await done.catch(()=>{}); throw error;
  }
}
export async function deleteFromLibrary({kind,id,folder}) {
  const db=await openDatabase(), tx=db.transaction(['tracks','meta'],'readwrite'), done=completion(tx);
  try {
    const meta=tx.objectStore('meta'), tracks=tx.objectStore('tracks');
    const before=(await requestValue(meta.get('library'))) || empty();
    const after=kind==='folder' ? removeFolder(before,folder) : removeTrack(before,id,folder);
    const retained=new Set(after.members.map(item=>item.id));
    for (const previous of new Set(before.members.map(item=>item.id))) if (!retained.has(previous)) tracks.delete(previous);
    after.revision=(before.revision || 0)+1;
    meta.put(after,'library');
    await done;
    return after;
  } catch(error) {try {tx.abort();} catch {} await done.catch(()=>{});throw error;}
}
