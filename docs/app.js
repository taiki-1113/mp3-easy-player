import { initialLibrary, entries, sortedFolders, importSample, removeTrack, removeFolder, createPlayer, selectTrack, setPlaybackOrder, step, reconcilePlayer } from './model.js';

const app = document.querySelector('#app');
const status = document.querySelector('#announcement');
const dialog = document.querySelector('#confirm-dialog');
let library = initialLibrary();
let player = createPlayer();
let screen = 'home';
let view = 'folders';
let allOrder = 'ordered';
let folder = null;
let managing = false;
let importState = 'ready';
let result = null;
let importTimer;
let pendingDelete = null;
let restoreFocusId = null;
let announcementTimer;

// Only fixed sample names are used, but escape all names at the DOM boundary.
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const button = (id, text, className = '', attrs = '') => `<button type="button" id="${id}" class="${className}" ${attrs}>${text}</button>`;
const title = text => `<h1 id="screen-title" tabindex="-1">${text}</h1>`;
const back = button('home', 'ホームへ戻る', 'back');
const current = () => player.queue[player.index];
const modeFolder = () => view === 'all' ? null : folder;
const orderLabel = order => order === 'shuffle' ? 'シャッフル再生' : '順番に再生';
const queueDescription = () => `${player.context ?? 'すべての曲'}。${player.context === null ? orderLabel(player.order) + '。' : ''}${player.queue.length}曲を繰り返します。`;

function announce(text) {
  clearTimeout(announcementTimer);
  status.textContent = '';
  announcementTimer = setTimeout(() => { status.textContent = text; }, 80);
}
function focus(id) {
  document.getElementById(id)?.focus();
}
function playbackText() {
  const item = current();
  return item ? `${item.name}。${player.playing ? '再生中' : '一時停止中'}の操作見本です。` : '曲は選ばれていません。一覧から曲を選んでください。';
}
function playback() {
  const item = current();
  const inactive = item ? '' : 'aria-disabled="true"';
  return `<section class="playback" aria-label="再生操作">
    <div class="transport">
      ${button('play', player.playing ? '一時停止' : '再生', 'primary', inactive + ' aria-describedby="playback-state"')}
      ${button('next', '次の曲', '', inactive)}
      ${button('previous', '前の曲', '', inactive)}
    </div>
    <p class="playing-name" id="current-name">${item ? esc(item.name) : '曲を選んでください'}</p>
    <p class="state" id="playback-state">${item ? (player.playing ? '再生中の操作見本・音は出ません' : '一時停止中の操作見本・音は出ません') : '一覧から曲を選ぶと、再生操作を確認できます。'}</p>
    <p class="subtle" id="queue-info" ${item ? '' : 'hidden'}>${item ? esc(queueDescription()) : ''}</p>
  </section>`;
}
function rows(items, deletion = false) {
  if (!items.length) return '<p>曲がありません。取り込み画面から追加できます。</p>';
  return `<ul aria-label="${deletion ? '削除する曲' : '曲の一覧'}">${items.map((item, index) => `<li>
    <button type="button" class="row" id="track-${item.id}" data-${deletion ? 'delete' : 'track'}="${item.id}" ${!deletion && current()?.id === item.id ? 'aria-current="true"' : ''} aria-label="${esc(item.name)}${view === 'all' ? '、' + esc(item.folder) : ''}、${items.length}曲中${index + 1}曲目${deletion ? '、削除の確認へ' : '、再生する'}">
      <span class="title">${esc(item.name)}</span>
      <span class="detail">${deletion ? '削除の確認へ' : (current()?.id === item.id ? (player.playing ? '再生中の操作見本' : '一時停止中の操作見本') : '選んで再生')}${view === 'all' ? ' ・ ' + esc(item.folder) : ''}</span>
    </button></li>`).join('')}</ul>`;
}
function render(focusId = null) {
  clearTimeout(announcementTimer);
  status.textContent = '';
  if (screen === 'home') {
    app.innerHTML = `${title('音楽を楽しむ')}<p>聴く、取り込む。ここから始めます。</p>
      <div class="home-actions">${button('listen', '音楽を聴く', 'primary', 'aria-describedby="library-count"')}${button('import', '音楽を取り込む')}</div>
      <p class="subtle" id="library-count">サンプル${entries(library).length}曲・${library.folders.length}フォルダ</p>`;
  } else if (screen === 'library') {
    const atFolderList = view === 'folders' && folder === null;
    if (managing) {
      const items = entries(library, modeFolder());
      app.innerHTML = `${title('曲の削除')}<p>削除する曲を選びます。確認するまでは削除されません。</p>
        <p class="subtle">${view === 'all' ? 'すべての曲：削除すると、すべてのフォルダから外れます。' : esc(folder) + '：別のフォルダにある曲は残ります。'}</p>
        ${button('manage-done', '削除を終えて曲一覧へ戻る')}
        ${rows(items, true)}
        ${folder && view === 'folders' ? button('delete-folder', 'このフォルダをまとめて削除', 'danger') : ''}${back}`;
    } else {
      const items = atFolderList ? [] : entries(library, modeFolder());
      app.innerHTML = `${title('音楽を聴く')}${playback()}
        <label for="view-mode">曲の表示方法</label>
        <select id="view-mode"><option value="folders" ${view === 'folders' ? 'selected' : ''}>フォルダ別</option><option value="all" ${view === 'all' ? 'selected' : ''}>すべての曲</option></select>
        ${view === 'all' ? `<label for="play-order">すべての曲の再生方法</label><select id="play-order" aria-describedby="order-help"><option value="ordered" ${allOrder === 'ordered' ? 'selected' : ''}>順番に再生</option><option value="shuffle" ${allOrder === 'shuffle' ? 'selected' : ''}>シャッフル再生</option></select><p class="subtle" id="order-help">一覧の並びは変えず、再生する順番を切り替えます。</p>` : ''}
        <h2 id="list-title" tabindex="-1">${atFolderList ? 'フォルダを選ぶ' : esc(view === 'all' ? 'すべての曲' : folder)}</h2>
        ${atFolderList ? (library.folders.length ? `<ul aria-label="フォルダ一覧">${sortedFolders(library).map((name, index) => `<li><button type="button" class="row" id="folder-${index}" data-folder="${esc(name)}"><span class="title">${esc(name.replaceAll('/', ' ／ '))}</span><span class="detail">${entries(library, name).length}曲</span></button></li>`).join('')}</ul>` : '<p>フォルダがありません。取り込み画面から追加できます。</p>') : `<p class="subtle">${items.length}曲。${view === 'all' ? 'フォルダ名順、各フォルダ内はファイル名順。' : 'ファイル名順。'}</p>${folder ? button('folders', 'フォルダ一覧へ戻る') : ''}${rows(items)}`}
        <div class="section-actions">${!atFolderList && (items.length || folder) ? button('manage', '曲を削除する') : ''}${!library.members.length ? button('import', '音楽を取り込む', 'primary') : ''}</div>${back}`;
    }
  } else if (screen === 'import') {
    if (importState === 'ready') {
      app.innerHTML = `${title('音楽を取り込む')}<p>カード内の音楽フォルダを1つ選ぶ流れを確認します。</p>
        <p class="subtle">このモックは「音楽」フォルダのサンプルを使います。サブフォルダもまとめて対象にします。</p>
        <div class="stack">${button('choose-folder', '取り込み元のフォルダを選ぶ', 'primary')}</div>${back}`;
    } else if (importState === 'choosing') {
      app.innerHTML = `${title('フォルダを選ぶ・操作見本')}<p>本番では、ここでiPhoneのフォルダ選択画面が開きます。</p>
        <div class="stack">${button('start-import', 'サンプルの「音楽」フォルダを選ぶ', 'primary')}${button('cancel-pick', '選択をキャンセル')}</div>`;
    } else if (importState === 'running') {
      app.innerHTML = `${title('取り込み中・操作見本')}<p>音楽フォルダと、その中のサブフォルダを確認しています。</p>
        <p>完了するまで画面を開いたままお待ちください。</p>${button('cancel-import', '取り込みを中止')}`;
    } else {
      const summary = result?.cancelled ? '取り込みを中止しました。サンプル一覧は変更していません。' : `新しく${result.newTracks}曲をサンプル一覧に追加しました。${result.existingMemberships}件は取り込み済みです。`;
      app.innerHTML = `${title('取り込み結果')}<div class="result"><p id="import-result" tabindex="-1">${summary}</p>${!result?.cancelled && result.newMemberships > result.newTracks ? `<p>既存の曲に、フォルダ内の表示を${result.newMemberships - result.newTracks}件追加しました。</p>` : ''}<p class="subtle">実際のファイルは読み込んでいません。</p></div>
        <div class="stack">${button('listen', '音楽を聴く', 'primary')}${button('again', 'もう一度取り込む')}</div>${back}`;
    }
  }
  const heading = app.querySelector('h1');
  document.title = `${heading?.textContent ?? 'MP3'}｜画面モック`;
  if (focusId) focus(focusId);
}
function go(nextScreen) {
  clearTimeout(announcementTimer);
  status.textContent = '';
  screen = nextScreen;
  managing = false;
  render('screen-title');
}
function updatePlayback(focusId, message = null) {
  // Preserve the DOM nodes and VoiceOver focus during transport operations.
  const item = current();
  const play = document.querySelector('#play');
  play.textContent = player.playing ? '一時停止' : '再生';
  for (const id of ['play', 'next', 'previous']) {
    document.getElementById(id).removeAttribute('aria-disabled');
  }
  document.querySelector('#current-name').textContent = item.name;
  document.querySelector('#playback-state').textContent = player.playing ? '再生中の操作見本・音は出ません' : '一時停止中の操作見本・音は出ません';
  const info = document.querySelector('#queue-info');
  info.hidden = false;
  info.textContent = queueDescription();
  app.querySelectorAll('[data-track]').forEach(row => {
    const selected = row.dataset.track === item.id;
    if (selected) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
    const entry = entries(library, modeFolder()).find(value => value.id === row.dataset.track);
    row.querySelector('.detail').textContent = (selected ? (player.playing ? '再生中の操作見本' : '一時停止中の操作見本') : '選んで再生') + (view === 'all' ? ' ・ ' + entry.folder : '');
  });
  // The clicked control already has focus. Do not move it after a state update.
  announce(message ?? playbackText());
}
function askDelete(kind, id, triggerId) {
  const item = entries(library, modeFolder()).find(entry => entry.id === id);
  pendingDelete = { kind, id, folder: modeFolder(), name: item?.name ?? folder };
  restoreFocusId = triggerId;
  document.querySelector('#confirm-title').textContent = kind === 'folder' ? 'フォルダ削除の確認' : '曲の削除の確認';
  document.querySelector('#confirm-description').textContent = kind === 'folder'
    ? `「${folder}」と、その中のサブフォルダを削除します。別のフォルダにある曲は残ります。`
    : view === 'all' ? `「${item.name}」を、すべてのフォルダと端末内の保存先から削除します。`
      : `「${folder}」から「${item.name}」を外します。別のフォルダにある曲は残ります。`;
  dialog.showModal();
  focus('cancel-delete');
  requestAnimationFrame(() => { if (dialog.open) focus('cancel-delete'); });
}

app.addEventListener('change', event => {
  if (event.target.id === 'play-order') {
    allOrder = event.target.value;
    const changingCurrentQueue = current() && player.context === null;
    player = setPlaybackOrder(player, allOrder);
    const message = `${orderLabel(allOrder)}を選びました。${changingCurrentQueue ? '現在の曲から再生順を切り替えました。' : 'すべての曲から曲を選ぶと適用されます。'}`;
    if (current()) updatePlayback('play-order', message);
    else announce(message);
    return;
  }
  if (event.target.id !== 'view-mode') return;
  view = event.target.value;
  folder = null;
  render('view-mode');
  announce(view === 'all' ? `すべての曲、${entries(library).length}曲。表示を切り替えました。` : 'フォルダ別の表示に切り替えました。');
});
app.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.getAttribute('aria-disabled') === 'true') {
    announce('曲は選ばれていません。一覧から曲を選んでください。');
    return;
  }
  if (target.dataset.folder !== undefined) {
    folder = target.dataset.folder;
    render('list-title');
    return;
  }
  if (target.dataset.track) {
    player = selectTrack(library, modeFolder(), target.dataset.track, allOrder);
    updatePlayback(target.id);
    return;
  }
  if (target.dataset.delete) {
    askDelete('track', target.dataset.delete, target.id);
    return;
  }
  switch (target.id) {
    case 'listen': go('library'); break;
    case 'home': go('home'); break;
    case 'import': importState = 'ready'; go('import'); break;
    case 'play': player.playing = !player.playing; updatePlayback('play'); break;
    case 'next': player = { ...step(player, 1), playing: true }; updatePlayback('next'); break;
    case 'previous': player = { ...step(player, -1), playing: true }; updatePlayback('previous'); break;
    case 'folders': folder = null; render('list-title'); break;
    case 'manage': managing = true; render('screen-title'); break;
    case 'manage-done': managing = false; render('manage'); break;
    case 'delete-folder': askDelete('folder', null, 'delete-folder'); break;
    case 'choose-folder': importState = 'choosing'; render('screen-title'); break;
    case 'cancel-pick': importState = 'ready'; render('choose-folder'); break;
    case 'again': importState = 'ready'; render('choose-folder'); break;
    case 'start-import':
      importState = 'running';
      render('screen-title');
      importTimer = setTimeout(() => {
        result = importSample(library);
        library = result.library;
        importState = 'result';
        render('import-result');
      }, 1800);
      break;
    case 'cancel-import':
      clearTimeout(importTimer);
      result = { cancelled: true };
      importState = 'result';
      render('import-result');
      break;
  }
});
document.querySelector('#cancel-delete').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', () => { pendingDelete = null; });
dialog.addEventListener('close', () => { pendingDelete = null; focus(restoreFocusId); });
document.querySelector('#confirm-delete').addEventListener('click', () => {
  if (!pendingDelete) return;
  const change = pendingDelete;
  const oldCurrent = current()?.id;
  const oldPlaying = player.playing;
  library = change.kind === 'folder' ? removeFolder(library, change.folder) : removeTrack(library, change.id, change.folder);
  player = reconcilePlayer(player, library);
  if (change.kind === 'folder') {
    folder = null;
    managing = false;
  }
  dialog.close();
  // Replace a removed row with the next remaining row, or an explicit way back.
  const remaining = entries(library, modeFolder());
  const nextFocus = managing ? (remaining[0] ? `track-${remaining[0].id}` : 'manage-done') : 'list-title';
  restoreFocusId = nextFocus;
  render(nextFocus);
  const queueMessage = oldCurrent && oldCurrent !== current()?.id
    ? current() ? ` ${oldPlaying ? '次の曲へ進みました。' : '次の曲を選びました。'}${playbackText()}` : ' 再生対象の曲がないため停止しました。'
    : '';
  announce(`サンプルの${change.kind === 'folder' ? 'フォルダ' : '曲'}を削除しました。${queueMessage}`);
});
render();
