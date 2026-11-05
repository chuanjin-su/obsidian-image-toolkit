import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAdjustments,
  DEFAULT_ADJUSTMENTS,
  hasAdjustments,
  normalizeAdjustments,
  type BasicAdjustments,
} from '../src/adjustments';

function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
}

function pixel(data: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(data.subarray(offset, offset + 4));
}

test('adjustment defaults normalize omitted controls to neutral values', () => {
  assert.deepEqual(DEFAULT_ADJUSTMENTS, {
    exposure: 0, brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0,
  });
  assert.deepEqual(normalizeAdjustments(), DEFAULT_ADJUSTMENTS);
  assert.deepEqual(normalizeAdjustments({ exposure: 1.5, warmth: -20 }), {
    exposure: 1.5, brightness: 0, contrast: 0, saturation: 0, warmth: -20, sharpen: 0,
  });
  assert.equal(hasAdjustments(DEFAULT_ADJUSTMENTS), false);
  assert.equal(hasAdjustments(normalizeAdjustments({ sharpen: 1 })), true);
});

test('normalization rejects non-numeric, non-finite, and out-of-range values', () => {
  assert.throws(() => normalizeAdjustments(null as unknown as Partial<BasicAdjustments>), /object/);
  for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(
      () => normalizeAdjustments({ brightness: invalid } as unknown as Partial<BasicAdjustments>),
      /finite number/,
    );
  }
  for (const [key, value] of [
    ['exposure', -3.01], ['exposure', 3.01],
    ['brightness', -101], ['brightness', 101],
    ['contrast', -101], ['contrast', 101],
    ['saturation', -101], ['saturation', 101],
    ['warmth', -101], ['warmth', 101],
    ['sharpen', -1], ['sharpen', 101],
  ] as Array<[keyof BasicAdjustments, number]>) {
    assert.throws(() => normalizeAdjustments({ [key]: value }), /between/);
  }
  assert.doesNotThrow(() => normalizeAdjustments({ exposure: -3, brightness: 100, sharpen: 100 }));
});

test('neutral processing is an exact independent copy and preserves arbitrary alpha', () => {
  const input = new Uint8ClampedArray([0, 13, 255, 0, 241, 7, 83, 1, 19, 202, 44, 127]);
  const original = new Uint8ClampedArray(input);
  const output = applyAdjustments(input, 3, 1);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
  output[0] = 99;
  assert.deepEqual(input, original);
});

test('dimensions and exact RGBA buffer length are validated before processing', () => {
  const data = new Uint8ClampedArray(4);
  for (const [width, height] of [[0, 1], [1, 0], [-1, 1], [1.5, 1], [8193, 1], [4097, 4097]]) {
    assert.throws(() => applyAdjustments(data, width, height), /dimensions/);
  }
  assert.throws(() => applyAdjustments(new Uint8Array(4) as unknown as Uint8ClampedArray, 1, 1), /Uint8ClampedArray/);
  assert.throws(() => applyAdjustments(new Uint8ClampedArray(3), 1, 1), /length/);
  assert.throws(() => applyAdjustments(new Uint8ClampedArray(8), 1, 1), /length/);
});

test('exposure is monotonic and leaves black black', () => {
  const input = rgba(5, 1, x => [x === 0 ? 0 : x * 55, x === 0 ? 0 : x * 55, x === 0 ? 0 : x * 55, x * 50]);
  const brighter = applyAdjustments(input, 5, 1, { exposure: 1 });
  const darker = applyAdjustments(input, 5, 1, { exposure: -1 });
  assert.equal(pixel(brighter, 0, 0, 5)[0], 0);
  assert.equal(pixel(darker, 0, 0, 5)[0], 0);
  let previous = -1;
  for (let x = 0; x < 5; x++) {
    const source = pixel(input, x, 0, 5)[0];
    const up = pixel(brighter, x, 0, 5)[0];
    const down = pixel(darker, x, 0, 5)[0];
    assert.ok(up >= source);
    assert.ok(down <= source);
    assert.ok(up >= previous);
    previous = up;
  }
  assert.deepEqual(Array.from(brighter).filter((_, i) => i % 4 === 3), Array.from(input).filter((_, i) => i % 4 === 3));
});

test('brightness lifts dark and light pixels and lowers them for negative values', () => {
  const input = rgba(3, 1, x => [20 + x * 100, 20 + x * 100, 20 + x * 100, 255]);
  const brighter = applyAdjustments(input, 3, 1, { brightness: 40 });
  const darker = applyAdjustments(input, 3, 1, { brightness: -40 });
  for (let x = 0; x < 3; x++) {
    const source = pixel(input, x, 0, 3)[0];
    assert.ok(pixel(brighter, x, 0, 3)[0] > source);
    assert.ok(pixel(darker, x, 0, 3)[0] < source);
  }
});

test('contrast expands around mid-gray and reduces the range at minimum', () => {
  const input = rgba(5, 1, x => [x * 64, x * 64, x * 64, 255]);
  const high = applyAdjustments(input, 5, 1, { contrast: 100 });
  const low = applyAdjustments(input, 5, 1, { contrast: -100 });
  assert.equal(pixel(high, 0, 0, 5)[0], pixel(input, 0, 0, 5)[0]);
  assert.ok(pixel(high, 1, 0, 5)[0] < pixel(input, 1, 0, 5)[0]);
  assert.ok(pixel(high, 3, 0, 5)[0] > pixel(input, 3, 0, 5)[0]);
  assert.equal(pixel(high, 4, 0, 5)[0], pixel(input, 4, 0, 5)[0]);
  assert.ok(Math.abs(pixel(high, 2, 0, 5)[0] - 128) <= 1);
  assert.equal(pixel(low, 0, 0, 5)[0], pixel(low, 4, 0, 5)[0]);
  assert.ok(Math.abs(pixel(low, 2, 0, 5)[0] - 128) <= 1);
});

test('saturation can remove chroma to grayscale or boost it while retaining hue ordering', () => {
  const input = new Uint8ClampedArray([150, 90, 70, 173]);
  const gray = applyAdjustments(input, 1, 1, { saturation: -100 });
  const vivid = applyAdjustments(input, 1, 1, { saturation: 100 });
  assert.equal(gray[0], gray[1]);
  assert.equal(gray[1], gray[2]);
  assert.ok(vivid[0] > vivid[1] && vivid[1] > vivid[2]);
  assert.equal(vivid[3], 173);
});

test('warmth moves red and blue in opposite directions', () => {
  const input = new Uint8ClampedArray([120, 120, 120, 77]);
  const warm = applyAdjustments(input, 1, 1, { warmth: 100 });
  const cool = applyAdjustments(input, 1, 1, { warmth: -100 });
  assert.ok(warm[0] > warm[2]);
  assert.ok(cool[0] < cool[2]);
  assert.equal(warm[3], 77);
  assert.equal(cool[3], 77);
});

test('sharpen increases edge contrast and leaves a uniform image unchanged', () => {
  const edge = rgba(5, 3, x => {
    const value = x < 2 ? 80 : 180;
    return [value, value, value, 255];
  });
  const sharpened = applyAdjustments(edge, 5, 3, { sharpen: 100 });
  assert.ok(pixel(sharpened, 1, 1, 5)[0] < pixel(edge, 1, 1, 5)[0]);
  assert.ok(pixel(sharpened, 2, 1, 5)[0] > pixel(edge, 2, 1, 5)[0]);

  const uniform = rgba(4, 3, () => [87, 120, 163, 91]);
  assert.deepEqual(applyAdjustments(uniform, 4, 3, { sharpen: 100 }), uniform);
});

test('sharpen ignores fully transparent neighbor colors and preserves alpha', () => {
  const first = new Uint8ClampedArray([
    220, 10, 80, 255,
    255, 0, 255, 0,
    12, 240, 3, 0,
  ]);
  const changedHiddenRgb = new Uint8ClampedArray(first);
  changedHiddenRgb.set([0, 255, 0, 0], 4);
  changedHiddenRgb.set([255, 0, 0, 0], 8);
  const sharpened = applyAdjustments(first, 3, 1, { sharpen: 100 });
  const sharpenedDifferentHiddenRgb = applyAdjustments(changedHiddenRgb, 3, 1, { sharpen: 100 });
  assert.deepEqual(pixel(sharpened, 0, 0, 3), pixel(sharpenedDifferentHiddenRgb, 0, 0, 3));
  assert.deepEqual(Array.from(sharpened).filter((_, i) => i % 4 === 3), [255, 0, 0]);
  assert.deepEqual(first, new Uint8ClampedArray([220, 10, 80, 255, 255, 0, 255, 0, 12, 240, 3, 0]));
});

test('combined adjustments stay finite and clamped, preserve alpha, and do not mutate input', () => {
  const input = rgba(4, 2, (x, y) => [x * 91 + y * 13, 220 - x * 37, y * 180 + x * 17, (x * 53 + y * 71) % 256]);
  const original = new Uint8ClampedArray(input);
  const output = applyAdjustments(input, 4, 2, {
    exposure: 2.5, brightness: 35, contrast: 70, saturation: 80, warmth: -65, sharpen: 90,
  });
  assert.notEqual(output, input);
  assert.deepEqual(input, original);
  for (let i = 0; i < output.length; i++) {
    assert.ok(Number.isFinite(output[i]));
    assert.ok(output[i] >= 0 && output[i] <= 255);
    if (i % 4 === 3) assert.equal(output[i], input[i]);
  }
});
