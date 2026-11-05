"use strict";
(() => {
  // src/processing.ts
  var MAX_PIXELS = 32e6;
  var MAX_DIMENSION = 8192;
  var RGBA_CHANNELS = 4;
  function assertDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError("Image dimensions must be positive integers.");
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {
      throw new RangeError("Image dimensions exceed the processing limits.");
    }
    return width * height;
  }
  function assertImage(data, width, height) {
    const pixels = assertDimensions(width, height);
    if (!(data instanceof Uint8ClampedArray)) {
      throw new TypeError("Image data must be a Uint8ClampedArray.");
    }
    if (data.length !== pixels * RGBA_CHANNELS) {
      throw new RangeError("Image data length does not match its dimensions.");
    }
    return pixels;
  }
  function edgeLength(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function isValidQuad(points) {
    if (!Array.isArray(points) || points.length !== 4) return false;
    for (const point of points) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    }
    const edges = points.map((point, index) => ({
      x: points[(index + 1) % 4].x - point.x,
      y: points[(index + 1) % 4].y - point.y
    }));
    let scale = 0;
    for (const edge of edges) {
      if (!Number.isFinite(edge.x) || !Number.isFinite(edge.y)) return false;
      scale = Math.max(scale, Math.abs(edge.x), Math.abs(edge.y));
    }
    if (scale === 0 || !Number.isFinite(scale)) return false;
    let winding = 0;
    for (let index = 0; index < 4; index++) {
      const first = edges[index];
      const second = edges[(index + 1) % 4];
      const cross = first.x / scale * (second.y / scale) - first.y / scale * (second.x / scale);
      if (!Number.isFinite(cross) || Math.abs(cross) <= 1e-8) return false;
      const sign = Math.sign(cross);
      if (winding !== 0 && sign !== winding) return false;
      winding = sign;
    }
    return true;
  }
  function estimateRectifiedSize(points) {
    if (!isValidQuad(points)) throw new RangeError("Corners must form a valid convex quadrilateral.");
    const width = Math.max(1, Math.round((edgeLength(points[0], points[1]) + edgeLength(points[3], points[2])) / 2) + 1);
    const height = Math.max(1, Math.round((edgeLength(points[0], points[3]) + edgeLength(points[1], points[2])) / 2) + 1);
    assertDimensions(width, height);
    return { width, height };
  }
  function inverseHomography(points) {
    const [p00, p10, p11, p01] = points;
    const dx1 = p10.x - p11.x;
    const dx2 = p01.x - p11.x;
    const dx3 = p00.x - p10.x + p11.x - p01.x;
    const dy1 = p10.y - p11.y;
    const dy2 = p01.y - p11.y;
    const dy3 = p00.y - p10.y + p11.y - p01.y;
    const scale = Math.max(1, Math.abs(dx1), Math.abs(dx2), Math.abs(dx3), Math.abs(dy1), Math.abs(dy2), Math.abs(dy3));
    let g = 0;
    let h = 0;
    if (Math.abs(dx3) + Math.abs(dy3) > scale * 1e-12) {
      const denominator = dx1 * dy2 - dx2 * dy1;
      if (!Number.isFinite(denominator) || Math.abs(denominator) <= scale * scale * 1e-12) {
        throw new RangeError("The selected quadrilateral cannot be rectified.");
      }
      g = (dx3 * dy2 - dx2 * dy3) / denominator;
      h = (dx1 * dy3 - dx3 * dy1) / denominator;
    }
    const transform = {
      a: p10.x - p00.x + g * p10.x,
      b: p01.x - p00.x + h * p01.x,
      c: p00.x,
      d: p10.y - p00.y + g * p10.y,
      e: p01.y - p00.y + h * p01.y,
      f: p00.y,
      g,
      h
    };
    if (Object.values(transform).some((value) => !Number.isFinite(value))) {
      throw new RangeError("The selected quadrilateral cannot be rectified.");
    }
    const cornerDenominators = [1, 1 + g, 1 + g + h, 1 + h];
    if (cornerDenominators.some((value) => !Number.isFinite(value) || value <= 1e-12)) {
      throw new RangeError("The selected quadrilateral cannot be rectified.");
    }
    return transform;
  }
  function rectifyImage(data, width, height, corners, outWidth, outHeight) {
    assertImage(data, width, height);
    const outputPixels = assertDimensions(outWidth, outHeight);
    if (!isValidQuad(corners)) throw new RangeError("Corners must form a valid convex quadrilateral.");
    for (const point of corners) {
      if (point.x < 0 || point.y < 0 || point.x > width - 1 || point.y > height - 1) {
        throw new RangeError("Corners must lie within the image bounds.");
      }
    }
    const transform = inverseHomography(corners);
    const output = new Uint8ClampedArray(outputPixels * RGBA_CHANNELS);
    const maxX = width - 1;
    const maxY = height - 1;
    for (let y = 0; y < outHeight; y++) {
      const v = outHeight === 1 ? 0.5 : y / (outHeight - 1);
      const rowBase = y * outWidth * RGBA_CHANNELS;
      for (let x = 0; x < outWidth; x++) {
        const u = outWidth === 1 ? 0.5 : x / (outWidth - 1);
        const denominator = transform.g * u + transform.h * v + 1;
        const sourceX = (transform.a * u + transform.b * v + transform.c) / denominator;
        const sourceY = (transform.d * u + transform.e * v + transform.f) / denominator;
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
          throw new RangeError("The selected quadrilateral cannot be rectified.");
        }
        const sx = Math.min(maxX, Math.max(0, sourceX));
        const sy = Math.min(maxY, Math.max(0, sourceY));
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(x0 + 1, maxX);
        const y1 = Math.min(y0 + 1, maxY);
        const fx = sx - x0;
        const fy = sy - y0;
        const topLeft = (y0 * width + x0) * RGBA_CHANNELS;
        const topRight = (y0 * width + x1) * RGBA_CHANNELS;
        const bottomLeft = (y1 * width + x0) * RGBA_CHANNELS;
        const bottomRight = (y1 * width + x1) * RGBA_CHANNELS;
        const target = rowBase + x * RGBA_CHANNELS;
        for (let channel = 0; channel < RGBA_CHANNELS; channel++) {
          const top = data[topLeft + channel] * (1 - fx) + data[topRight + channel] * fx;
          const bottom = data[bottomLeft + channel] * (1 - fx) + data[bottomRight + channel] * fx;
          output[target + channel] = top * (1 - fy) + bottom * fy;
        }
      }
    }
    return output;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }
  function filterLine(source, sourceOffset, sourceStride, target, targetOffset, targetStride, length, radius, maximum, queue) {
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let position = 0; position < length; position++) {
      const right = Math.min(length - 1, position + radius);
      while (next <= right) {
        const value = source[sourceOffset + next * sourceStride];
        while (tail > head) {
          const previous = source[sourceOffset + queue[tail - 1] * sourceStride];
          if (maximum ? previous > value : previous < value) break;
          tail--;
        }
        queue[tail++] = next++;
      }
      const left = Math.max(0, position - radius);
      while (head < tail && queue[head] < left) head++;
      target[targetOffset + position * targetStride] = source[sourceOffset + queue[head] * sourceStride];
    }
  }
  function filterAxis(source, target, width, height, radius, horizontal, maximum, queue) {
    if (horizontal) {
      for (let y = 0; y < height; y++) {
        const offset = y * width;
        filterLine(source, offset, 1, target, offset, 1, width, radius, maximum, queue);
      }
    } else {
      for (let x = 0; x < width; x++) {
        filterLine(source, x, width, target, x, width, height, radius, maximum, queue);
      }
    }
  }
  function smoothLine(source, sourceOffset, sourceStride, target, targetOffset, targetStride, length, radius) {
    let left = 0;
    let right = Math.min(length - 1, radius);
    let sum = 0;
    for (let index = left; index <= right; index++) sum += source[sourceOffset + index * sourceStride];
    for (let position = 0; position < length; position++) {
      target[targetOffset + position * targetStride] = sum / (right - left + 1);
      if (position + 1 >= length) continue;
      const nextLeft = Math.max(0, position + 1 - radius);
      const nextRight = Math.min(length - 1, position + 1 + radius);
      if (nextLeft > left) sum -= source[sourceOffset + left++ * sourceStride];
      if (nextRight > right) sum += source[sourceOffset + ++right * sourceStride];
    }
  }
  function smoothAxis(source, target, width, height, horizontal) {
    if (horizontal) {
      for (let y = 0; y < height; y++) {
        const offset = y * width;
        smoothLine(source, offset, 1, target, offset, 1, width, 1);
      }
    } else {
      for (let x = 0; x < width; x++) {
        smoothLine(source, x, width, target, x, width, height, 1);
      }
    }
  }
  function estimateBackground(field, scratch, width, height, radius, mode, queue) {
    if (radius === 0) return;
    const firstIsMaximum = mode === "whiteboard";
    filterAxis(field, scratch, width, height, radius, true, firstIsMaximum, queue);
    filterAxis(scratch, field, width, height, radius, false, firstIsMaximum, queue);
    filterAxis(field, scratch, width, height, radius, true, !firstIsMaximum, queue);
    filterAxis(scratch, field, width, height, radius, false, !firstIsMaximum, queue);
    smoothAxis(field, scratch, width, height, true);
    smoothAxis(scratch, field, width, height, false);
  }
  function interpolatedBackground(field, width, height, x0, x1, y0, y1, xFraction, yFraction) {
    const topLeft = field[y0 * width + x0];
    const topRight = field[y0 * width + x1];
    const bottomLeft = field[y1 * width + x0];
    const bottomRight = field[y1 * width + x1];
    const top = topLeft + (topRight - topLeft) * xFraction;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * xFraction;
    return top + (bottom - top) * yFraction;
  }
  function normalizeChannel(value, background, localMean, mode) {
    const white = mode === "whiteboard";
    const fine = white ? (localMean - value) / Math.max(32, localMean) : (value - localMean) / Math.max(32, 255 - localMean);
    const coarse = white ? (background - value) / Math.max(32, background) : (value - background) / Math.max(32, 255 - background);
    const depth = clamp(Math.max((fine - 0.012) * 7, (coarse - 0.16) * 4), 0, 1);
    if (depth < 0.025) return white ? 255 : 0;
    return white ? 255 * (1 - depth) : 255 * depth;
  }
  function enhanceBoard(data, width, height, mode, strength) {
    const pixels = assertImage(data, width, height);
    if (mode !== "whiteboard" && mode !== "blackboard") throw new TypeError("Unknown board enhancement mode.");
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
      throw new RangeError("Enhancement strength must be between 0 and 1.");
    }
    if (strength === 0) return new Uint8ClampedArray(data);
    const tileSize = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 24)));
    const mapWidth = Math.ceil(width / tileSize);
    const mapHeight = Math.ceil(height / tileSize);
    const mapPixels = mapWidth * mapHeight;
    const backgrounds = [
      new Float32Array(mapPixels),
      new Float32Array(mapPixels),
      new Float32Array(mapPixels)
    ];
    const scratch = new Float32Array(mapPixels);
    for (let mapY = 0; mapY < mapHeight; mapY++) {
      const yStart = mapY * tileSize;
      const yEnd = Math.min(height, yStart + tileSize);
      for (let mapX = 0; mapX < mapWidth; mapX++) {
        const xStart = mapX * tileSize;
        const xEnd = Math.min(width, xStart + tileSize);
        let red = mode === "whiteboard" ? -Infinity : Infinity;
        let green = red;
        let blue = red;
        for (let y = yStart; y < yEnd; y++) {
          let offset = (y * width + xStart) * RGBA_CHANNELS;
          for (let x = xStart; x < xEnd; x++, offset += RGBA_CHANNELS) {
            if (mode === "whiteboard") {
              red = Math.max(red, data[offset]);
              green = Math.max(green, data[offset + 1]);
              blue = Math.max(blue, data[offset + 2]);
            } else {
              red = Math.min(red, data[offset]);
              green = Math.min(green, data[offset + 1]);
              blue = Math.min(blue, data[offset + 2]);
            }
          }
        }
        const mapIndex = mapY * mapWidth + mapX;
        const emptyValue = mode === "whiteboard" ? 255 : 0;
        backgrounds[0][mapIndex] = Number.isFinite(red) ? red : emptyValue;
        backgrounds[1][mapIndex] = Number.isFinite(green) ? green : emptyValue;
        backgrounds[2][mapIndex] = Number.isFinite(blue) ? blue : emptyValue;
      }
    }
    const mapRadius = Math.min(mapWidth, mapHeight) < 16 ? 0 : Math.max(1, Math.min(8, Math.round(Math.min(mapWidth, mapHeight) * 0.055)));
    const radius = mapRadius;
    const queue = new Int32Array(Math.max(mapWidth, mapHeight));
    for (const background of backgrounds) {
      estimateBackground(background, scratch, mapWidth, mapHeight, radius, mode, queue);
    }
    const output = new Uint8ClampedArray(data.length);
    const fineRadius = Math.min(width, height) < 16 ? 0 : Math.max(2, Math.min(24, Math.round(Math.min(width, height) * 8e-3)));
    const columnSums = new Float64Array(width * 3);
    const addRow = (row, sign) => {
      for (let x = 0; x < width; x++) {
        const src = (row * width + x) * 4, col = x * 3;
        columnSums[col] += data[src] * sign;
        columnSums[col + 1] += data[src + 1] * sign;
        columnSums[col + 2] += data[src + 2] * sign;
      }
    };
    for (let row = 0; row <= Math.min(height - 1, fineRadius); row++) addRow(row, 1);
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - fineRadius), bottom = Math.min(height - 1, y + fineRadius);
      let left = 0, right = Math.min(width - 1, fineRadius), sumR = 0, sumG = 0, sumB = 0;
      for (let x = left; x <= right; x++) {
        sumR += columnSums[x * 3];
        sumG += columnSums[x * 3 + 1];
        sumB += columnSums[x * 3 + 2];
      }
      const mapY = clamp(y / tileSize - 0.5, 0, mapHeight - 1);
      const y0 = Math.floor(mapY);
      const y1 = Math.min(y0 + 1, mapHeight - 1);
      const yFraction = mapY - y0;
      const sourceRow = y * width;
      for (let x = 0; x < width; x++) {
        const mapX = clamp(x / tileSize - 0.5, 0, mapWidth - 1);
        const x0 = Math.floor(mapX);
        const x1 = Math.min(x0 + 1, mapWidth - 1);
        const xFraction = mapX - x0;
        const redBackground = interpolatedBackground(backgrounds[0], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);
        const greenBackground = interpolatedBackground(backgrounds[1], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);
        const blueBackground = interpolatedBackground(backgrounds[2], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);
        const pixel = sourceRow + x;
        const offset = pixel * RGBA_CHANNELS;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const count = (bottom - top + 1) * (right - left + 1);
        const targetRed = normalizeChannel(red, redBackground, sumR / count, mode);
        const targetGreen = normalizeChannel(green, greenBackground, sumG / count, mode);
        const targetBlue = normalizeChannel(blue, blueBackground, sumB / count, mode);
        output[offset] = red + (targetRed - red) * strength;
        output[offset + 1] = green + (targetGreen - green) * strength;
        output[offset + 2] = blue + (targetBlue - blue) * strength;
        output[offset + 3] = data[offset + 3];
        if (x + 1 < width) {
          const nextLeft = Math.max(0, x + 1 - fineRadius), nextRight = Math.min(width - 1, x + 1 + fineRadius);
          if (nextLeft > left) {
            sumR -= columnSums[left * 3];
            sumG -= columnSums[left * 3 + 1];
            sumB -= columnSums[left * 3 + 2];
            left = nextLeft;
          }
          if (nextRight > right) {
            right = nextRight;
            sumR += columnSums[right * 3];
            sumG += columnSums[right * 3 + 1];
            sumB += columnSums[right * 3 + 2];
          }
        }
      }
      if (y + 1 < height) {
        const nextTop = Math.max(0, y + 1 - fineRadius), nextBottom = Math.min(height - 1, y + 1 + fineRadius);
        if (nextTop > top) addRow(top, -1);
        if (nextBottom > bottom) addRow(nextBottom, 1);
      }
    }
    return output;
  }

  // src/adjustments.ts
  var DEFAULT_ADJUSTMENTS = Object.freeze({
    exposure: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    sharpen: 0
  });
  var ADJUSTMENT_LIMITS = {
    exposure: [-3, 3],
    brightness: [-100, 100],
    contrast: [-100, 100],
    saturation: [-100, 100],
    warmth: [-100, 100],
    sharpen: [0, 100]
  };
  var ADJUSTMENT_NAMES = Object.keys(ADJUSTMENT_LIMITS);
  var CHANNELS = 4;
  var SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  function normalizeAdjustments(input = {}) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new TypeError("Adjustments must be an object.");
    }
    const record = input;
    const result = { ...DEFAULT_ADJUSTMENTS };
    for (const name of ADJUSTMENT_NAMES) {
      if (!Object.prototype.hasOwnProperty.call(record, name)) continue;
      const value = record[name];
      if (typeof value !== "number" || !Number.isFinite(value)) {
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
  function hasAdjustments(input) {
    return ADJUSTMENT_NAMES.some((name) => input[name] !== 0);
  }
  function assertDimensions2(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError("Image dimensions must be positive integers.");
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {
      throw new RangeError("Image dimensions exceed the processing limits.");
    }
    return width * height;
  }
  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }
  function linearToSrgb(value) {
    const linear = Math.max(0, Math.min(1, value));
    return linear <= 31308e-7 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  }
  function sharpenImage(data, width, height, amount) {
    const rowLength = width * CHANNELS;
    const rows = new Uint8ClampedArray(rowLength * 3);
    const copyRow = (sourceY, slot) => {
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
  function applyAdjustments(data, width, height, input = {}) {
    const pixels = assertDimensions2(width, height);
    if (!(data instanceof Uint8ClampedArray)) {
      throw new TypeError("Image data must be a Uint8ClampedArray.");
    }
    if (data.length !== pixels * CHANNELS) {
      throw new RangeError("Image data length does not match its dimensions.");
    }
    const adjustments = normalizeAdjustments(input);
    if (!hasAdjustments(adjustments)) return new Uint8ClampedArray(data);
    const output = new Uint8ClampedArray(data.length);
    let exposureLut;
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

  // src/processing-worker.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function handleMessage(event, scope) {
    const raw = event.data;
    const id = isRecord(raw) && Number.isSafeInteger(raw.id) ? raw.id : -1;
    try {
      if (!isRecord(raw)) throw new TypeError("Invalid processing request.");
      const request = raw;
      if (!(request.data instanceof ArrayBuffer)) throw new TypeError("Request data must be an ArrayBuffer.");
      if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
        throw new RangeError("Image dimensions must be positive integers.");
      }
      if (request.width > MAX_DIMENSION || request.height > MAX_DIMENSION || request.width > Math.floor(MAX_PIXELS / request.height)) {
        throw new RangeError("Image dimensions exceed the processing limits.");
      }
      const expectedLength = request.width * request.height * 4;
      if (request.data.byteLength !== expectedLength) throw new RangeError("Image data length does not match its dimensions.");
      let data = new Uint8ClampedArray(request.data);
      let width = request.width;
      let height = request.height;
      let didWork = false;
      if (request.corners !== void 0) {
        let outputSize;
        if (request.outWidth === void 0 && request.outHeight === void 0) {
          outputSize = estimateRectifiedSize(request.corners);
        } else {
          if (request.outWidth === void 0 || request.outHeight === void 0) {
            throw new RangeError("Both output dimensions must be provided.");
          }
          outputSize = { width: request.outWidth, height: request.outHeight };
        }
        data = rectifyImage(data, width, height, request.corners, outputSize.width, outputSize.height);
        width = outputSize.width;
        height = outputSize.height;
        didWork = true;
      } else if (request.outWidth !== void 0 || request.outHeight !== void 0) {
        throw new RangeError("Output dimensions require perspective corners.");
      }
      if (request.mode !== void 0) {
        data = enhanceBoard(data, width, height, request.mode, request.strength ?? 1);
        didWork = true;
      } else if (request.strength !== void 0) {
        throw new RangeError("Enhancement strength requires a board mode.");
      }
      if (request.adjustments !== void 0) {
        data = applyAdjustments(data, width, height, request.adjustments);
        didWork = true;
      }
      if (!didWork) throw new TypeError("Request must specify perspective correction, board enhancement or image adjustments.");
      const response = { id, data: data.buffer, width, height };
      scope.postMessage(response, [response.data]);
    } catch (error) {
      const response = {
        id,
        error: error instanceof Error ? error.message : "Image processing failed."
      };
      scope.postMessage(response);
    }
  }
  var workerScope = globalThis;
  if (typeof document === "undefined" && typeof workerScope.addEventListener === "function" && typeof workerScope.postMessage === "function") {
    workerScope.addEventListener("message", (event) => handleMessage(event, workerScope));
  }
})();
