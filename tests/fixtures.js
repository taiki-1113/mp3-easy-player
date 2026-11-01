// Test fixtures only; never loaded by the application.
export const initialLibrary = () => ({
  folders: ['あさの音楽', 'くつろぎ', 'くつろぎ/ピアノ'],
  members: [
    { folder: 'あさの音楽', id: 'morning', name: '01 朝の光.mp3' },
    { folder: 'あさの音楽', id: 'walk', name: '02 散歩道.mp3' },
    { folder: 'くつろぎ', id: 'night', name: '01 静かな夜.mp3' },
    { folder: 'くつろぎ', id: 'morning', name: '02 朝の光.mp3' },
    { folder: 'くつろぎ/ピアノ', id: 'piano', name: '01 ピアノ.mp3' },
  ],
});
export function importSample(library) {
  const sample = initialLibrary();
  sample.folders.push('旅の音楽');
  sample.members.push({ folder: '旅の音楽', id: 'trip', name: '01 車窓.mp3' });
  const oldIds = new Set(library.members.map(item => item.id));
  const added = sample.members.filter(item => !library.members.some(old => old.id === item.id && old.folder === item.folder));
  const newIds = new Set(added.filter(item => !oldIds.has(item.id)).map(item => item.id));
  return {
    library: { folders: [...new Set([...library.folders, ...sample.folders])], members: [...library.members, ...added] },
    newTracks: newIds.size,
    newMemberships: added.length,
    existingMemberships: sample.members.length - added.length,
  };
}
