import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceBoard, estimateRectifiedSize, isValidQuad, rectifyImage, type Point } from '../src/processing';

function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
}

function quad(points: Point[]): Point[] { return points; }

test('accepts convex quadrilaterals in either winding, including rotated quads', () => {
  assert.equal(isValidQuad(quad([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }])), true);
  assert.equal(isValidQuad(quad([{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }])), true);
  assert.equal(isValidQuad(quad([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 0 }])), true);
});

test('rejects malformed, crossed, concave, and degenerate quadrilaterals', () => {
  assert.equal(isValidQuad([]), false);
  assert.equal(isValidQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]), false);
  assert.equal(isValidQuad([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }]), false);
  assert.equal(isValidQuad([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 4 }]), false);
  assert.equal(isValidQuad([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }]), false);
  assert.equal(isValidQuad([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), false);
});

test('estimates output size from opposing side averages and validates the quad', () => {
  const points = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 0, y: 4 }];
  assert.deepEqual(estimateRectifiedSize(points), { width: 10, height: 5 });
  assert.throws(() => estimateRectifiedSize([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]), /valid convex/);
  assert.throws(() => estimateRectifiedSize([
    { x: 0, y: 0 }, { x: 20_000_000, y: 0 }, { x: 20_000_000, y: 4 }, { x: 0, y: 4 },
  ]), /limits/);
});

test('rectifies an axis-aligned image without changing its pixels', () => {
  const input = rgba(2, 2, (x, y) => [x * 80 + y * 20, x * 30, y * 40, 255 - x * 10 - y * 20]);
  const result = rectifyImage(input, 2, 2, [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ], 2, 2);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
});

test('uses bilinear interpolation for all RGBA channels', () => {
  const input = new Uint8ClampedArray([
    0, 20, 40, 0,    100, 120, 140, 64,
    200, 220, 240, 128, 255, 255, 255, 255,
  ]);
  const result = rectifyImage(input, 2, 2, [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ], 3, 3);
  assert.deepEqual(Array.from(result.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)), [139, 154, 169, 112]);
  assert.deepEqual(Array.from(result.slice(0, 4)), [0, 20, 40, 0]);
  assert.deepEqual(Array.from(result.slice(-4)), [255, 255, 255, 255]);
});

test('maps perspective-quad corners to the destination rectangle corners', () => {
  const input = rgba(4, 4, (x, y) => [x * 30 + y * 5, y * 40, 0, 255]);
  const result = rectifyImage(input, 4, 4, [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 3 }, { x: 1, y: 3 },
  ], 4, 4);
  assert.deepEqual(Array.from(result.slice(0, 4)), Array.from(input.slice(0, 4)));
  assert.deepEqual(Array.from(result.slice(3 * 4, 4 * 4)), Array.from(input.slice(3 * 4, 4 * 4)));
  assert.deepEqual(Array.from(result.slice(12 * 4, 13 * 4)), Array.from(input.slice((3 * 4 + 1) * 4, (3 * 4 + 2) * 4)));
  assert.deepEqual(Array.from(result.slice(15 * 4, 16 * 4)), Array.from(input.slice((3 * 4 + 2) * 4, (3 * 4 + 3) * 4)));
});

test('checks source data, corners, output dimensions, and bounds before allocating', () => {
  const valid = rgba(2, 2, () => [0, 0, 0, 255]);
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.throws(() => rectifyImage(valid, 0, 2, corners, 2, 2), /dimensions/);
  assert.throws(() => rectifyImage(valid.subarray(1), 2, 2, corners, 2, 2), /length/);
  assert.throws(() => rectifyImage(valid, 2, 2, corners, 0, 2), /dimensions/);
  assert.throws(() => rectifyImage(valid, 2, 2, corners, 32_769, 1), /limits/);
  assert.throws(() => rectifyImage(valid, 2, 2, [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 },
  ], 2, 2), /valid convex/);
  assert.throws(() => rectifyImage(valid, 2, 2, [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 0, y: 1 },
  ], 2, 2), /bounds/);
});

test('strength zero returns an exact independent copy and preserves alpha', () => {
  const input = rgba(3, 2, (x, y) => [x * 41, y * 78, 200 - x * 10, (x + y) * 37]);
  const result = enhanceBoard(input, 3, 2, 'whiteboard', 0);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.throws(() => enhanceBoard(input, 3, 2, 'whiteboard', -0.1), /between 0 and 1/);
  assert.throws(() => enhanceBoard(input, 3, 2, 'whiteboard', 1.1), /between 0 and 1/);
  assert.throws(() => enhanceBoard(input, 3, 2, 'invalid' as 'whiteboard', 1), /mode/);
});

test('whiteboard mode maps a uniform board cleanly to pure white', () => {
  const input = rgba(4, 3, (x, y) => [100, 100, 100, x * 30 + y]);
  const result = enhanceBoard(input, 4, 3, 'whiteboard', 1);
  for (let pixel = 0; pixel < 12; pixel++) {
    assert.equal(result[pixel * 4], 255);
    assert.equal(result[pixel * 4], result[pixel * 4 + 1]);
    assert.equal(result[pixel * 4 + 1], result[pixel * 4 + 2]);
    assert.equal(result[pixel * 4 + 3], input[pixel * 4 + 3]);
  }
  assert.ok(enhanceBoard(input, 4, 3, 'whiteboard', 0.5)[0] < result[0]);
});

test('blackboard mode maps a uniform board cleanly to pure black', () => {
  const input = rgba(3, 3, () => [120, 120, 120, 77]);
  const result = enhanceBoard(input, 3, 3, 'blackboard', 1);
  for (let pixel = 0; pixel < 9; pixel++) {
    assert.equal(result[pixel * 4], 0);
    assert.equal(result[pixel * 4], result[pixel * 4 + 1]);
    assert.equal(result[pixel * 4 + 1], result[pixel * 4 + 2]);
    assert.equal(result[pixel * 4 + 3], 77);
  }
});

test('local normalization reduces broad lighting variation without mutating input', () => {
  const input = rgba(9, 9, x => { const value = 80 + x * 10; return [value, value, value, 255]; });
  const original = new Uint8ClampedArray(input);
  const result = enhanceBoard(input, 9, 9, 'whiteboard', 1);
  assert.deepEqual(input, original);
  const left = result[(4 * 9) * 4];
  const right = result[(4 * 9 + 8) * 4];
  assert.ok(Math.abs(right - left) < 20, `expected normalized range under 20, got ${right - left}`);
});

test('uniform colored surfaces also normalize to pure board polarity', () => {
  const input = rgba(5, 3, () => [104, 127, 143, 211]);
  assert.deepEqual(enhanceBoard(input, 5, 3, 'whiteboard', 1), rgba(5, 3, () => [255, 255, 255, 211]));
  assert.deepEqual(enhanceBoard(input, 5, 3, 'blackboard', 1), rgba(5, 3, () => [0, 0, 0, 211]));
});

test('strength interpolates smoothly between the source and normalized result', () => {
  const input = rgba(1, 1, () => [100, 100, 100, 123]);
  const half = enhanceBoard(input, 1, 1, 'whiteboard', 0.5);
  const full = enhanceBoard(input, 1, 1, 'whiteboard', 1);
  assert.equal(full[0], 255);
  assert.ok(Math.abs(half[0] - 178) <= 1, `expected half strength near 178, got ${half[0]}`);
  assert.equal(half[3], 123);
});

test('whiteboard normalization removes shaded warm illumination but preserves faint, dark, and colored strokes', () => {
  const width = 160;
  const height = 96;
  const input = rgba(width, height, (x, y) => {
    const shade = 174 + Math.round(x * 0.28) + Math.round(y * 0.08);
    const noise = ((x * 17 + y * 29) % 7) - 3;
    let red = shade + 9 + noise;
    let green = shade + 2 + noise;
    let blue = shade - 5 + noise;
    if (y === 20 && x >= 12 && x <= 108) { red -= 125; green -= 125; blue -= 125; }
    if (y >= 55 && y <= 64 && x >= 22 && x <= 137) { red -= 145; green -= 145; blue -= 145; }
    if (y >= 34 && y <= 35 && x >= 10 && x <= 145) { red -= 18; green -= 18; blue -= 18; }
    if (y >= 76 && y <= 78 && x >= 18 && x <= 142) { red = 232; green = 43; blue = 31; }
    return [red, green, blue, (x + y) % 256];
  });
  const original = new Uint8ClampedArray(input);
  const result = enhanceBoard(input, width, height, 'whiteboard', 1);
  assert.deepEqual(input, original, 'enhancement must not mutate the source');

  const background = (x: number, y: number) => (y * width + x) * 4;
  const leftBackground = result[background(6, 8)];
  const rightBackground = result[background(153, 8)];
  assert.ok(leftBackground >= 245 && rightBackground >= 245, `noisy board should approach white: ${leftBackground}, ${rightBackground}`);
  assert.ok(Math.abs(rightBackground - leftBackground) < 12, `shadow should be removed, got ${leftBackground} vs ${rightBackground}`);
  assert.ok(result[background(60, 20)] < 90, 'thin dark ink should become clearly dark');
  assert.ok(result[background(80, 59)] < 45, 'thick dark ink should become nearly black');
  assert.ok(result[background(80, 34)] < result[background(80, 33)] - 12, 'faint 18-level strokes should remain visible');
  const redMarker = background(80, 77);
  assert.ok(result[redMarker] > result[redMarker + 1] + 100, 'red marker hue should be retained');
  assert.ok(result[redMarker] > result[redMarker + 2] + 100, 'red marker hue should be retained');
  for (let pixel = 0; pixel < width * height; pixel++) {
    assert.equal(result[pixel * 4 + 3], input[pixel * 4 + 3], 'alpha must be preserved');
  }
});

test('fine stroke separation removes broad camera-like halos without erasing faint ink', () => {
  const width=320,height=200;
  const input=rgba(width,height,(x,y)=>{
    const halo=16*Math.exp(-((x-160)**2/(65**2)+(y-100)**2/(25**2)));
    let value=205-halo;
    if(y===100&&x>=100&&x<=220)value-=10;
    if(x>=160&&x<=174&&y>=50&&y<=130)value-=130;
    return [value+7,value,value-5,255];
  });
  const result=enhanceBoard(input,width,height,'whiteboard',1);
  const at=(x:number,y:number)=>(y*width+x)*4;
  for(const [x,y] of [[115,92],[160,140],[90,100],[210,108]]){
    const off=at(x,y);assert.ok(result[off]>=252&&result[off+1]>=252&&result[off+2]>=252,'broad halo must become pure background');
  }
  assert.ok(result[at(120,100)]<220,'10-level fine stroke must remain distinct from white');
  assert.ok(result[at(168,90)]<45,'solid thick ink must not become a white hole');
});

test('blackboard normalization purifies shaded noise and preserves faint chalk and colored marker', () => {
  const width = 160;
  const height = 96;
  const input = rgba(width, height, (x, y) => {
    const shade = 22 + Math.round(x * 0.10) + Math.round(y * 0.035);
    const noise = ((x * 11 + y * 23) % 5) - 2;
    let red = shade - 3 + noise;
    let green = shade + noise;
    let blue = shade + 4 + noise;
    if (y === 21 && x >= 12 && x <= 108) { red += 115; green += 115; blue += 115; }
    if (y >= 55 && y <= 64 && x >= 22 && x <= 137) { red += 190; green += 190; blue += 190; }
    if (y >= 34 && y <= 35 && x >= 10 && x <= 145) { red += 16; green += 16; blue += 16; }
    if (y >= 76 && y <= 78 && x >= 18 && x <= 142) { red = 232; green = 58; blue = 48; }
    return [red, green, blue, 255];
  });
  const result = enhanceBoard(input, width, height, 'blackboard', 1);
  const background = (x: number, y: number) => (y * width + x) * 4;
  const leftBackground = result[background(6, 8)];
  const rightBackground = result[background(153, 8)];
  assert.ok(leftBackground <= 12 && rightBackground <= 12, `board noise should approach black: ${leftBackground}, ${rightBackground}`);
  assert.ok(Math.abs(rightBackground - leftBackground) < 10, `shadow should be removed, got ${leftBackground} vs ${rightBackground}`);
  assert.ok(result[background(60, 21)] > 90, `thin chalk should be lifted clearly, got ${result[background(60, 21)]}`);
  assert.ok(result[background(80, 59)] > 220, 'thick chalk should become bright');
  assert.ok(result[background(80, 34)] > result[background(80, 33)] + 20, 'faint chalk should remain visible');
  const redMarker = background(80, 77);
  assert.ok(result[redMarker] > result[redMarker + 1] + 80, 'red marker hue should be retained');
  assert.ok(result[redMarker] > result[redMarker + 2] + 80, 'red marker hue should be retained');
});
