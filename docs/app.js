import { entries, sortedFolders, createPlayer, selectTrack, selectAllTracks, setPlaybackOrder, step, reconcilePlayer } from './model.js?v=20261101-3';
import { readLibrary, readTrack, storeTrack, deleteFromLibrary } from './storage.js?v=20261101-3';
import { hashBlob } from './sha256.js?v=20261101-3';
import { validateMp3, sourceInfo } from './mp3.js?v=20261101-3';

const VERSION='20261101-3', base=new URL('./',location.href);
const app=document.querySelector('#app'), status=document.querySelector('#announcement');
const dialog=document.querySelector('#confirm-dialog'), audio=document.querySelector('#audio');
const folderInput=document.querySelector('#folder-input'), filesInput=document.querySelector('#files-input');
let library={folders:[],members:[]}, player=createPlayer();
let screen='home', view='folders', allOrder='ordered', folder=null, managing=false;
let importState='ready', importing=false, abortImport=null, result=null, fatal='';
let pendingDelete=null, restoreFocusId=null, announcementTimer, deleting=false;
let sourceToken=0, objectUrl=null, allowedToPlay=false, preparing=false, playbackError='';
let failedTracks=new Set(), handledError=-1, wakeLock=null, lastTimeUpdate=0;
const changes='BroadcastChannel' in window?new BroadcastChannel('mp3-library-changes'):null;
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const button=(id,text,cls='',attrs='')=>`<button type="button" id="${id}" class="${cls}" ${attrs}>${text}</button>`;
const heading=text=>`<h1 id="screen-title" tabindex="-1">${text}</h1>`;
const back=button('home','ホームへ戻る','back');
const current=()=>player.queue[player.index];
const canStartAll=()=>view==='all'&&library.members.length>0;
const modeFolder=()=>view==='all'?null:folder;
const orderLabel=order=>order==='shuffle'?'シャッフル再生':'順番に再生';
const queueDescription=()=>`${player.context??'すべての曲'}。${player.context===null?orderLabel(player.order)+'。':''}${player.queue.length}曲を繰り返します。`;
const focus=id=>document.getElementById(id)?.focus();
const time=seconds=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}分${Math.floor(seconds%60)}秒`:'時間不明';
function announce(message) {
  clearTimeout(announcementTimer);status.textContent='';
  announcementTimer=setTimeout(()=>{status.textContent=message;},90);
}
function readableError(error) {
  if(error?.name==='QuotaExceededError')return '空き容量が足りません。端末の空き容量を確保して再試行してください。';
  if(['NotReadableError','NotFoundError','SecurityError'].includes(error?.name))return 'ファイルを読み取れません。カードの接続とフォルダを確認してください。';
  if(error?.name==='AbortError')return '処理を中断しました。保存済みの曲は残っています。';
  return error?.message&&!/database|indexeddb|transaction|object.?store|request/i.test(error.message)?error.message:'端末内の保存先を利用できません。画面を読み込み直して再試行してください。';
}
function playbackState() {
  return playbackError || (preparing?'曲を読み込んでいます。':current()?(player.playing?'再生中':'一時停止中'):canStartAll()?'再生ボタンで、すべての曲を再生します。':'一覧から曲を選んでください。');
}
function playback() {
  const item=current(), unavailable=item?'':'aria-disabled="true"';
  return `<section class="playback" aria-label="再生操作"><div class="transport">
  ${button('play',player.playing?'一時停止':'再生','primary',(item||canStartAll()?'':'aria-disabled="true"')+' aria-describedby="playback-state"')}
  ${button('next','次の曲','',unavailable)}${button('previous','前の曲','',unavailable)}</div>
  <p class="playing-name" id="current-name">${item?esc(item.name):canStartAll()?'すべての曲':'曲を選んでください'}</p>
  <p class="state" id="playback-state">${esc(playbackState())}</p>
  <p class="subtle" id="playback-time">${item?`${time(audio.currentTime)}／${time(audio.duration)}`:''}</p>
  <p class="subtle" id="queue-info" ${item?'':'hidden'}>${item?esc(queueDescription()):''}</p></section>`;
}
function rowDetail(item,deletion=false) {
  return esc((deletion?'削除の確認へ':current()?.id===item.id?(player.playing?'再生中':'選択中'):'選んで再生')+(view==='all'?' ・ '+item.folder:''));
}
function rows(items,deletion=false) {
  if(!items.length)return '<p>曲がありません。取り込み画面から追加できます。</p>';
  return `<ul aria-label="${deletion?'削除する曲':'曲の一覧'}">${items.map((item,index)=>`<li><button type="button" class="row" id="track-${item.id}" data-${deletion?'delete':'track'}="${item.id}" ${!deletion&&current()?.id===item.id?'aria-current="true"':''} aria-label="${esc(item.name)}${view==='all'?'、'+esc(item.folder):''}、${items.length}曲中${index+1}曲目、${deletion?'削除の確認へ':'再生する'}"><span class="title">${esc(item.name)}</span><span class="detail">${rowDetail(item,deletion)}</span></button></li>`).join('')}</ul>`;
}
function render(focusId=null) {
  clearTimeout(announcementTimer);status.textContent='';
  if(fatal)app.innerHTML=`${heading('保存先を開けません')}<p>${esc(fatal)}</p>${button('retry','もう一度試す','primary')}`;
  else if(screen==='home')app.innerHTML=`${heading('音楽を楽しむ')}<p>聴く、取り込む。ここから始めます。</p><div class="home-actions">${button('listen','音楽を聴く','primary','aria-describedby="library-count"')}${button('import','音楽を取り込む')}</div><p class="subtle" id="library-count">保存済み${entries(library).length}曲・${library.folders.length}フォルダ</p>`;
  else if(screen==='library') {
    const atFolders=view==='folders'&&folder===null;
    if(managing)app.innerHTML=`${heading('曲の削除')}<p>削除する曲を選びます。確認するまでは削除されません。</p><p class="subtle">${view==='all'?'すべての曲：削除すると、すべてのフォルダから外れます。':esc(folder)+'：別のフォルダにある曲は残ります。'}</p>${button('manage-done','削除を終えて曲一覧へ戻る')}${rows(entries(library,modeFolder()),true)}${folder&&view==='folders'?button('delete-folder','このフォルダをまとめて削除','danger'):''}${back}`;
    else {
      const items=atFolders?[]:entries(library,modeFolder());
      app.innerHTML=`${heading('音楽を聴く')}${playback()}<label for="view-mode">曲の表示方法</label><select id="view-mode"><option value="folders" ${view==='folders'?'selected':''}>フォルダ別</option><option value="all" ${view==='all'?'selected':''}>すべての曲</option></select>
      ${view==='all'?`<label for="play-order">すべての曲の再生方法</label><select id="play-order" aria-describedby="order-help"><option value="ordered" ${allOrder==='ordered'?'selected':''}>順番に再生</option><option value="shuffle" ${allOrder==='shuffle'?'selected':''}>シャッフル再生</option></select><p class="subtle" id="order-help">一覧の並びは変えず、再生する順番を切り替えます。</p>`:''}
      <h2 id="list-title" tabindex="-1">${atFolders?'フォルダを選ぶ':esc(view==='all'?'すべての曲':folder)}</h2>
      ${atFolders?(library.folders.length?`<ul aria-label="フォルダ一覧">${sortedFolders(library).map((name,index)=>`<li><button type="button" class="row" id="folder-${index}" data-folder="${esc(name)}"><span class="title">${esc(name.replaceAll('/',' ／ '))}</span><span class="detail">${entries(library,name).length}曲</span></button></li>`).join('')}</ul>`:'<p>まだ曲がありません。「音楽を取り込む」からフォルダを選んでください。</p>'):`<p class="subtle">${items.length}曲。${view==='all'?'フォルダ名順、各フォルダ内はファイル名順。':'ファイル名順。'}</p>${folder?button('folders','フォルダ一覧へ戻る'):''}${rows(items)}`}
      <div class="section-actions">${!atFolders&&(items.length||folder)?button('manage','曲を削除する'):''}${!library.members.length?button('import','音楽を取り込む','primary'):''}</div>${back}`;
    }
  } else if(screen==='import') {
    if(importState==='ready')app.innerHTML=`${heading('音楽を取り込む')}<p>カード内の音楽フォルダを1つ選びます。サブフォルダのMP3もまとめて保存します。</p><p class="subtle">毎回同じ取り込み元フォルダを選んでください。保存中は画面を開いたままにし、カードを外さないでください。</p><div class="stack">${button('choose-folder','取り込み元のフォルダを選ぶ','primary')}</div><details><summary>フォルダを選択できないとき</summary><p>iPhoneのiOSとSafariを確認してください。MP3を複数まとめて選ぶこともできます。</p>${button('choose-files','MP3をまとめて選ぶ')}</details>${back}`;
    else if(importState==='running')app.innerHTML=`${heading('取り込み中')}<p id="import-progress" tabindex="-1">取り込みを開始します。</p><p>この画面を開いたままお待ちください。</p>${button('cancel-import','取り込みを中止')}`;
    else {
      const r=result, summary=`${r.stopped?'取り込みを中断しました。':''}新しく${r.newTracks}曲を保存しました。${r.duplicates}件は取り込み済み、失敗${r.failures.length}件、未処理${r.total-r.processed}件です。${r.skipped?'隠しファイルなど'+r.skipped+'件は対象外です。':''}`;
      app.innerHTML=`${heading('取り込み結果')}<div class="result"><p id="import-result" tabindex="-1">${esc(summary)}</p>${r.memberships?`<p>既存の曲を別のフォルダに${r.memberships}件追加しました。</p>`:''}${r.reason?`<p>${esc(r.reason)}</p>`:''}${r.total===0?'<p>MP3がありません。取り込み元フォルダを確認してください。</p>':''}</div><div class="stack">${button('listen','音楽を聴く','primary')}${button('again','もう一度取り込む')}</div>${r.failures.length?`<details><summary>保存できなかった曲を確認</summary><ul>${r.failures.map(item=>`<li><p>${esc(item.name)}。${esc(item.reason)}</p></li>`).join('')}</ul></details>`:''}${back}`;
    }
  }
  document.title=`${app.querySelector('h1')?.textContent??'音楽'}｜MP3かんたんプレイヤー`;
  if(focusId)focus(focusId);
}
function updatePlayback(message=null) {
  const item=current(), play=document.getElementById('play');
  if(play) {
    play.textContent=player.playing?'一時停止':'再生';
    for(const id of ['play','next','previous']){const e=document.getElementById(id);if(item||(id==='play'&&canStartAll()))e.removeAttribute('aria-disabled');else e.setAttribute('aria-disabled','true');}
    document.getElementById('current-name').textContent=item?.name??(canStartAll()?'すべての曲':'曲を選んでください');
    document.getElementById('playback-state').textContent=playbackState();
    const info=document.getElementById('queue-info');info.hidden=!item;info.textContent=item?queueDescription():'';
    updateTime();
    app.querySelectorAll('[data-track]').forEach(row=>{
      const entry=entries(library,modeFolder()).find(value=>value.id===row.dataset.track);if(!entry)return;
      if(item?.id===entry.id)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
      row.querySelector('.detail').innerHTML=rowDetail(entry);
    });
  }
  if(message)announce(message);
}
function updateTime() {
  const element=document.getElementById('playback-time');
  if(element)element.textContent=current()?`${time(audio.currentTime)}／${time(audio.duration)}`:'';
  if('mediaSession' in navigator&&Number.isFinite(audio.duration)&&audio.duration>0)try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(audio.currentTime,audio.duration)});}catch{}
}
function updateSystemMedia() {
  if(!('mediaSession' in navigator))return;
  const item=current();
  if(!item){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';return;}
  if('MediaMetadata' in window)navigator.mediaSession.metadata=new MediaMetadata({title:item.name,artist:item.folder,album:'端末に保存した音楽'});
  navigator.mediaSession.playbackState=player.playing?'playing':'paused';updateTime();
}
function stopPlayback(message='') {
  ++sourceToken;allowedToPlay=false;audio.pause();audio.removeAttribute('src');audio.load();
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  player=createPlayer();preparing=false;playbackError=message;updateSystemMedia();updatePlayback(message);
}
async function startCurrent(userAction=false) {
  const item=current();if(!item)return;
  const token=++sourceToken;handledError=-1;preparing=true;playbackError='';player.playing=false;allowedToPlay=true;
  if(userAction)failedTracks.clear();updatePlayback();updateSystemMedia();
  try {
    let url;
    if(navigator.serviceWorker?.controller)url=new URL('_audio/'+item.id,base).href;
    else {const record=await readTrack(item.id);if(token!==sourceToken)return;if(!record?.blob)throw new Error('保存した曲が見つかりません。元のフォルダから取り込み直してください。');url=URL.createObjectURL(record.blob);}
    const old=objectUrl;objectUrl=url.startsWith('blob:')?url:null;audio.src=url;
    const started=audio.play();if(old)URL.revokeObjectURL(old);await started;
  } catch(error) {
    if(token!==sourceToken||error.name==='AbortError')return;
    if(error.name==='NotAllowedError'){allowedToPlay=false;preparing=false;player.playing=false;playbackError='自動再生が停止しました。「再生」を押してください。';updatePlayback(playbackError);updateSystemMedia();return;}
    handleAudioFailure();
  }
}
function handleAudioFailure() {
  if(handledError===sourceToken||!current())return;
  handledError=sourceToken;const name=current().name;failedTracks.add(current().id);
  if(player.queue.every(item=>failedTracks.has(item.id))){stopPlayback('再生できる曲がないため停止しました。元のファイルを確認し、取り込み直してください。');return;}
  do{player=step(player,1);}while(failedTracks.has(current().id));
  void startCurrent();announce(`「${name}」を再生できません。次の曲「${current().name}」へ進みます。`);
}
function moveTrack(delta) {
  if(!current())return;player=step(player,delta);void startCurrent(true);announce(`「${current().name}」を再生します。`);
}
function togglePlayback() {
  if(!player.playing&&!preparing&&canStartAll()&&(!current()||player.context!==null)){
    player=selectAllTracks(library,allOrder);void startCurrent(true);announce(`すべての曲を${orderLabel(allOrder)}します。`);return;
  }
  if(!current()){announce('一覧から曲を選んでください。');return;}
  if(player.playing||preparing){allowedToPlay=false;++sourceToken;audio.pause();preparing=false;player.playing=false;updatePlayback('一時停止しました。');updateSystemMedia();}
  else {
    playbackError='';allowedToPlay=true;preparing=true;updatePlayback();
    if(!audio.getAttribute('src')){void startCurrent(true);return;}
    const token=sourceToken;
    audio.play().catch(()=>{if(token!==sourceToken)return;preparing=false;player.playing=false;allowedToPlay=false;playbackError='再生できませんでした。再生を押すか、別の曲を選んでください。';updatePlayback(playbackError);});
  }
}
audio.addEventListener('playing',()=>{if(!allowedToPlay){audio.pause();return;}preparing=false;player.playing=true;playbackError='';updatePlayback();updateSystemMedia();});
audio.addEventListener('pause',()=>{if(audio.ended||!audio.paused)return;allowedToPlay=false;preparing=false;player.playing=false;updatePlayback();updateSystemMedia();});
audio.addEventListener('ended',()=>{
  if(!current())return;player=step(player,1);
  for(let i=0;i<player.queue.length&&failedTracks.has(current().id);i++)player=step(player,1);
  void startCurrent();
});
audio.addEventListener('error',()=>{if(audio.error)handleAudioFailure();});
audio.addEventListener('loadedmetadata',()=>{updateTime();updateSystemMedia();});
audio.addEventListener('timeupdate',()=>{if(Date.now()-lastTimeUpdate>5000){lastTimeUpdate=Date.now();updateTime();}});
try{if(navigator.audioSession){navigator.audioSession.type='playback';navigator.audioSession.addEventListener('statechange',()=>{if(navigator.audioSession.state==='interrupted'){allowedToPlay=false;audio.pause();}});}}catch{}
if('mediaSession' in navigator)for(const [action,handler]of Object.entries({
  play:()=>{if(!player.playing)togglePlayback();},pause:()=>{allowedToPlay=false;audio.pause();},nexttrack:()=>moveTrack(1),previoustrack:()=>moveTrack(-1),
  seekto:event=>{if(Number.isFinite(event.seekTime)){audio.currentTime=Math.max(0,Math.min(event.seekTime,audio.duration||0));updateTime();}},
}))try{navigator.mediaSession.setActionHandler(action,handler);}catch{}

async function importFiles(files) {
  if(importing||deleting)return;
  const selected=[...files].filter(file=>/\.mp3$/i.test(file.name)), compare=new Intl.Collator('ja',{numeric:true}).compare;
  selected.sort((a,b)=>compare(a.webkitRelativePath||a.name,b.webkitRelativePath||b.name));
  importing=true;abortImport=new AbortController();importState='running';screen='import';
  result={total:selected.length,processed:0,newTracks:0,memberships:0,duplicates:0,skipped:0,failures:[],stopped:false,reason:''};render('screen-title');
  try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}
  try{await navigator.storage?.persist?.();}catch{}
  try {
    for(let index=0;index<selected.length;index++) {
      if(abortImport.signal.aborted){result.stopped=true;break;}
      const file=selected[index];document.getElementById('import-progress').textContent=`${selected.length}曲中${index+1}曲目「${file.name}」を確認中。新規保存${result.newTracks}曲。`;
      try {
        const info=sourceInfo(file);if(!info){result.processed++;result.skipped++;continue;}
        await validateMp3(file);const id=await hashBlob(file,abortImport.signal);
        if(!library.members.some(item=>item.id===id)&&navigator.storage?.estimate){const space=await navigator.storage.estimate();if(space.quota&&space.quota-(space.usage||0)<file.size+1024*1024)throw new DOMException('容量不足','QuotaExceededError');}
        abortImport.signal.throwIfAborted();const saved=await storeTrack(file,{...info,id});library=saved.library;
        if(saved.newTrack)result.newTracks++;else if(saved.newMembership)result.memberships++;else result.duplicates++;result.processed++;
      } catch(error) {
        if(error.name==='AbortError'){result.stopped=true;break;}
        if(['QuotaExceededError','NotReadableError','NotFoundError','SecurityError'].includes(error.name)){result.stopped=true;result.reason=readableError(error);break;}
        result.failures.push({name:file.name,reason:readableError(error)});result.processed++;
      }
    }
  } finally {
    if(abortImport.signal.aborted){result.stopped=true;result.reason||='取り込みを中断しました。保存済みの曲は残っています。同じフォルダを選ぶと続きの曲を保存できます。';}
    importing=false;abortImport=null;importState='result';try{await wakeLock?.release();}catch{}wakeLock=null;
    folderInput.value='';filesInput.value='';changes?.postMessage('changed');render('import-result');
  }
}
function go(next){screen=next;managing=false;render('screen-title');}
function askDelete(kind,id,triggerId) {
  if(importing||deleting)return;
  const item=entries(library,modeFolder()).find(entry=>entry.id===id);
  pendingDelete={kind,id,folder:modeFolder(),name:item?.name??folder};restoreFocusId=triggerId;
  document.getElementById('confirm-title').textContent=kind==='folder'?'フォルダ削除の確認':'曲の削除の確認';
  document.getElementById('confirm-description').textContent=kind==='folder'?`「${folder}」と配下のサブフォルダを端末から削除します。別フォルダにもある曲は、そちらに残ります。`:view==='all'?`「${item.name}」を端末とすべてのフォルダから削除します。`:`「${folder}」から「${item.name}」を外します。別フォルダにもある曲は、そちらに残ります。`;
  dialog.showModal();requestAnimationFrame(()=>focus('cancel-delete'));
}
app.addEventListener('change',event=>{
  if(event.target.id==='view-mode'){view=event.target.value;folder=null;render('view-mode');announce(view==='all'?`すべての曲、${entries(library).length}曲。`:'フォルダ別に切り替えました。');}
  if(event.target.id==='play-order'){allOrder=event.target.value;player=setPlaybackOrder(player,allOrder);updatePlayback(`${orderLabel(allOrder)}を選びました。現在の曲は変わりません。`);}
});
app.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.getAttribute('aria-disabled')==='true'){announce('一覧から曲を選んでください。');return;}
  if(target.dataset.folder!==undefined){folder=target.dataset.folder;render('list-title');return;}
  if(target.dataset.track){player=selectTrack(library,modeFolder(),target.dataset.track,allOrder);void startCurrent(true);announce(`「${current().name}」を再生します。`);return;}
  if(target.dataset.delete){askDelete('track',target.dataset.delete,target.id);return;}
  switch(target.id) {
    case 'listen':go('library');break;
    case 'home':go('home');break;
    case 'import':case 'again':importState='ready';go('import');break;
    case 'choose-folder':folderInput.click();break;
    case 'choose-files':filesInput.click();break;
    case 'cancel-import':abortImport?.abort();target.setAttribute('aria-disabled','true');announce('中止しています。保存済みの曲は残ります。');break;
    case 'play':togglePlayback();break;
    case 'next':moveTrack(1);break;
    case 'previous':moveTrack(-1);break;
    case 'folders':folder=null;render('list-title');break;
    case 'manage':managing=true;render('screen-title');break;
    case 'manage-done':managing=false;render('manage');break;
    case 'delete-folder':askDelete('folder',null,'delete-folder');break;
    case 'retry':void initialize();break;
  }
});
for(const input of [folderInput,filesInput]){
  input.addEventListener('change',()=>{if(input.files?.length)void importFiles(input.files);});
  input.addEventListener('cancel',()=>announce('選択をキャンセルしました。保存済みの音楽は変わりません。'));
}
document.getElementById('cancel-delete').addEventListener('click',()=>{if(!deleting)dialog.close();});
dialog.addEventListener('cancel',event=>{if(deleting)event.preventDefault();else pendingDelete=null;});
dialog.addEventListener('close',()=>{pendingDelete=null;focus(restoreFocusId);});
document.getElementById('confirm-delete').addEventListener('click',async()=>{
  if(!pendingDelete||deleting)return;
  const change=pendingDelete,oldId=current()?.id,wasPlaying=player.playing;deleting=true;
  for(const id of ['confirm-delete','cancel-delete'])document.getElementById(id).disabled=true;
  try {
    library=await deleteFromLibrary(change);player=reconcilePlayer(player,library);const moved=oldId!==current()?.id;
    if(moved){if(current()){if(wasPlaying)void startCurrent();else{audio.pause();audio.removeAttribute('src');audio.load();preparing=false;}}else stopPlayback();}
    if(change.kind==='folder'){folder=null;managing=false;}
    const remaining=entries(library,modeFolder());restoreFocusId=managing?(remaining[0]?`track-${remaining[0].id}`:'manage-done'):'list-title';
    dialog.close();render(restoreFocusId);changes?.postMessage('changed');updateSystemMedia();
    announce(`削除しました。${moved?(current()?'次の曲「'+current().name+'」を選びました。':'再生対象がないため停止しました。'):''}`);
  } catch(error){announce(`削除できませんでした。${readableError(error)}`);}
  finally{deleting=false;for(const id of ['confirm-delete','cancel-delete'])document.getElementById(id).disabled=false;}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&importing){result.reason='画面を離れたため中断しました。保存済みの曲は残っています。';abortImport?.abort();}});
async function refreshLibrary() {
  if(importing||deleting||dialog.open)return;
  try {
    const next=await readLibrary();if(next.revision===library.revision)return;
    const old=current()?.id;library=next;player=reconcilePlayer(player,library);
    if(old&&!current())stopPlayback('別の画面で曲が削除されたため停止しました。');else if(old!==current()?.id&&player.playing)void startCurrent();
    if(folder&&!library.folders.includes(folder)){folder=null;managing=false;}
    render('screen-title');announce('保存した曲の一覧を更新しました。');
  }catch{}
}
if(changes)changes.onmessage=()=>void refreshLibrary();
window.addEventListener('focus',()=>void refreshLibrary());
document.getElementById('reload-app').addEventListener('click',()=>{if(importing){announce('取り込みが終わってから読み込み直してください。');return;}audio.pause();location.reload();});
async function setupOffline() {
  const element=document.getElementById('offline-state');
  if(!('serviceWorker' in navigator)){element.textContent='オフライン起動の準備ができません。Safariで開いてください。';return;}
  try {
    const url=new URL('sw.js?v='+VERSION,base);
    const registration=await navigator.serviceWorker.register(url,{type:'module',scope:base.pathname,updateViaCache:'none'});
    // An older active worker does not prove the current release was cached.
    const worker=registration.installing||registration.waiting||registration.active;
    if(!worker||worker.scriptURL!==url.href)throw new Error('更新の準備待ち');
    await new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',check);error?reject(error):resolve();};
      const check=()=>{if(worker.state==='activated')finish();else if(worker.state==='redundant')finish(new Error('資材を保存できません'));};
      const timer=setTimeout(()=>finish(new Error('準備が終わりません')),30000);
      worker.addEventListener('statechange',check);check();
    });
    element.textContent='オフライン利用の準備ができました。保存した曲は通信なしで再生できます。';
  }catch{element.textContent='オフラインの準備が完了していません。通信できる状態で画面を読み込み直してください。保存済みの曲は残っています。';}
}
async function initialize() {
  app.setAttribute('aria-busy','true');
  try{library=await readLibrary();fatal='';render('screen-title');}catch(error){fatal=readableError(error);render('screen-title');}
  finally{app.removeAttribute('aria-busy');}
}
void initialize();void setupOffline();
