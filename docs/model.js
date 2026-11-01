// Pure library and playback queue operations.
const compare = new Intl.Collator('ja', { numeric: true }).compare;
export function entries(library, folder = null) {
  const sorted = library.members
    .filter(item => folder === null || item.folder === folder)
    .slice().sort((a, b) => compare(a.folder, b.folder) || compare(a.name, b.name) || compare(a.id, b.id));
  const seen = new Set();
  return sorted.filter(item => !seen.has(item.id) && seen.add(item.id));
}
export const sortedFolders = library => library.folders.slice().sort(compare);
export function removeTrack(library, id, folder = null) {
  return { ...library, members: library.members.filter(item => !(item.id === id && (folder === null || item.folder === folder))) };
}
export function removeFolder(library, folder) {
  const inside = name => name === folder || name.startsWith(folder + '/');
  return { folders: library.folders.filter(name => !inside(name)), members: library.members.filter(item => !inside(item.folder)) };
}
export function createPlayer() {
  return { queue: [], index: -1, playing: false, context: null, order: 'ordered' };
}
function shuffle(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function setPlaybackOrder(player, order, random = Math.random) {
  // Folder playback is always ordered. Changing the browsing view never changes its queue.
  if (player.context !== null || !player.queue.length) return player;
  const currentId = player.queue[player.index].id;
  const ordered = player.queue.slice().sort((a, b) => compare(a.folder, b.folder) || compare(a.name, b.name) || compare(a.id, b.id));
  const queue = order === 'shuffle'
    ? [ordered.find(item => item.id === currentId), ...shuffle(ordered.filter(item => item.id !== currentId), random)]
    : ordered;
  return { ...player, queue, index: queue.findIndex(item => item.id === currentId), order };
}
export function selectTrack(library, folder, id, order = 'ordered', random = Math.random) {
  const queue = entries(library, folder);
  const index = queue.findIndex(item => item.id === id);
  if (index < 0) return createPlayer();
  return setPlaybackOrder({ queue, index, context: folder, playing: true, order: 'ordered' }, folder === null ? order : 'ordered', random);
}
export function step(player, delta) {
  if (!player.queue.length) return createPlayer();
  return { ...player, index: ((player.index + delta) % player.queue.length + player.queue.length) % player.queue.length };
}
export function reconcilePlayer(player, library) {
  if (!player.queue.length) return player;
  const allowed = new Map(entries(library, player.context).map(item => [item.id, item]));
  const queue = player.queue.filter(item => allowed.has(item.id)).map(item => allowed.get(item.id));
  if (!queue.length) return createPlayer();
  const currentId = player.queue[player.index]?.id;
  let index = queue.findIndex(item => item.id === currentId);
  if (index < 0) {
    // Start after the removed item, wrap, and choose the first remaining item.
    for (let offset = 1; offset <= player.queue.length; offset++) {
      const candidate = player.queue[(player.index + offset) % player.queue.length];
      index = queue.findIndex(item => item.id === candidate.id);
      if (index >= 0) break;
    }
  }
  return { ...player, queue, index };
}
