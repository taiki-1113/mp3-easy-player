import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLibrary, entries, importSample, removeTrack, removeFolder, selectTrack, setPlaybackOrder, step, reconcilePlayer } from '../docs/model.js';

test('同一内容は全曲一覧で1回、各フォルダではそれぞれ表示する', () => {
  const library = initialLibrary();
  assert.equal(library.members.length, 5);
  assert.equal(entries(library).length, 4);
  assert.equal(entries(library, 'あさの音楽').some(item => item.id === 'morning'), true);
  assert.equal(entries(library, 'くつろぎ').some(item => item.id === 'morning'), true);
  assert.deepEqual(entries(library).map(item => item.name), ['01 朝の光.mp3', '02 散歩道.mp3', '01 静かな夜.mp3', '01 ピアノ.mp3']);
});
test('片方の所属を削除しても別フォルダの共有曲は残る', () => {
  const changed = removeTrack(initialLibrary(), 'morning', 'あさの音楽');
  assert.equal(entries(changed).length, 4);
  assert.equal(entries(changed, 'あさの音楽').length, 1);
  assert.equal(entries(changed, 'くつろぎ').length, 2);
});
test('フォルダ削除は子孫を含み、名前の接頭辞だけでは別フォルダを消さない', () => {
  const library = initialLibrary();
  library.folders.push('くつろぎ2');
  library.members.push({ folder: 'くつろぎ2', id: 'other', name: '別曲.mp3' });
  const changed = removeFolder(library, 'くつろぎ');
  assert.deepEqual(changed.folders, ['あさの音楽', 'くつろぎ2']);
  assert.equal(entries(changed).some(item => item.id === 'morning'), true);
  assert.equal(entries(changed).some(item => item.id === 'piano'), false);
  assert.equal(entries(changed).some(item => item.id === 'other'), true);
});
test('全曲からの削除は全所属を除去し、再取り込みで復元できる', () => {
  const deleted = removeTrack(initialLibrary(), 'morning');
  assert.equal(deleted.members.some(item => item.id === 'morning'), false);
  const imported = importSample(deleted);
  assert.equal(imported.library.members.filter(item => item.id === 'morning').length, 2);
  assert.equal(imported.newTracks, 2); // restored morning + the new trip sample
  const again = importSample(imported.library);
  assert.equal(again.newTracks, 0);
  assert.equal(again.newMemberships, 0);
  assert.equal(again.library.members.length, imported.library.members.length);
});
test('先頭で前へ進むと末尾、末尾で次へ進むと先頭', () => {
  const selected = selectTrack(initialLibrary(), 'あさの音楽', 'morning');
  assert.equal(step(selected, -1).queue[step(selected, -1).index].id, 'walk');
  assert.equal(step(step(selected, -1), 1).index, 0);
});
test('現在曲の削除後は次の残存曲へ進み、全削除なら停止する', () => {
  const library = initialLibrary();
  const selected = selectTrack(library, 'あさの音楽', 'morning');
  const changed = removeTrack(library, 'morning', 'あさの音楽');
  const playing = reconcilePlayer(selected, changed);
  assert.equal(playing.queue[playing.index].id, 'walk');
  assert.equal(playing.playing, true);
  const stopped = reconcilePlayer(playing, removeFolder(changed, 'あさの音楽'));
  assert.equal(stopped.playing, false);
  assert.equal(stopped.queue.length, 0);
});
test('別フォルダの所属削除では現在の再生対象と一時停止状態を変えない', () => {
  const library = initialLibrary();
  const paused = { ...selectTrack(library, 'くつろぎ', 'morning'), playing: false };
  const changed = reconcilePlayer(paused, removeTrack(library, 'morning', 'あさの音楽'));
  assert.equal(changed.queue[changed.index].id, 'morning');
  assert.equal(changed.playing, false);
});
test('削除後もキューに新規取り込み曲を無断追加しない', () => {
  const library = initialLibrary();
  const playing = selectTrack(library, null, 'piano');
  const imported = importSample(library).library;
  const changed = reconcilePlayer(playing, removeTrack(imported, 'piano'));
  assert.equal(changed.queue.some(item => item.id === 'trip'), false);
  assert.equal(changed.queue[changed.index].id, 'morning');
});
test('全曲再生で代表所属を消しても共有曲は継続し、残ったファイル名を表示する', () => {
  const library = initialLibrary();
  const playing = selectTrack(library, null, 'morning');
  const changed = reconcilePlayer(playing, removeFolder(library, 'あさの音楽'));
  assert.equal(changed.queue[changed.index].id, 'morning');
  assert.equal(changed.queue[changed.index].name, '02 朝の光.mp3');
  assert.equal(changed.playing, true);
});
test('全曲シャッフルは選んだ曲から開始し、全実体を重複なく1周する', () => {
  const library = initialLibrary();
  const original = entries(library).map(item => item.id);
  const player = selectTrack(library, null, 'morning', 'shuffle', () => 0);
  assert.equal(player.order, 'shuffle');
  assert.equal(player.queue[0].id, 'morning');
  assert.equal(new Set(player.queue.map(item => item.id)).size, 4);
  assert.deepEqual(player.queue.map(item => item.id).slice().sort(), original.slice().sort());
  assert.notDeepEqual(player.queue.map(item => item.id), original);
  assert.deepEqual(entries(library).map(item => item.id), original);
  const last = { ...player, index: player.queue.length - 1 };
  assert.equal(step(last, 1).index, 0);
  assert.equal(step(player, -1).index, player.queue.length - 1);
});
test('再生方法の切替で現在曲と一時停止状態を保持し、順番再生へ戻せる', () => {
  const ordered = { ...selectTrack(initialLibrary(), null, 'night'), playing: false };
  const shuffled = setPlaybackOrder(ordered, 'shuffle', () => 0);
  assert.equal(shuffled.queue[shuffled.index].id, 'night');
  assert.equal(shuffled.playing, false);
  const restored = setPlaybackOrder(shuffled, 'ordered');
  assert.deepEqual(restored.queue, ordered.queue);
  assert.equal(restored.index, ordered.index);
  assert.equal(restored.playing, false);
});
test('全曲のシャッフル設定をフォルダ再生には適用しない', () => {
  const selected = selectTrack(initialLibrary(), 'あさの音楽', 'morning', 'shuffle', () => 0);
  assert.equal(selected.order, 'ordered');
  assert.deepEqual(selected.queue.map(item => item.id), ['morning', 'walk']);
  assert.equal(setPlaybackOrder(selected, 'shuffle'), selected);
});
test('シャッフル中の削除でも残った再生順を守り、取り込み曲を無断追加しない', () => {
  const library = initialLibrary();
  const selected = selectTrack(library, null, 'morning', 'shuffle', () => 0);
  const changedLibrary = removeTrack(importSample(library).library, 'morning');
  const reconciled = reconcilePlayer(selected, changedLibrary);
  assert.deepEqual(reconciled.queue.map(item => item.id), selected.queue.slice(1).map(item => item.id));
  assert.equal(reconciled.queue[reconciled.index].id, selected.queue[1].id);
  assert.equal(reconciled.order, 'shuffle');
  const reordered = setPlaybackOrder(reconciled, 'ordered');
  assert.equal(reordered.queue.some(item => item.id === 'trip'), false);
});
test('1曲の全曲シャッフルでも前後送りが成立する', () => {
  const library = { folders: ['one'], members: [{ folder: 'one', id: 'only', name: '1.mp3' }] };
  const selected = selectTrack(library, null, 'only', 'shuffle');
  assert.equal(step(selected, -1).index, 0);
  assert.equal(step(selected, 1).index, 0);
});
