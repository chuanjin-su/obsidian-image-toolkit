import { MAX_DIMENSION, MAX_PIXELS } from './processing';

export interface BasicAdjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpen: number;
}

export const DEFAULT_ADJUSTMENTS: Readonly<BasicAdjustments> = Object.freeze({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  sharpen: 0,
});

const ADJUSTMENT_LIMITS: Record<keyof BasicAdjustments, readonly [number, number]> = {
  exposure: [-3, 3],
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  warmth: [-100, 100],
  sharpen: [0, 100],
};
const ADJUSTMENT_NAMES = Object.keys(ADJUSTMENT_LIMITS) as Array<keyof BasicAdjustments>;
const CHANNELS = 4;
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

/** Fill omitted controls with zero and reject values outside their supported ranges. */
export function normalizeAdjustments(input: Partial<BasicAdjustments> = {}): BasicAdjustments {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Adjustments must be an object.');
  }

  const record = input as Record<string, unknown>;
  const result: BasicAdjustments = { ...DEFAULT_ADJUSTMENTS };
  for (const name of ADJUSTMENT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(record, name)) continue;
    const value = record[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Adjustment '${name}' must be a finite number.`);
    }
    const [minimum, maximum] = ADJUSTMENT_LIMITS[name];
    if (value < minimum || value > maximum) {
      throw new RangeError(`Adjustment '${name}' must be between ${minimum} and ${maximum}.`);
    }
    result[name] = value;
  }
  return result;
}

/** True when at least one basic photo adjustment differs from its neutral value. */
export function hasAdjustments(input: BasicAdjustments): boolean {
  return ADJUSTMENT_NAMES.some(name => input[name] !== 0);
}

function assertDimensions(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {
    throw new RangeError('Image dimensions exceed the processing limits.');
  }
  return width * height;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function linearToSrgb(value: number): number {
  const linear = Math.max(0, Math.min(1, value));
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function sharpenImage(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const rowLength = width * CHANNELS;
  // Keep only three source rows so writes cannot affect later blur samples.
  const rows = new Uint8ClampedArray(rowLength * 3);
  const copyRow = (sourceY: number, slot: number) => {
    const sourceStart = sourceY * rowLength;
    rows.set(data.subarray(sourceStart, sourceStart + rowLength), slot * rowLength);
  };

  copyRow(0, 0);
  if (height > 1) copyRow(1, 1);

  for (let y = 0; y < height; y++) {
    if (y > 0) copyRow(Math.min(y + 1, height - 1), (y + 1) % 3);
    const topOffset = Math.max(0, y - 1) % 3 * rowLength;
    const middleOffset = y % 3 * rowLength;
    const bottomOffset = Math.min(y + 1, height - 1) % 3 * rowLength;

    for (let x = 0; x < width; x++) {
      const target = y * rowLength + x * CHANNELS;
      const centerAlpha = rows[middleOffset + x * CHANNELS + 3];
      if (centerAlpha === 0) continue;

      let weightSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const rowOffset = dy < 0 ? topOffset : dy > 0 ? bottomOffset : middleOffset;
        const verticalWeight = dy === 0 ? 2 : 1;
        for (let dx = -1; dx <= 1; dx++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + dx));
          const sample = rowOffset + sampleX * CHANNELS;
          const alpha = rows[sample + 3];
          if (alpha === 0) continue;
          const weight = verticalWeight * (dx === 0 ? 2 : 1) * alpha;
          weightSum += weight;
          redSum += rows[sample] * weight;
          greenSum += rows[sample + 1] * weight;
          blueSum += rows[sample + 2] * weight;
        }
      }
      if (weightSum === 0) continue;

      data[target] = clampByte(rows[middleOffset + x * CHANNELS] + amount * (rows[middleOffset + x * CHANNELS] - redSum / weightSum));
      data[target + 1] = clampByte(rows[middleOffset + x * CHANNELS + 1] + amount * (rows[middleOffset + x * CHANNELS + 1] - greenSum / weightSum));
      data[target + 2] = clampByte(rows[middleOffset + x * CHANNELS + 2] + amount * (rows[middleOffset + x * CHANNELS + 2] - blueSum / weightSum));
    }
  }
}

/** Apply basic photo adjustments to RGBA bytes without changing the source. */
export function applyAdjustments(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  input: Partial<BasicAdjustments> = {},
): Uint8ClampedArray {
  const pixels = assertDimensions(width, height);
  if (!(data instanceof Uint8ClampedArray)) {
    throw new TypeError('Image data must be a Uint8ClampedArray.');
  }
  if (data.length !== pixels * CHANNELS) {
    throw new RangeError('Image data length does not match its dimensions.');
  }

  const adjustments = normalizeAdjustments(input);
  if (!hasAdjustments(adjustments)) return new Uint8ClampedArray(data);

  const output = new Uint8ClampedArray(data.length);
  let exposureLut: Float32Array | undefined;
  if (adjustments.exposure !== 0) {
    const exposure = 2 ** adjustments.exposure;
    exposureLut = new Float32Array(256);
    for (let value = 0; value < exposureLut.length; value++) {
      exposureLut[value] = linearToSrgb(SRGB_TO_LINEAR[value] * exposure) * 255;
    }
  }
  const brightness = adjustments.brightness / 100;
  const contrast = 1 + adjustments.contrast / 100;
  const saturation = 1 + adjustments.saturation / 100;
  const warmth = adjustments.warmth / 100;
  const redGain = 1 + warmth * 0.15;
  const blueGain = 1 - warmth * 0.15;

  for (let offset = 0; offset < data.length; offset += CHANNELS) {
    let red = data[offset];
    let green = data[offset + 1];
    let blue = data[offset + 2];

    if (exposureLut) {
      red = exposureLut[red];
      green = exposureLut[green];
      blue = exposureLut[blue];
    }

    if (brightness > 0) {
      red += (255 - red) * brightness;
      green += (255 - green) * brightness;
      blue += (255 - blue) * brightness;
    } else if (brightness < 0) {
      red *= 1 + brightness;
      green *= 1 + brightness;
      blue *= 1 + brightness;
    }

    if (adjustments.contrast !== 0) {
      red = (red - 127.5) * contrast + 127.5;
      green = (green - 127.5) * contrast + 127.5;
      blue = (blue - 127.5) * contrast + 127.5;
    }

    if (adjustments.saturation !== 0) {
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red = luminance + (red - luminance) * saturation;
      green = luminance + (green - luminance) * saturation;
      blue = luminance + (blue - luminance) * saturation;
    }

    red = clampByte(red * redGain);
    green = clampByte(green);
    blue = clampByte(blue * blueGain);
    output[offset] = red;
    output[offset + 1] = green;
    output[offset + 2] = blue;
    output[offset + 3] = data[offset + 3];
  }

  if (adjustments.sharpen > 0) sharpenImage(output, width, height, adjustments.sharpen / 100);
  return output;
}
