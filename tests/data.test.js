import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Sha256, hashBlob } from '../docs/sha256.js';
import { validateMp3, sourceInfo, mp3FrameLength } from '../docs/mp3.js';
import { byteRange, audioResponse } from '../docs/media-response.js';

test('増分SHA-256が標準ハッシュと、ブロック境界・複数チャンクで一致する', async()=>{
  for(const length of [0,1,55,56,63,64,65,127,128,1000,1048583]){
    const data=Uint8Array.from({length},(_,i)=>(i*73+19)%256);
    const expected=createHash('sha256').update(data).digest('hex');
    const hash=new Sha256();for(let p=0;p<data.length;p+=17)hash.update(data.subarray(p,p+17));
    assert.equal(hash.hex(),expected);
    assert.equal(await hashBlob(new Blob([data])),expected);
  }
  assert.equal(new Sha256().update(new TextEncoder().encode('abc')).hex(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('ハッシュ処理は中止を尊重する',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(hashBlob(new Blob(['data']),controller.signal),{name:'AbortError'});
});
test('MP3の実フレームとID3タグを検査し、偽MP3や空ファイルを拒否する',async()=>{
  const frame=new Uint8Array(417);frame.set([255,251,144,100]);
  assert.equal(mp3FrameLength(frame,0),417);
  await validateMp3(new Blob([frame,frame]));
  const tag=new Uint8Array([73,68,51,4,0,0,0,0,0,0]);
  await validateMp3(new Blob([tag,frame,frame]));
  await assert.rejects(validateMp3(new Blob(['not really an mp3 file'])));
  await assert.rejects(validateMp3(new Blob([])));
});
test('ファイル名・階層を保持し、隠し項目と非MP3を対象から外す',()=>{
  assert.deepEqual(sourceInfo({name:'02 曲.MP3',webkitRelativePath:'音楽/フォルダ/02 曲.MP3'}),{name:'02 曲.MP3',folder:'音楽/フォルダ'});
  assert.deepEqual(sourceInfo({name:'曲.mp3'}),{name:'曲.mp3',folder:'選択した曲'});
  assert.equal(sourceInfo({name:'cover.jpg'}),null);
  assert.equal(sourceInfo({name:'._01.mp3',webkitRelativePath:'音楽/._01.mp3'}),null);
  assert.throws(()=>sourceInfo({name:'曲.mp3',webkitRelativePath:'音楽/../曲.mp3'}));
});
test('音声のRange要求は全体・部分・末尾・範囲外を正しく扱う',async()=>{
  const blob=new Blob([new Uint8Array([0,1,2,3,4,5,6,7,8,9])]);
  assert.equal(byteRange(null,10),null);
  assert.deepEqual(byteRange('bytes=2-5',10),{start:2,end:5});
  assert.deepEqual(byteRange('bytes=-3',10),{start:7,end:9});
  assert.deepEqual(byteRange('bytes=8-',10),{start:8,end:9});
  for(const range of ['bytes=10-','bytes=5-3','bytes=-0','bytes=0-1,4-5','bad'])assert.equal(byteRange(range,10),false);
  const response=audioResponse(blob,'bytes=2-5');
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-5/10');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,3,4,5]);
  assert.equal(audioResponse(blob,'bytes=10-').status,416);
  assert.equal(audioResponse(blob,null).status,200);
  assert.equal((await audioResponse(blob,'bytes=2-5','HEAD').arrayBuffer()).byteLength,0);
});
