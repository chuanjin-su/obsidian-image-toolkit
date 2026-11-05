import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findImageEmbeds, supportedExtension, isRemote, assertStaticImage } from '../src/embeds';

test('resolve wiki and markdown embeds while preserving exact source offsets', () => {
  const text = 'before ![[folder/hello.jpg|caption|400]] and ![my alt](<folder/space name.png> "title") after';
  const embeds = findImageEmbeds(text);
  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].link, 'folder/hello.jpg');
  assert.equal(embeds[1].link, 'folder/space name.png');
  for (const e of embeds) assert.equal(text.slice(e.start, e.end), e.original);
});
test('percent encoded paths, duplicate embeds and ordinary links', () => {
  const found = findImageEmbeds('![a](space%20name.webp) ![[a.jpg]] ![[a.jpg]] [not image](a.png)');
  assert.deepEqual(found.map(e => e.link), ['space name.webp', 'a.jpg', 'a.jpg']);
  assert.notEqual(found[1].start, found[2].start);
});
test('remote schemes never resolve as local images', () => {
  for (const path of ['https://example.com/a.png','data:image/png,a','//example/a.jpg','app://resource']) assert.equal(isRemote(path), true);
  assert.equal(isRemote('folder/hello.jpg'), false);
});
test('supported extensions exclude vector and animation formats', () => {
  assert.equal(supportedExtension('A.JPEG'), true);
  assert.equal(supportedExtension('A.gif'), false);
  assert.equal(supportedExtension('A.svg'), false);
});
test('animated PNG is rejected', () => {
  const data = new Uint8Array(20); data.set([137,80,78,71,13,10,26,10]);
  data.set([97,99,84,76],12);
  assert.throws(() => assertStaticImage(data.buffer,'png'), /Animated/);
});
test('animated WebP is rejected', () => {
  const data = new Uint8Array(22);
  const put=(n:number,s:string)=>data.set([...s].map(c=>c.charCodeAt(0)),n);
  put(0,'RIFF');put(8,'WEBP');put(12,'ANIM');
  assert.throws(() => assertStaticImage(data.buffer,'webp'), /Animated/);
});
test('JPEG content signature prevents renamed animations from being flattened', () => {
  assert.throws(() => assertStaticImage(new TextEncoder().encode('GIF89a animated bytes').buffer,'jpg'), /extension mismatch/);
  assert.doesNotThrow(() => assertStaticImage(new Uint8Array([255,216,255,224]).buffer,'jpeg'));
});
test('PNG content signature must match its extension', () => {
  assert.throws(() => assertStaticImage(new Uint8Array([0,80,78,71,0,0,0,0]).buffer,'png'), /extension mismatch/);
});
test('unsupported extensions are rejected', () => {
  assert.throws(() => assertStaticImage(new ArrayBuffer(2),'gif'), /Only static/);
});
