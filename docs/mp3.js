export function mp3FrameLength(bytes, offset) {
  if (offset+4>bytes.length || bytes[offset]!==255 || (bytes[offset+1]&224)!==224) return 0;
  const version=(bytes[offset+1]>>>3)&3, layer=(bytes[offset+1]>>>1)&3;
  const bitrateIndex=bytes[offset+2]>>>4, rateIndex=(bytes[offset+2]>>>2)&3;
  if (version===1 || layer!==1 || bitrateIndex===0 || bitrateIndex===15 || rateIndex===3) return 0;
  const rates=version===3 ? [44100,48000,32000] : version===2 ? [22050,24000,16000] : [11025,12000,8000];
  const bitrates=version===3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  return Math.floor((version===3?144:72)*bitrates[bitrateIndex]*1000/rates[rateIndex])+((bytes[offset+2]>>>1)&1);
}
export async function validateMp3(blob) {
  if (blob.size<8) throw new Error('MP3の音声データがありません。');
  const header=new Uint8Array(await blob.slice(0,10).arrayBuffer());
  let offset=0;
  if (header[0]===73 && header[1]===68 && header[2]===51) {
    if ([header[6],header[7],header[8],header[9]].some(x=>x>127)) throw new Error('MP3のタグ情報を読み取れません。');
    offset=10+((header[6]<<21)|(header[7]<<14)|(header[8]<<7)|header[9]);
  }
  const bytes=new Uint8Array(await blob.slice(offset,offset+65536).arrayBuffer());
  for (let p=0;p+8<bytes.length;p++) {
    const length=mp3FrameLength(bytes,p);
    if (length && mp3FrameLength(bytes,p+length)) return;
  }
  throw new Error('MP3の音声形式を確認できません。元のファイルを確認してください。');
}
export function sourceInfo(file) {
  const path=(file.webkitRelativePath || file.name).replaceAll('\\','/');
  const segments=path.split('/');
  if (segments.some(segment=>!segment || segment==='.' || segment==='..' || /[\u0000-\u001f]/.test(segment))) throw new Error('ファイル名またはフォルダ名を読み取れません。');
  const name=segments.pop();
  if (!/\.mp3$/i.test(name) || name.startsWith('.')) return null;
  if (segments.some(segment=>segment.startsWith('.'))) return null;
  return { name, folder: segments.join('/') || '選択した曲' };
}
