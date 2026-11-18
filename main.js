"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ImageToolkit
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/editor.ts
var import_obsidian2 = require("obsidian");

// src/embeds.ts
function findImageEmbeds(text) {
  const results = [];
  const pattern = /!\[\[([^\]\n]+)\]\]|!\[((?:\\.|[^\]\\\n])*)\]\(\s*(<[^>\n]+>|(?:\\.|[^\s()\\])+)(?:\s+"(?:\\.|[^"\\])*")?\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    let link = match[1] ? match[1].split("|")[0].split("#")[0] : match[3].replace(/^<|>$/g, "").replace(/\\([() ])/g, "$1");
    try {
      link = decodeURIComponent(link);
    } catch {
    }
    results.push({ start: match.index, end: match.index + match[0].length, original: match[0], link });
  }
  return results;
}
function supportedExtension(path) {
  return /\.(jpe?g|png|webp)$/i.test(path);
}
function isRemote(link) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link);
}
function assertStaticImage(bytes, extension) {
  const data = new Uint8Array(bytes);
  const ascii = (start, count) => String.fromCharCode(...data.subarray(start, start + count));
  if (extension === "png") {
    if (data.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => data[i] === byte)) throw new Error("Invalid PNG image or extension mismatch.");
    for (let p = 8; p + 12 <= data.length; ) {
      const length = new DataView(bytes).getUint32(p);
      if (ascii(p + 4, 4) === "acTL") throw new Error("Animated PNG images are not supported.");
      if (length > data.length - p - 12) throw new Error("Invalid PNG chunk.");
      p += length + 12;
    }
  } else if (extension === "webp") {
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") throw new Error("Invalid WebP image.");
    for (let p = 12; p + 8 <= data.length; ) {
      const tag = ascii(p, 4), length = new DataView(bytes).getUint32(p + 4, true);
      if (tag === "ANIM" || tag === "ANMF" || tag === "VP8X" && data[p + 8] & 2) throw new Error("Animated WebP images are not supported.");
      if (length > data.length - p - 8) throw new Error("Invalid WebP chunk.");
      p += 8 + length + length % 2;
    }
  } else if (extension === "jpg" || extension === "jpeg") {
    if (data.length < 3 || data[0] !== 255 || data[1] !== 216 || data[2] !== 255) throw new Error("Invalid JPEG image or extension mismatch. Renamed animated formats are not supported.");
  } else throw new Error("Only static JPEG, PNG and WebP are supported.");
}

// src/processing.ts
var MAX_PIXELS = 32e6;
var MAX_DIMENSION = 8192;
function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Image dimensions must be positive integers.");
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {
    throw new RangeError("Image dimensions exceed the processing limits.");
  }
  return width * height;
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

// src/storage.ts
function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}
function normalizeBackupFolder(folder) {
  if (typeof folder !== "string" || folder.trim().length === 0) {
    throw new Error("Backup folder must not be empty.");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(folder)) {
    throw new Error("Backup folder cannot contain control characters.");
  }
  const slashPath = folder.trim().replace(/\\/g, "/");
  if (slashPath.startsWith("/") || /^[a-z]:/i.test(slashPath)) {
    throw new Error("Backup folder must be a relative vault path.");
  }
  const parts = slashPath.split("/").map((part) => part.trim()).filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => /[:*?"<>|]/.test(part))) {
    throw new Error("Backup folder contains unsupported filename characters.");
  }
  if (parts.includes("..")) {
    throw new Error("Backup folder cannot contain '..' path segments.");
  }
  if (parts.length === 0) {
    throw new Error("Backup folder must not be empty.");
  }
  return parts.join("/");
}
function assertSourceStillPresent(app, source, expectedPath) {
  if (source.path !== expectedPath || app.vault.getAbstractFileByPath(expectedPath) !== source) {
    throw new Error("The source image was removed or moved while it was being saved.");
  }
}
async function assertSourceUnchanged(app, source, expectedPath, originalBytes) {
  assertSourceStillPresent(app, source, expectedPath);
  const currentBytes = await app.vault.readBinary(source);
  assertSourceStillPresent(app, source, expectedPath);
  if (!bytesEqual(currentBytes, originalBytes)) {
    throw new Error("The source image changed while it was being edited.");
  }
}
function isFolder(entry) {
  return typeof entry === "object" && entry !== null && Array.isArray(entry.children);
}
async function ensureFolder(app, path, label = "backup") {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing) {
      if (!isFolder(existing)) throw new Error(`Cannot create ${label} folder because '${current}' is a file.`);
      continue;
    }
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      const created2 = app.vault.getAbstractFileByPath(current);
      if (!isFolder(created2)) throw error;
    }
    const created = app.vault.getAbstractFileByPath(current);
    if (!isFolder(created)) throw new Error(`Could not create ${label} folder '${current}'.`);
  }
}
function sourceParent(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
function sourceFilename(path) {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return { basename: filename, extension: "" };
  return { basename: filename.slice(0, dot), extension: filename.slice(dot) };
}
function isBackupCollision(app, path) {
  return app.vault.getAbstractFileByPath(path) !== null;
}
async function createUniqueBackup(app, sourcePath, backupFolder, originalBytes) {
  const parent = sourceParent(sourcePath);
  const backupDirectory = [backupFolder, parent].filter(Boolean).join("/");
  await ensureFolder(app, backupDirectory);
  const { basename, extension } = sourceFilename(sourcePath);
  const timestamp = Date.now();
  for (let collision = 0; Number.isSafeInteger(collision); collision++) {
    const suffix = collision === 0 ? "" : `-${collision}`;
    const path = `${backupDirectory}/${basename}-backup-${timestamp}${suffix}${extension}`;
    if (app.vault.getAbstractFileByPath(path)) continue;
    try {
      const file = await app.vault.createBinary(path, originalBytes.slice(0));
      return { path, file };
    } catch (error) {
      if (isBackupCollision(app, path)) continue;
      throw error;
    }
  }
  throw new Error("Could not find a unique backup image path.");
}
async function assertBackupWritten(app, backup, originalBytes) {
  if (backup.file.path !== backup.path || app.vault.getAbstractFileByPath(backup.path) !== backup.file) {
    throw new Error("The backup image could not be verified.");
  }
  const backupBytes = await app.vault.readBinary(backup.file);
  if (backup.file.path !== backup.path || app.vault.getAbstractFileByPath(backup.path) !== backup.file || !bytesEqual(backupBytes, originalBytes)) {
    throw new Error("The backup image could not be verified.");
  }
}
var imageSaveQueues = /* @__PURE__ */ new WeakMap();
async function withImageSaveLock(app, source, action) {
  let queue = imageSaveQueues.get(app.vault);
  if (!queue) {
    queue = /* @__PURE__ */ new WeakMap();
    imageSaveQueues.set(app.vault, queue);
  }
  const previous = queue.get(source) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  queue.set(source, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (queue.get(source) === current) queue.delete(source);
  }
}
async function saveImage(app, source, originalBytes, output, options) {
  if (output.byteLength === 0) throw new Error("Cannot save an empty image.");
  const sourcePath = source.path;
  const originalSnapshot = originalBytes.slice(0);
  const outputSnapshot = output.slice(0);
  const preferences = { ...options };
  return withImageSaveLock(app, source, async () => {
    assertSourceStillPresent(app, source, sourcePath);
    if (!preferences.backupEnabled) {
      await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
      assertSourceStillPresent(app, source, sourcePath);
      await app.vault.modifyBinary(source, outputSnapshot.slice(0));
      return { path: sourcePath };
    }
    const backupFolder = normalizeBackupFolder(preferences.backupFolder);
    await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
    const backup = await createUniqueBackup(app, sourcePath, backupFolder, originalSnapshot);
    await assertBackupWritten(app, backup, originalSnapshot);
    await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
    assertSourceStillPresent(app, source, sourcePath);
    await app.vault.modifyBinary(source, outputSnapshot.slice(0));
    return { path: sourcePath, backupPath: backup.path };
  });
}

// src/refresh.ts
var revision = 0;
var resourceKey = (url) => url.split(/[?#]/, 1)[0];
function refreshImageViews(app, file, ownerDocument) {
  const resource = app.vault.getResourcePath(file);
  const key = resourceKey(resource);
  const fresh = new URL(resource);
  fresh.searchParams.set("image-toolkit", `${Date.now()}-${++revision}`);
  const documents = /* @__PURE__ */ new Set([ownerDocument]);
  app.workspace.iterateAllLeaves((leaf) => documents.add(leaf.view.containerEl.ownerDocument));
  for (const doc of documents) {
    for (const img of doc.querySelectorAll("img")) {
      if (resourceKey(img.currentSrc || img.src) === key) img.src = fresh.href;
    }
  }
}

// src/preview.ts
function fitPreviewSize(width, height, viewportWidth, viewportHeight, zoom = 100, padding = 12) {
  if (![width, height, viewportWidth, viewportHeight, zoom].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid preview dimensions.");
  const availableWidth = Math.max(1, viewportWidth - padding * 2), availableHeight = Math.max(1, viewportHeight - padding * 2);
  const fit = Math.min(availableWidth / width, availableHeight / height, 1);
  return { width: Math.max(1, Math.floor(width * fit * zoom / 100)), height: Math.max(1, Math.floor(height * fit * zoom / 100)) };
}
function rectangleCorners(start, end) {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x), top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
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
var SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});
function hasAdjustments(input) {
  return ADJUSTMENT_NAMES.some((name) => input[name] !== 0);
}

// image-toolkit-worker:processing-worker
var processing_worker_default = '"use strict";\n(() => {\n  // src/processing.ts\n  var MAX_PIXELS = 32e6;\n  var MAX_DIMENSION = 8192;\n  var RGBA_CHANNELS = 4;\n  function assertDimensions(width, height) {\n    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {\n      throw new RangeError("Image dimensions must be positive integers.");\n    }\n    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {\n      throw new RangeError("Image dimensions exceed the processing limits.");\n    }\n    return width * height;\n  }\n  function assertImage(data, width, height) {\n    const pixels = assertDimensions(width, height);\n    if (!(data instanceof Uint8ClampedArray)) {\n      throw new TypeError("Image data must be a Uint8ClampedArray.");\n    }\n    if (data.length !== pixels * RGBA_CHANNELS) {\n      throw new RangeError("Image data length does not match its dimensions.");\n    }\n    return pixels;\n  }\n  function edgeLength(a, b) {\n    return Math.hypot(b.x - a.x, b.y - a.y);\n  }\n  function isValidQuad(points) {\n    if (!Array.isArray(points) || points.length !== 4) return false;\n    for (const point of points) {\n      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;\n    }\n    const edges = points.map((point, index) => ({\n      x: points[(index + 1) % 4].x - point.x,\n      y: points[(index + 1) % 4].y - point.y\n    }));\n    let scale = 0;\n    for (const edge of edges) {\n      if (!Number.isFinite(edge.x) || !Number.isFinite(edge.y)) return false;\n      scale = Math.max(scale, Math.abs(edge.x), Math.abs(edge.y));\n    }\n    if (scale === 0 || !Number.isFinite(scale)) return false;\n    let winding = 0;\n    for (let index = 0; index < 4; index++) {\n      const first = edges[index];\n      const second = edges[(index + 1) % 4];\n      const cross = first.x / scale * (second.y / scale) - first.y / scale * (second.x / scale);\n      if (!Number.isFinite(cross) || Math.abs(cross) <= 1e-8) return false;\n      const sign = Math.sign(cross);\n      if (winding !== 0 && sign !== winding) return false;\n      winding = sign;\n    }\n    return true;\n  }\n  function estimateRectifiedSize(points) {\n    if (!isValidQuad(points)) throw new RangeError("Corners must form a valid convex quadrilateral.");\n    const width = Math.max(1, Math.round((edgeLength(points[0], points[1]) + edgeLength(points[3], points[2])) / 2) + 1);\n    const height = Math.max(1, Math.round((edgeLength(points[0], points[3]) + edgeLength(points[1], points[2])) / 2) + 1);\n    assertDimensions(width, height);\n    return { width, height };\n  }\n  function inverseHomography(points) {\n    const [p00, p10, p11, p01] = points;\n    const dx1 = p10.x - p11.x;\n    const dx2 = p01.x - p11.x;\n    const dx3 = p00.x - p10.x + p11.x - p01.x;\n    const dy1 = p10.y - p11.y;\n    const dy2 = p01.y - p11.y;\n    const dy3 = p00.y - p10.y + p11.y - p01.y;\n    const scale = Math.max(1, Math.abs(dx1), Math.abs(dx2), Math.abs(dx3), Math.abs(dy1), Math.abs(dy2), Math.abs(dy3));\n    let g = 0;\n    let h = 0;\n    if (Math.abs(dx3) + Math.abs(dy3) > scale * 1e-12) {\n      const denominator = dx1 * dy2 - dx2 * dy1;\n      if (!Number.isFinite(denominator) || Math.abs(denominator) <= scale * scale * 1e-12) {\n        throw new RangeError("The selected quadrilateral cannot be rectified.");\n      }\n      g = (dx3 * dy2 - dx2 * dy3) / denominator;\n      h = (dx1 * dy3 - dx3 * dy1) / denominator;\n    }\n    const transform = {\n      a: p10.x - p00.x + g * p10.x,\n      b: p01.x - p00.x + h * p01.x,\n      c: p00.x,\n      d: p10.y - p00.y + g * p10.y,\n      e: p01.y - p00.y + h * p01.y,\n      f: p00.y,\n      g,\n      h\n    };\n    if (Object.values(transform).some((value) => !Number.isFinite(value))) {\n      throw new RangeError("The selected quadrilateral cannot be rectified.");\n    }\n    const cornerDenominators = [1, 1 + g, 1 + g + h, 1 + h];\n    if (cornerDenominators.some((value) => !Number.isFinite(value) || value <= 1e-12)) {\n      throw new RangeError("The selected quadrilateral cannot be rectified.");\n    }\n    return transform;\n  }\n  function rectifyImage(data, width, height, corners, outWidth, outHeight) {\n    assertImage(data, width, height);\n    const outputPixels = assertDimensions(outWidth, outHeight);\n    if (!isValidQuad(corners)) throw new RangeError("Corners must form a valid convex quadrilateral.");\n    for (const point of corners) {\n      if (point.x < 0 || point.y < 0 || point.x > width - 1 || point.y > height - 1) {\n        throw new RangeError("Corners must lie within the image bounds.");\n      }\n    }\n    const transform = inverseHomography(corners);\n    const output = new Uint8ClampedArray(outputPixels * RGBA_CHANNELS);\n    const maxX = width - 1;\n    const maxY = height - 1;\n    for (let y = 0; y < outHeight; y++) {\n      const v = outHeight === 1 ? 0.5 : y / (outHeight - 1);\n      const rowBase = y * outWidth * RGBA_CHANNELS;\n      for (let x = 0; x < outWidth; x++) {\n        const u = outWidth === 1 ? 0.5 : x / (outWidth - 1);\n        const denominator = transform.g * u + transform.h * v + 1;\n        const sourceX = (transform.a * u + transform.b * v + transform.c) / denominator;\n        const sourceY = (transform.d * u + transform.e * v + transform.f) / denominator;\n        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {\n          throw new RangeError("The selected quadrilateral cannot be rectified.");\n        }\n        const sx = Math.min(maxX, Math.max(0, sourceX));\n        const sy = Math.min(maxY, Math.max(0, sourceY));\n        const x0 = Math.floor(sx);\n        const y0 = Math.floor(sy);\n        const x1 = Math.min(x0 + 1, maxX);\n        const y1 = Math.min(y0 + 1, maxY);\n        const fx = sx - x0;\n        const fy = sy - y0;\n        const topLeft = (y0 * width + x0) * RGBA_CHANNELS;\n        const topRight = (y0 * width + x1) * RGBA_CHANNELS;\n        const bottomLeft = (y1 * width + x0) * RGBA_CHANNELS;\n        const bottomRight = (y1 * width + x1) * RGBA_CHANNELS;\n        const target = rowBase + x * RGBA_CHANNELS;\n        for (let channel = 0; channel < RGBA_CHANNELS; channel++) {\n          const top = data[topLeft + channel] * (1 - fx) + data[topRight + channel] * fx;\n          const bottom = data[bottomLeft + channel] * (1 - fx) + data[bottomRight + channel] * fx;\n          output[target + channel] = top * (1 - fy) + bottom * fy;\n        }\n      }\n    }\n    return output;\n  }\n  function clamp(value, minimum, maximum) {\n    return Math.min(maximum, Math.max(minimum, value));\n  }\n  function filterLine(source, sourceOffset, sourceStride, target, targetOffset, targetStride, length, radius, maximum, queue) {\n    let head = 0;\n    let tail = 0;\n    let next = 0;\n    for (let position = 0; position < length; position++) {\n      const right = Math.min(length - 1, position + radius);\n      while (next <= right) {\n        const value = source[sourceOffset + next * sourceStride];\n        while (tail > head) {\n          const previous = source[sourceOffset + queue[tail - 1] * sourceStride];\n          if (maximum ? previous > value : previous < value) break;\n          tail--;\n        }\n        queue[tail++] = next++;\n      }\n      const left = Math.max(0, position - radius);\n      while (head < tail && queue[head] < left) head++;\n      target[targetOffset + position * targetStride] = source[sourceOffset + queue[head] * sourceStride];\n    }\n  }\n  function filterAxis(source, target, width, height, radius, horizontal, maximum, queue) {\n    if (horizontal) {\n      for (let y = 0; y < height; y++) {\n        const offset = y * width;\n        filterLine(source, offset, 1, target, offset, 1, width, radius, maximum, queue);\n      }\n    } else {\n      for (let x = 0; x < width; x++) {\n        filterLine(source, x, width, target, x, width, height, radius, maximum, queue);\n      }\n    }\n  }\n  function smoothLine(source, sourceOffset, sourceStride, target, targetOffset, targetStride, length, radius) {\n    let left = 0;\n    let right = Math.min(length - 1, radius);\n    let sum = 0;\n    for (let index = left; index <= right; index++) sum += source[sourceOffset + index * sourceStride];\n    for (let position = 0; position < length; position++) {\n      target[targetOffset + position * targetStride] = sum / (right - left + 1);\n      if (position + 1 >= length) continue;\n      const nextLeft = Math.max(0, position + 1 - radius);\n      const nextRight = Math.min(length - 1, position + 1 + radius);\n      if (nextLeft > left) sum -= source[sourceOffset + left++ * sourceStride];\n      if (nextRight > right) sum += source[sourceOffset + ++right * sourceStride];\n    }\n  }\n  function smoothAxis(source, target, width, height, horizontal) {\n    if (horizontal) {\n      for (let y = 0; y < height; y++) {\n        const offset = y * width;\n        smoothLine(source, offset, 1, target, offset, 1, width, 1);\n      }\n    } else {\n      for (let x = 0; x < width; x++) {\n        smoothLine(source, x, width, target, x, width, height, 1);\n      }\n    }\n  }\n  function estimateBackground(field, scratch, width, height, radius, mode, queue) {\n    if (radius === 0) return;\n    const firstIsMaximum = mode === "whiteboard";\n    filterAxis(field, scratch, width, height, radius, true, firstIsMaximum, queue);\n    filterAxis(scratch, field, width, height, radius, false, firstIsMaximum, queue);\n    filterAxis(field, scratch, width, height, radius, true, !firstIsMaximum, queue);\n    filterAxis(scratch, field, width, height, radius, false, !firstIsMaximum, queue);\n    smoothAxis(field, scratch, width, height, true);\n    smoothAxis(scratch, field, width, height, false);\n  }\n  function interpolatedBackground(field, width, height, x0, x1, y0, y1, xFraction, yFraction) {\n    const topLeft = field[y0 * width + x0];\n    const topRight = field[y0 * width + x1];\n    const bottomLeft = field[y1 * width + x0];\n    const bottomRight = field[y1 * width + x1];\n    const top = topLeft + (topRight - topLeft) * xFraction;\n    const bottom = bottomLeft + (bottomRight - bottomLeft) * xFraction;\n    return top + (bottom - top) * yFraction;\n  }\n  function normalizeChannel(value, background, localMean, mode) {\n    const white = mode === "whiteboard";\n    const fine = white ? (localMean - value) / Math.max(32, localMean) : (value - localMean) / Math.max(32, 255 - localMean);\n    const coarse = white ? (background - value) / Math.max(32, background) : (value - background) / Math.max(32, 255 - background);\n    const depth = clamp(Math.max((fine - 0.012) * 7, (coarse - 0.16) * 4), 0, 1);\n    if (depth < 0.025) return white ? 255 : 0;\n    return white ? 255 * (1 - depth) : 255 * depth;\n  }\n  function enhanceBoard(data, width, height, mode, strength) {\n    const pixels = assertImage(data, width, height);\n    if (mode !== "whiteboard" && mode !== "blackboard") throw new TypeError("Unknown board enhancement mode.");\n    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {\n      throw new RangeError("Enhancement strength must be between 0 and 1.");\n    }\n    if (strength === 0) return new Uint8ClampedArray(data);\n    const tileSize = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 24)));\n    const mapWidth = Math.ceil(width / tileSize);\n    const mapHeight = Math.ceil(height / tileSize);\n    const mapPixels = mapWidth * mapHeight;\n    const backgrounds = [\n      new Float32Array(mapPixels),\n      new Float32Array(mapPixels),\n      new Float32Array(mapPixels)\n    ];\n    const scratch = new Float32Array(mapPixels);\n    for (let mapY = 0; mapY < mapHeight; mapY++) {\n      const yStart = mapY * tileSize;\n      const yEnd = Math.min(height, yStart + tileSize);\n      for (let mapX = 0; mapX < mapWidth; mapX++) {\n        const xStart = mapX * tileSize;\n        const xEnd = Math.min(width, xStart + tileSize);\n        let red = mode === "whiteboard" ? -Infinity : Infinity;\n        let green = red;\n        let blue = red;\n        for (let y = yStart; y < yEnd; y++) {\n          let offset = (y * width + xStart) * RGBA_CHANNELS;\n          for (let x = xStart; x < xEnd; x++, offset += RGBA_CHANNELS) {\n            if (mode === "whiteboard") {\n              red = Math.max(red, data[offset]);\n              green = Math.max(green, data[offset + 1]);\n              blue = Math.max(blue, data[offset + 2]);\n            } else {\n              red = Math.min(red, data[offset]);\n              green = Math.min(green, data[offset + 1]);\n              blue = Math.min(blue, data[offset + 2]);\n            }\n          }\n        }\n        const mapIndex = mapY * mapWidth + mapX;\n        const emptyValue = mode === "whiteboard" ? 255 : 0;\n        backgrounds[0][mapIndex] = Number.isFinite(red) ? red : emptyValue;\n        backgrounds[1][mapIndex] = Number.isFinite(green) ? green : emptyValue;\n        backgrounds[2][mapIndex] = Number.isFinite(blue) ? blue : emptyValue;\n      }\n    }\n    const mapRadius = Math.min(mapWidth, mapHeight) < 16 ? 0 : Math.max(1, Math.min(8, Math.round(Math.min(mapWidth, mapHeight) * 0.055)));\n    const radius = mapRadius;\n    const queue = new Int32Array(Math.max(mapWidth, mapHeight));\n    for (const background of backgrounds) {\n      estimateBackground(background, scratch, mapWidth, mapHeight, radius, mode, queue);\n    }\n    const output = new Uint8ClampedArray(data.length);\n    const fineRadius = Math.min(width, height) < 16 ? 0 : Math.max(2, Math.min(24, Math.round(Math.min(width, height) * 8e-3)));\n    const columnSums = new Float64Array(width * 3);\n    const addRow = (row, sign) => {\n      for (let x = 0; x < width; x++) {\n        const src = (row * width + x) * 4, col = x * 3;\n        columnSums[col] += data[src] * sign;\n        columnSums[col + 1] += data[src + 1] * sign;\n        columnSums[col + 2] += data[src + 2] * sign;\n      }\n    };\n    for (let row = 0; row <= Math.min(height - 1, fineRadius); row++) addRow(row, 1);\n    for (let y = 0; y < height; y++) {\n      const top = Math.max(0, y - fineRadius), bottom = Math.min(height - 1, y + fineRadius);\n      let left = 0, right = Math.min(width - 1, fineRadius), sumR = 0, sumG = 0, sumB = 0;\n      for (let x = left; x <= right; x++) {\n        sumR += columnSums[x * 3];\n        sumG += columnSums[x * 3 + 1];\n        sumB += columnSums[x * 3 + 2];\n      }\n      const mapY = clamp(y / tileSize - 0.5, 0, mapHeight - 1);\n      const y0 = Math.floor(mapY);\n      const y1 = Math.min(y0 + 1, mapHeight - 1);\n      const yFraction = mapY - y0;\n      const sourceRow = y * width;\n      for (let x = 0; x < width; x++) {\n        const mapX = clamp(x / tileSize - 0.5, 0, mapWidth - 1);\n        const x0 = Math.floor(mapX);\n        const x1 = Math.min(x0 + 1, mapWidth - 1);\n        const xFraction = mapX - x0;\n        const redBackground = interpolatedBackground(backgrounds[0], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);\n        const greenBackground = interpolatedBackground(backgrounds[1], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);\n        const blueBackground = interpolatedBackground(backgrounds[2], mapWidth, mapHeight, x0, x1, y0, y1, xFraction, yFraction);\n        const pixel = sourceRow + x;\n        const offset = pixel * RGBA_CHANNELS;\n        const red = data[offset];\n        const green = data[offset + 1];\n        const blue = data[offset + 2];\n        const count = (bottom - top + 1) * (right - left + 1);\n        const targetRed = normalizeChannel(red, redBackground, sumR / count, mode);\n        const targetGreen = normalizeChannel(green, greenBackground, sumG / count, mode);\n        const targetBlue = normalizeChannel(blue, blueBackground, sumB / count, mode);\n        output[offset] = red + (targetRed - red) * strength;\n        output[offset + 1] = green + (targetGreen - green) * strength;\n        output[offset + 2] = blue + (targetBlue - blue) * strength;\n        output[offset + 3] = data[offset + 3];\n        if (x + 1 < width) {\n          const nextLeft = Math.max(0, x + 1 - fineRadius), nextRight = Math.min(width - 1, x + 1 + fineRadius);\n          if (nextLeft > left) {\n            sumR -= columnSums[left * 3];\n            sumG -= columnSums[left * 3 + 1];\n            sumB -= columnSums[left * 3 + 2];\n            left = nextLeft;\n          }\n          if (nextRight > right) {\n            right = nextRight;\n            sumR += columnSums[right * 3];\n            sumG += columnSums[right * 3 + 1];\n            sumB += columnSums[right * 3 + 2];\n          }\n        }\n      }\n      if (y + 1 < height) {\n        const nextTop = Math.max(0, y + 1 - fineRadius), nextBottom = Math.min(height - 1, y + 1 + fineRadius);\n        if (nextTop > top) addRow(top, -1);\n        if (nextBottom > bottom) addRow(nextBottom, 1);\n      }\n    }\n    return output;\n  }\n\n  // src/adjustments.ts\n  var DEFAULT_ADJUSTMENTS = Object.freeze({\n    exposure: 0,\n    brightness: 0,\n    contrast: 0,\n    saturation: 0,\n    warmth: 0,\n    sharpen: 0\n  });\n  var ADJUSTMENT_LIMITS = {\n    exposure: [-3, 3],\n    brightness: [-100, 100],\n    contrast: [-100, 100],\n    saturation: [-100, 100],\n    warmth: [-100, 100],\n    sharpen: [0, 100]\n  };\n  var ADJUSTMENT_NAMES = Object.keys(ADJUSTMENT_LIMITS);\n  var CHANNELS = 4;\n  var SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {\n    const channel = value / 255;\n    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;\n  });\n  function normalizeAdjustments(input = {}) {\n    if (typeof input !== "object" || input === null || Array.isArray(input)) {\n      throw new TypeError("Adjustments must be an object.");\n    }\n    const record = input;\n    const result = { ...DEFAULT_ADJUSTMENTS };\n    for (const name of ADJUSTMENT_NAMES) {\n      if (!Object.prototype.hasOwnProperty.call(record, name)) continue;\n      const value = record[name];\n      if (typeof value !== "number" || !Number.isFinite(value)) {\n        throw new TypeError(`Adjustment \'${name}\' must be a finite number.`);\n      }\n      const [minimum, maximum] = ADJUSTMENT_LIMITS[name];\n      if (value < minimum || value > maximum) {\n        throw new RangeError(`Adjustment \'${name}\' must be between ${minimum} and ${maximum}.`);\n      }\n      result[name] = value;\n    }\n    return result;\n  }\n  function hasAdjustments(input) {\n    return ADJUSTMENT_NAMES.some((name) => input[name] !== 0);\n  }\n  function assertDimensions2(width, height) {\n    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {\n      throw new RangeError("Image dimensions must be positive integers.");\n    }\n    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width > Math.floor(MAX_PIXELS / height)) {\n      throw new RangeError("Image dimensions exceed the processing limits.");\n    }\n    return width * height;\n  }\n  function clampByte(value) {\n    return Math.max(0, Math.min(255, value));\n  }\n  function linearToSrgb(value) {\n    const linear = Math.max(0, Math.min(1, value));\n    return linear <= 31308e-7 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;\n  }\n  function sharpenImage(data, width, height, amount) {\n    const rowLength = width * CHANNELS;\n    const rows = new Uint8ClampedArray(rowLength * 3);\n    const copyRow = (sourceY, slot) => {\n      const sourceStart = sourceY * rowLength;\n      rows.set(data.subarray(sourceStart, sourceStart + rowLength), slot * rowLength);\n    };\n    copyRow(0, 0);\n    if (height > 1) copyRow(1, 1);\n    for (let y = 0; y < height; y++) {\n      if (y > 0) copyRow(Math.min(y + 1, height - 1), (y + 1) % 3);\n      const topOffset = Math.max(0, y - 1) % 3 * rowLength;\n      const middleOffset = y % 3 * rowLength;\n      const bottomOffset = Math.min(y + 1, height - 1) % 3 * rowLength;\n      for (let x = 0; x < width; x++) {\n        const target = y * rowLength + x * CHANNELS;\n        const centerAlpha = rows[middleOffset + x * CHANNELS + 3];\n        if (centerAlpha === 0) continue;\n        let weightSum = 0;\n        let redSum = 0;\n        let greenSum = 0;\n        let blueSum = 0;\n        for (let dy = -1; dy <= 1; dy++) {\n          const rowOffset = dy < 0 ? topOffset : dy > 0 ? bottomOffset : middleOffset;\n          const verticalWeight = dy === 0 ? 2 : 1;\n          for (let dx = -1; dx <= 1; dx++) {\n            const sampleX = Math.max(0, Math.min(width - 1, x + dx));\n            const sample = rowOffset + sampleX * CHANNELS;\n            const alpha = rows[sample + 3];\n            if (alpha === 0) continue;\n            const weight = verticalWeight * (dx === 0 ? 2 : 1) * alpha;\n            weightSum += weight;\n            redSum += rows[sample] * weight;\n            greenSum += rows[sample + 1] * weight;\n            blueSum += rows[sample + 2] * weight;\n          }\n        }\n        if (weightSum === 0) continue;\n        data[target] = clampByte(rows[middleOffset + x * CHANNELS] + amount * (rows[middleOffset + x * CHANNELS] - redSum / weightSum));\n        data[target + 1] = clampByte(rows[middleOffset + x * CHANNELS + 1] + amount * (rows[middleOffset + x * CHANNELS + 1] - greenSum / weightSum));\n        data[target + 2] = clampByte(rows[middleOffset + x * CHANNELS + 2] + amount * (rows[middleOffset + x * CHANNELS + 2] - blueSum / weightSum));\n      }\n    }\n  }\n  function applyAdjustments(data, width, height, input = {}) {\n    const pixels = assertDimensions2(width, height);\n    if (!(data instanceof Uint8ClampedArray)) {\n      throw new TypeError("Image data must be a Uint8ClampedArray.");\n    }\n    if (data.length !== pixels * CHANNELS) {\n      throw new RangeError("Image data length does not match its dimensions.");\n    }\n    const adjustments = normalizeAdjustments(input);\n    if (!hasAdjustments(adjustments)) return new Uint8ClampedArray(data);\n    const output = new Uint8ClampedArray(data.length);\n    let exposureLut;\n    if (adjustments.exposure !== 0) {\n      const exposure = 2 ** adjustments.exposure;\n      exposureLut = new Float32Array(256);\n      for (let value = 0; value < exposureLut.length; value++) {\n        exposureLut[value] = linearToSrgb(SRGB_TO_LINEAR[value] * exposure) * 255;\n      }\n    }\n    const brightness = adjustments.brightness / 100;\n    const contrast = 1 + adjustments.contrast / 100;\n    const saturation = 1 + adjustments.saturation / 100;\n    const warmth = adjustments.warmth / 100;\n    const redGain = 1 + warmth * 0.15;\n    const blueGain = 1 - warmth * 0.15;\n    for (let offset = 0; offset < data.length; offset += CHANNELS) {\n      let red = data[offset];\n      let green = data[offset + 1];\n      let blue = data[offset + 2];\n      if (exposureLut) {\n        red = exposureLut[red];\n        green = exposureLut[green];\n        blue = exposureLut[blue];\n      }\n      if (brightness > 0) {\n        red += (255 - red) * brightness;\n        green += (255 - green) * brightness;\n        blue += (255 - blue) * brightness;\n      } else if (brightness < 0) {\n        red *= 1 + brightness;\n        green *= 1 + brightness;\n        blue *= 1 + brightness;\n      }\n      if (adjustments.contrast !== 0) {\n        red = (red - 127.5) * contrast + 127.5;\n        green = (green - 127.5) * contrast + 127.5;\n        blue = (blue - 127.5) * contrast + 127.5;\n      }\n      if (adjustments.saturation !== 0) {\n        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;\n        red = luminance + (red - luminance) * saturation;\n        green = luminance + (green - luminance) * saturation;\n        blue = luminance + (blue - luminance) * saturation;\n      }\n      red = clampByte(red * redGain);\n      green = clampByte(green);\n      blue = clampByte(blue * blueGain);\n      output[offset] = red;\n      output[offset + 1] = green;\n      output[offset + 2] = blue;\n      output[offset + 3] = data[offset + 3];\n    }\n    if (adjustments.sharpen > 0) sharpenImage(output, width, height, adjustments.sharpen / 100);\n    return output;\n  }\n\n  // src/processing-worker.ts\n  function isRecord(value) {\n    return typeof value === "object" && value !== null;\n  }\n  function handleMessage(event, scope) {\n    const raw = event.data;\n    const id = isRecord(raw) && Number.isSafeInteger(raw.id) ? raw.id : -1;\n    try {\n      if (!isRecord(raw)) throw new TypeError("Invalid processing request.");\n      const request = raw;\n      if (!(request.data instanceof ArrayBuffer)) throw new TypeError("Request data must be an ArrayBuffer.");\n      if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {\n        throw new RangeError("Image dimensions must be positive integers.");\n      }\n      if (request.width > MAX_DIMENSION || request.height > MAX_DIMENSION || request.width > Math.floor(MAX_PIXELS / request.height)) {\n        throw new RangeError("Image dimensions exceed the processing limits.");\n      }\n      const expectedLength = request.width * request.height * 4;\n      if (request.data.byteLength !== expectedLength) throw new RangeError("Image data length does not match its dimensions.");\n      let data = new Uint8ClampedArray(request.data);\n      let width = request.width;\n      let height = request.height;\n      let didWork = false;\n      if (request.corners !== void 0) {\n        let outputSize;\n        if (request.outWidth === void 0 && request.outHeight === void 0) {\n          outputSize = estimateRectifiedSize(request.corners);\n        } else {\n          if (request.outWidth === void 0 || request.outHeight === void 0) {\n            throw new RangeError("Both output dimensions must be provided.");\n          }\n          outputSize = { width: request.outWidth, height: request.outHeight };\n        }\n        data = rectifyImage(data, width, height, request.corners, outputSize.width, outputSize.height);\n        width = outputSize.width;\n        height = outputSize.height;\n        didWork = true;\n      } else if (request.outWidth !== void 0 || request.outHeight !== void 0) {\n        throw new RangeError("Output dimensions require perspective corners.");\n      }\n      if (request.mode !== void 0) {\n        data = enhanceBoard(data, width, height, request.mode, request.strength ?? 1);\n        didWork = true;\n      } else if (request.strength !== void 0) {\n        throw new RangeError("Enhancement strength requires a board mode.");\n      }\n      if (request.adjustments !== void 0) {\n        data = applyAdjustments(data, width, height, request.adjustments);\n        didWork = true;\n      }\n      if (!didWork) throw new TypeError("Request must specify perspective correction, board enhancement or image adjustments.");\n      const response = { id, data: data.buffer, width, height };\n      scope.postMessage(response, [response.data]);\n    } catch (error) {\n      const response = {\n        id,\n        error: error instanceof Error ? error.message : "Image processing failed."\n      };\n      scope.postMessage(response);\n    }\n  }\n  var workerScope = globalThis;\n  if (typeof document === "undefined" && typeof workerScope.addEventListener === "function" && typeof workerScope.postMessage === "function") {\n    workerScope.addEventListener("message", (event) => handleMessage(event, workerScope));\n  }\n})();\n';

// src/backup-dialog.ts
var import_obsidian = require("obsidian");

// src/insertion-paths.ts
var DEFAULT_INSERTION_PREFERENCES = {
  manageInsertedImages: false,
  imageFolder: "_Asset/",
  renameInsertedImages: false,
  imageNameTemplate: "<original-name>-YYYY-MM-DD.<suffix>"
};
var unsafe = /[\u0000-\u001f\u007f-\u009f:*?"<>|]/;
var imageExtensions = /^(avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;
var mimeExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico"
};
function isInsertedImage(file) {
  const dot = file.name.lastIndexOf(".");
  return file.type.startsWith("image/") || dot >= 0 && imageExtensions.test(file.name.slice(dot + 1));
}
function normalizeImageFolder(folder) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(folder)) throw new Error("Image folder cannot contain control characters.");
  const value = folder.trim().replace(/\\/g, "/");
  if (value === "/") return "/";
  if (!value || unsafe.test(value) || value.startsWith("/")) {
    throw new Error("Image folder must be ./, /, or a relative folder such as _Asset/.");
  }
  const relativeToNote = value === "." || value.startsWith("./");
  const parts = value.split("/").map((part) => part.trim()).filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || /[. ]$/.test(part))) {
    throw new Error("Image folder cannot contain '..' or names ending with a dot or space.");
  }
  if (!parts.length) return "./";
  return `${relativeToNote ? "./" : ""}${parts.join("/")}/`;
}
function imageDestinationFolder(folder, notePath) {
  const normalized = normalizeImageFolder(folder);
  if (normalized === "/") return "";
  if (!normalized.startsWith("./")) return normalized.slice(0, -1);
  const parent = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  return [parent, normalized.slice(2, -1)].filter(Boolean).join("/");
}
function normalizeImageNameTemplate(template) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(template)) throw new Error("Filename template cannot contain control characters.");
  const value = template.trim();
  if (!value.endsWith(".<suffix>")) throw new Error("Filename template must end with .<suffix> to preserve the image format.");
  const literal = value.replace(/<original-name>|<note-name>|<suffix>/g, "image");
  if (unsafe.test(literal) || /[/\\]/.test(literal) || !value.slice(0, -9).replace(/[. ]/g, "")) {
    throw new Error("Filename template contains unsupported characters or placeholders.");
  }
  if (value.indexOf("<suffix>") !== value.length - 8) throw new Error("Use <suffix> only at the end of the template.");
  return value;
}
function safeBasename(name) {
  return name.replace(/[\u0000-\u001f\u007f-\u009f/\\:*?"<>|#\[\]]/g, "-").replace(/^[. ]+|[. ]+$/g, "") || "image";
}
function insertedImageName(file, notePath, preferences, date = /* @__PURE__ */ new Date()) {
  const filename = file.name.split(/[/\\]/).pop() || "image";
  const dot = filename.lastIndexOf(".");
  const hasExtension = dot > 0 && /^[a-z0-9]+$/i.test(filename.slice(dot + 1));
  const suffix = hasExtension ? filename.slice(dot + 1) : mimeExtensions[file.type.toLowerCase()];
  if (!suffix) throw new Error(`Cannot determine the image extension for '${filename}'.`);
  const original = safeBasename(hasExtension ? filename.slice(0, dot) : filename);
  if (!preferences.renameInsertedImages) return `${original}.${suffix}`;
  const template = normalizeImageNameTemplate(preferences.imageNameTemplate);
  const pad = (value) => String(value).padStart(2, "0");
  const values = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  };
  const noteName = notePath.split("/").pop().replace(/\.md$/i, "");
  const dated = template.slice(0, -9).replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token]);
  const basename = dated.replace(/<original-name>|<note-name>/g, (token) => token === "<original-name>" ? original : safeBasename(noteName));
  return `${safeBasename(basename)}.${suffix}`;
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  ...DEFAULT_INSERTION_PREFERENCES,
  quality: 85,
  backupEnabled: false,
  backupConfigured: false,
  backupFolder: "Image Toolkit Backups"
};
function loadSettings(saved, defaultManageInsertedImages = DEFAULT_SETTINGS.manageInsertedImages) {
  const record = typeof saved === "object" && saved !== null && !Array.isArray(saved) ? saved : {};
  const hasConfigurationMarker = typeof record.backupConfigured === "boolean";
  const validated = (key, validate, fallback) => {
    try {
      return typeof record[key] === "string" ? validate(record[key]) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    manageInsertedImages: typeof record.manageInsertedImages === "boolean" ? record.manageInsertedImages : defaultManageInsertedImages,
    imageFolder: validated("imageFolder", normalizeImageFolder, DEFAULT_SETTINGS.imageFolder),
    renameInsertedImages: record.renameInsertedImages === true,
    imageNameTemplate: validated("imageNameTemplate", normalizeImageNameTemplate, DEFAULT_SETTINGS.imageNameTemplate),
    quality: typeof record.quality === "number" && Number.isFinite(record.quality) ? Math.max(10, Math.min(100, record.quality)) : DEFAULT_SETTINGS.quality,
    backupEnabled: hasConfigurationMarker && typeof record.backupEnabled === "boolean" ? record.backupEnabled : false,
    backupConfigured: hasConfigurationMarker ? record.backupConfigured : false,
    backupFolder: typeof record.backupFolder === "string" ? record.backupFolder : DEFAULT_SETTINGS.backupFolder
  };
}

// src/backup-dialog.ts
var BackupPrompt = class extends import_obsidian.Modal {
  constructor(app, current, onResult) {
    super(app);
    this.current = current;
    this.result = null;
    this.completed = false;
    this.submitting = false;
    this.onResult = onResult;
  }
  onOpen() {
    this.modalEl.addClass("image-toolkit-backup-prompt");
    this.titleEl.setText("Back up images before saving?");
    this.contentEl.empty();
    const form = this.contentEl.createEl("form", { cls: "image-toolkit-backup-prompt-form" });
    const backupLabel = form.createEl("label", { cls: "image-toolkit-backup-prompt-option" });
    const backupCheckbox = backupLabel.createEl("input", { type: "checkbox" });
    backupCheckbox.checked = this.current.backupEnabled === true;
    backupLabel.createSpan({ text: "Back up before overwriting" });
    const folderLabel = form.createEl("label", { cls: "image-toolkit-backup-prompt-folder" });
    folderLabel.createSpan({ text: "Backup folder" });
    const folderInput = folderLabel.createEl("input", {
      type: "text",
      value: this.current.backupFolder,
      attr: { "aria-label": "Backup folder" }
    });
    folderInput.disabled = !backupCheckbox.checked;
    const warning = form.createEl("p", { cls: "image-toolkit-backup-prompt-warning" });
    warning.setText("Saving will replace the source image. Your decision will be remembered.");
    const validationError = form.createEl("p", {
      cls: "image-toolkit-backup-prompt-error",
      attr: { role: "alert" }
    });
    validationError.hidden = true;
    const actions = form.createDiv("image-toolkit-backup-prompt-actions");
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    const submit = actions.createEl("button", { text: "Continue & save", attr: { type: "submit" } });
    submit.addClass("mod-cta");
    backupCheckbox.addEventListener("change", () => {
      folderInput.disabled = !backupCheckbox.checked;
      validationError.hidden = true;
      validationError.setText("");
    });
    folderInput.addEventListener("input", () => {
      validationError.hidden = true;
      validationError.setText("");
    });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitChoice(backupCheckbox, folderInput, validationError);
    });
  }
  onClose() {
    this.finish(this.result);
  }
  submitChoice(backupCheckbox, folderInput, validationError) {
    if (this.completed || this.submitting) return;
    this.submitting = true;
    validationError.hidden = true;
    let choice;
    try {
      const backupEnabled = backupCheckbox.checked;
      const enteredFolder = folderInput.value;
      const backupFolder = backupEnabled ? normalizeBackupFolder(enteredFolder) : enteredFolder.trim().length > 0 ? enteredFolder : DEFAULT_SETTINGS.backupFolder;
      choice = { backupEnabled, backupFolder };
    } catch (error) {
      this.submitting = false;
      validationError.setText(error instanceof Error ? error.message : String(error));
      validationError.hidden = false;
      return;
    }
    this.result = choice;
    this.close();
  }
  finish(result) {
    if (this.completed) return;
    this.completed = true;
    this.onResult(result);
  }
};

// src/annotations.ts
var CORNERS = ["nw", "ne", "se", "sw"];
function markBounds(mark, measureText) {
  if (mark.kind === "text") {
    const point = mark.points[0] ?? { x: 0, y: 0 };
    const fontSize = mark.width;
    return {
      x: point.x,
      y: point.y,
      w: measureText(mark.text ?? "", fontSize) * (mark.textScaleX ?? 1),
      h: fontSize * 1.2
    };
  }
  if (mark.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let left = mark.points[0].x;
  let top = mark.points[0].y;
  let right = left;
  let bottom = top;
  for (const point of mark.points.slice(1)) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
function moveMark(mark, dx, dy) {
  return {
    ...mark,
    points: mark.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
  };
}
function resizeBounds(bounds, corner, point, minSize = 2) {
  const minimum = Number.isFinite(minSize) ? Math.max(0, minSize) : 2;
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  const px = Number.isFinite(point.x) ? point.x : left;
  const py = Number.isFinite(point.y) ? point.y : top;
  switch (corner) {
    case "nw": {
      const x = Math.min(px, right - minimum);
      const y = Math.min(py, bottom - minimum);
      return { x, y, w: right - x, h: bottom - y };
    }
    case "ne": {
      const x = Math.max(px, left + minimum);
      const y = Math.min(py, bottom - minimum);
      return { x: left, y, w: x - left, h: bottom - y };
    }
    case "se": {
      const x = Math.max(px, left + minimum);
      const y = Math.max(py, top + minimum);
      return { x: left, y: top, w: x - left, h: y - top };
    }
    case "sw": {
      const x = Math.min(px, right - minimum);
      const y = Math.max(py, top + minimum);
      return { x, y: top, w: right - x, h: y - top };
    }
  }
}
function scaleCoordinate(value, fromStart, fromSize, toStart, toSize) {
  const fraction = fromSize === 0 ? 0 : (value - fromStart) / fromSize;
  return toStart + fraction * toSize;
}
function scaleRatio(toSize, fromSize) {
  return fromSize === 0 ? 1 : toSize / fromSize;
}
function resizeMark(mark, from, to) {
  const points = mark.points.map((point) => ({
    x: scaleCoordinate(point.x, from.x, from.w, to.x, to.w),
    y: scaleCoordinate(point.y, from.y, from.h, to.y, to.h)
  }));
  if (mark.kind !== "text") return { ...mark, points };
  const heightScale = scaleRatio(to.h, from.h);
  const widthScale = scaleRatio(to.w, from.w);
  const textScaleX = (mark.textScaleX ?? 1) * scaleRatio(widthScale, heightScale);
  return { ...mark, points, width: mark.width * heightScale, textScaleX };
}
function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}
function distanceToPath(point, points) {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}
function distanceToEllipse(point, first, last) {
  const centerX = (first.x + last.x) / 2;
  const centerY = (first.y + last.y) / 2;
  const radiusX = Math.abs(last.x - first.x) / 2;
  const radiusY = Math.abs(last.y - first.y) / 2;
  const dx = Math.abs(point.x - centerX);
  const dy = Math.abs(point.y - centerY);
  if (radiusX === 0 && radiusY === 0) return Math.hypot(dx, dy);
  if (radiusX === 0) return distanceToSegment(point, { x: centerX, y: centerY - radiusY }, { x: centerX, y: centerY + radiusY });
  if (radiusY === 0) return distanceToSegment(point, { x: centerX - radiusX, y: centerY }, { x: centerX + radiusX, y: centerY });
  const distanceSquaredAt = (angle) => {
    const x = radiusX * Math.cos(angle) - dx;
    const y = radiusY * Math.sin(angle) - dy;
    return x * x + y * y;
  };
  const derivative = (angle) => {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return (radiusY * radiusY - radiusX * radiusX) * sin * cos + radiusX * dx * sin - radiusY * dy * cos;
  };
  const end = Math.PI / 2;
  const samples = 128;
  let bestSquared = Math.min(distanceSquaredAt(0), distanceSquaredAt(end));
  let previousAngle = 0;
  let previousDerivative = derivative(previousAngle);
  for (let index = 1; index <= samples; index++) {
    const angle = end * index / samples;
    const currentDerivative = derivative(angle);
    bestSquared = Math.min(bestSquared, distanceSquaredAt(angle));
    if (previousDerivative === 0) bestSquared = Math.min(bestSquared, distanceSquaredAt(previousAngle));
    if (previousDerivative < 0 && currentDerivative > 0 || previousDerivative > 0 && currentDerivative < 0) {
      let low = previousAngle;
      let high = angle;
      let lowDerivative = previousDerivative;
      for (let iteration = 0; iteration < 48; iteration++) {
        const middle = (low + high) / 2;
        const middleDerivative = derivative(middle);
        if (middleDerivative === 0) {
          low = middle;
          high = middle;
          break;
        }
        if (lowDerivative < 0 && middleDerivative > 0 || lowDerivative > 0 && middleDerivative < 0) {
          high = middle;
        } else {
          low = middle;
          lowDerivative = middleDerivative;
        }
      }
      bestSquared = Math.min(bestSquared, distanceSquaredAt((low + high) / 2));
    }
    previousAngle = angle;
    previousDerivative = currentDerivative;
  }
  return Math.sqrt(bestSquared);
}
function distanceToRectangle(point, first, last) {
  const left = Math.min(first.x, last.x);
  const right = Math.max(first.x, last.x);
  const top = Math.min(first.y, last.y);
  const bottom = Math.max(first.y, last.y);
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
  return Math.min(...corners.map((corner, index) => distanceToSegment(point, corner, corners[(index + 1) % corners.length])));
}
function hitTestMark(mark, point, tolerance, measureText) {
  if (mark.points.length === 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (mark.kind === "text") {
    const bounds = markBounds(mark, measureText);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h;
  }
  const strokeWidth = Number.isFinite(mark.width) ? Math.abs(mark.width) : 0;
  const hitRadius = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0) + strokeWidth * (mark.kind === "highlighter" ? 3 : 1) / 2;
  let distance;
  if (mark.kind === "rectangle") {
    distance = distanceToRectangle(point, mark.points[0], mark.points[mark.points.length - 1]);
  } else if (mark.kind === "ellipse") {
    distance = distanceToEllipse(point, mark.points[0], mark.points[mark.points.length - 1]);
  } else {
    distance = distanceToPath(point, mark.points);
    if (mark.kind === "arrow" && mark.points.length >= 2) {
      const start = mark.points[0];
      const end = mark.points[mark.points.length - 1];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(12, strokeWidth * 4);
      const first = { x: end.x - length * Math.cos(angle - 0.5), y: end.y - length * Math.sin(angle - 0.5) };
      const second = { x: end.x - length * Math.cos(angle + 0.5), y: end.y - length * Math.sin(angle + 0.5) };
      distance = Math.min(distance, distanceToSegment(point, first, end), distanceToSegment(point, end, second));
    }
  }
  return distance <= hitRadius;
}
function selectionHandles(mark, bounds) {
  if (mark.kind === "arrow") {
    if (mark.points.length === 0) return [];
    return [
      { id: "start", point: { ...mark.points[0] } },
      { id: "end", point: { ...mark.points[mark.points.length - 1] } }
    ];
  }
  const points = {
    nw: { x: bounds.x, y: bounds.y },
    ne: { x: bounds.x + bounds.w, y: bounds.y },
    se: { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    sw: { x: bounds.x, y: bounds.y + bounds.h }
  };
  return CORNERS.map((id) => ({ id, point: points[id] }));
}

// src/editor.ts
var clone = (value) => JSON.parse(JSON.stringify(value));
var clamp = (n, low, high) => Math.max(low, Math.min(high, n));
var canvas = (width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new Error("Image exceeds limits: 32 megapixels and 8192 pixels per side. Resize the original externally first.");
  const c = document.createElement("canvas");
  c.width = Math.round(width);
  c.height = Math.round(height);
  return c;
};
var ctx = (c) => {
  const context = c.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  return context;
};
var encode = (c, type = "image/png", quality) => new Promise((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error("Image encoding failed.")), type, quality));
async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const out = canvas(img.naturalWidth, img.naturalHeight);
    ctx(out).drawImage(img, 0, 0);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
var ImageEditor = class extends import_obsidian2.Modal {
  constructor(app, file, options, didClose) {
    super(app);
    this.file = file;
    this.options = options;
    this.didClose = didClose;
    this.mode = "rectangle";
    this.corners = [];
    this.activeCorner = 0;
    this.strength = 0;
    this.boardBackground = "white";
    this.marks = [];
    this.markTool = "pen";
    this.selected = -1;
    this.color = "#e53935";
    this.lineWidth = 5;
    this.fontSize = 32;
    this.history = [];
    this.historyIndex = -1;
    this.busy = false;
    this.closed = false;
    this.adjustments = { ...DEFAULT_ADJUSTMENTS };
    this.zoom = 100;
    this.workerSequence = 0;
    this.jobs = /* @__PURE__ */ new Map();
    this.previewRunning = false;
    this.estimating = false;
    this.estimateAgain = false;
    this.previewVersion = 0;
    this.sizeVersion = 0;
    this.boardWidth = 0;
    this.boardHeight = 0;
    this.childModals = /* @__PURE__ */ new Set();
    this.measureText = (text, fontSize) => {
      const context = ctx(this.working);
      context.font = `${fontSize}px sans-serif`;
      return context.measureText(text).width;
    };
    this.tool = options.tool;
    this.quality = clamp(Number(options.quality) || 85, 10, 100);
    this.format = file.extension.toLowerCase() === "jpeg" ? "jpg" : file.extension.toLowerCase();
  }
  async onOpen() {
    this.modalEl.addClass("image-toolkit-modal");
    this.titleEl.setText(`Image Toolkit \u2014 ${this.file.name}`);
    this.titleEl.addClass("image-toolkit-title");
    this.titleEl.title = this.file.path;
    this.contentEl.createEl("p", { text: "Loading image\u2026" });
    try {
      this.original = await this.app.vault.readBinary(this.file);
      if (this.original.byteLength > 80 * 1024 * 1024) throw new Error("Input exceeds the 80 MB safety limit.");
      assertStaticImage(this.original, this.file.extension.toLowerCase());
      this.working = await decode(new Blob([this.original]));
      if (this.closed) return;
      this.resetCorners();
      await this.checkpoint();
      this.build();
      this.draw();
      this.refreshOutputSize();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: String(error), cls: "image-toolkit-error" });
    }
  }
  onClose() {
    this.closed = true;
    for (const modal of this.childModals) modal.close();
    this.childModals.clear();
    window.clearTimeout(this.previewTimer);
    window.clearTimeout(this.estimateTimer);
    this.resizeObserver?.disconnect();
    this.encodedPreview?.close();
    this.encodedPreview = void 0;
    this.stopWorker(new Error("Editor closed."));
    this.history = [];
    this.marks = [];
    this.didClose();
  }
  button(parent, text, action, primary = false) {
    const b = parent.createEl("button", { text });
    if (primary) b.addClass("mod-cta");
    b.addEventListener("click", () => {
      if (!this.busy) void this.run(action);
    });
    return b;
  }
  async run(action) {
    try {
      await action();
    } catch (e) {
      if (!this.closed) {
        new import_obsidian2.Notice(String(e));
        this.status?.setText(String(e));
      }
    }
  }
  async exclusive(action) {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.modalEl.addClass("image-toolkit-busy");
    this.setEnabled(false);
    try {
      await action();
    } finally {
      this.busy = false;
      this.modalEl.removeClass("image-toolkit-busy");
      this.setEnabled(true);
    }
  }
  setEnabled(enabled) {
    this.contentEl.querySelectorAll("input,button,select,textarea").forEach((el) => {
      el.disabled = !enabled;
    });
  }
  build() {
    this.contentEl.empty();
    const toolbar = this.contentEl.createDiv("image-toolkit-toolbar");
    const tabs = toolbar.createDiv("image-toolkit-tool-tabs");
    for (const [id, title] of [["compress", "Compress"], ["resize", "Resize"], ["crop", "Crop / board"], ["adjust", "Adjust"], ["annotate", "Annotate"]]) {
      const b = this.button(tabs, title, () => this.selectTool(id));
      b.dataset.tool = id;
    }
    const history = toolbar.createDiv("image-toolkit-history");
    this.button(history, "Undo", () => this.restore(-1));
    this.button(history, "Redo", () => this.restore(1));
    this.button(history, "Reset", () => this.exclusive(async () => {
      this.adjustments = { ...DEFAULT_ADJUSTMENTS };
      ++this.sizeVersion;
      window.clearTimeout(this.estimateTimer);
      this.invalidateEncodedPreview();
      this.working = await decode(new Blob([this.original]));
      this.marks = [];
      this.resetCorners();
      await this.checkpoint();
      this.renderControls();
      this.draw();
      this.refreshOutputSize();
    }));
    this.button(history, "Compare", () => this.compare()).title = "Before / after with the current quality";
    this.layout = this.contentEl.createDiv("image-toolkit-layout");
    const viewport = this.layout.createDiv("image-toolkit-viewport");
    const zoomBar = viewport.createDiv("image-toolkit-zoom");
    this.range(zoomBar, "Zoom", 25, 300, this.zoom, 5, (value) => {
      this.zoom = value;
      this.draw();
    }).title = "100% fits both dimensions; scroll to pan above 100%";
    this.previewCaption = zoomBar.createDiv("image-toolkit-preview-caption");
    this.scroll = viewport.createDiv("image-toolkit-scroll");
    const stage = this.scroll.createDiv("image-toolkit-stage");
    this.preview = stage.createEl("canvas", { attr: { tabindex: "0", "aria-label": "Image editing canvas. Drag crop handles; arrow keys nudge the selected corner." } });
    this.preview.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.preview.addEventListener("pointermove", (e) => this.pointerMove(e));
    this.preview.addEventListener("pointerup", () => this.pointerUp());
    this.preview.addEventListener("pointercancel", () => this.pointerUp());
    this.preview.addEventListener("keydown", (e) => {
      if (this.busy) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void this.run(() => this.restore(e.shiftKey ? 1 : -1));
      }
      if (this.tool === "annotate" && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        void this.run(() => this.removeSelected());
      }
      if (this.tool === "crop" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const p = this.corners[this.activeCorner], d = e.shiftKey ? 10 : 1;
        p.x = clamp(p.x + (e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0), 0, this.working.width - 1);
        p.y = clamp(p.y + (e.key === "ArrowDown" ? d : e.key === "ArrowUp" ? -d : 0), 0, this.working.height - 1);
        if (this.mode === "rectangle") this.rectangleFromCorner(this.activeCorner);
        this.draw();
        this.scheduleBoardPreview();
      }
    });
    const sidebar = this.layout.createDiv("image-toolkit-sidebar");
    this.controls = sidebar.createDiv("image-toolkit-controls");
    this.toolActions = sidebar.createDiv("image-toolkit-tool-actions");
    const footer = this.contentEl.createDiv("image-toolkit-footer");
    const exportInfo = footer.createDiv("image-toolkit-export-info");
    const exportBar = exportInfo.createDiv("image-toolkit-export-bar");
    exportBar.createSpan({ text: this.format.toUpperCase(), cls: "image-toolkit-format" }).title = `Original format preserved: ${this.file.path}`;
    if (this.format !== "png") this.range(exportBar, "Quality", 10, 100, this.quality, 1, (value) => {
      this.quality = value;
      this.refreshOutputSize();
    }).title = "Encoded preview updates after 300 ms";
    this.outputInfo = exportBar.createSpan({ cls: "image-toolkit-output-info" });
    this.status = exportInfo.createDiv("image-toolkit-status");
    this.status.setAttribute("role", "status");
    this.status.setText(`Original ${this.bytes(this.original.byteLength)} \xB7 replaces original \xB7 backup ${this.options.backupEnabled ? "on" : "off"}`);
    this.status.title = `Apply crop/resize before saving. Pending photo adjustments are included automatically. All notes using this image are affected. ${this.options.backupEnabled ? `Backups: ${this.options.backupFolder}` : "Backups disabled in plugin settings."}`;
    const saveActions = footer.createDiv("image-toolkit-save-actions");
    this.button(saveActions, "Cancel", () => this.close());
    this.button(saveActions, "Save image", () => this.save(), true).title = `Replace ${this.file.path}. ${this.options.backupEnabled ? `Back up to ${this.options.backupFolder} first.` : "Backups are disabled."}`;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.scroll);
    this.renderControls();
  }
  label(parent, text) {
    return parent.createEl("label", { text, cls: "image-toolkit-field" });
  }
  number(parent, label, value, onChange, min = 1, max = MAX_DIMENSION) {
    const field = this.label(parent, label);
    const input = field.createEl("input", { type: "number", value: String(value), attr: { min: String(min), max: String(max), step: "1" } });
    input.addEventListener("input", () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n));
    });
    return input;
  }
  range(parent, text, min, max, value, step, change) {
    const suffix = text === "Zoom" ? "%" : "";
    const label = this.label(parent, `${text}: ${value}${suffix}`);
    const title = label.firstChild;
    const input = label.createEl("input", { type: "range", value: String(value), attr: { min: String(min), max: String(max), step: String(step) } });
    input.addEventListener("input", () => {
      title.textContent = `${text}: ${input.value}${suffix}`;
      change(Number(input.value));
    });
    return input;
  }
  check(parent, text, value, change) {
    const label = this.label(parent, text);
    const input = label.createEl("input", { type: "checkbox" });
    input.checked = value;
    input.addEventListener("change", () => change(input.checked));
    return input;
  }
  select(parent, label, values, value, change) {
    const field = this.label(parent, label), select = field.createEl("select");
    for (const [key, text] of Object.entries(values)) select.createEl("option", { text, value: key });
    select.value = value;
    select.addEventListener("change", () => change(select.value));
    return select;
  }
  details(parent, title, open = false) {
    const details = parent.createEl("details", { cls: "image-toolkit-details" });
    details.open = open;
    details.createEl("summary", { text: title });
    return details.createDiv();
  }
  renderControls() {
    if (!this.controls) return;
    this.controls.empty();
    this.controls.removeAttribute("title");
    this.toolActions.empty();
    this.boardPreview = void 0;
    this.magnifier = void 0;
    this.layout.toggleClass("image-toolkit-image-only", this.tool === "compress");
    this.contentEl.querySelectorAll("[data-tool]").forEach((el) => {
      el.toggleClass("is-active", el.dataset.tool === this.tool);
      el.setAttribute("aria-pressed", String(el.dataset.tool === this.tool));
    });
    if (this.tool === "resize") this.resizeControls();
    if (this.tool === "crop") this.cropControls();
    if (this.tool === "annotate") this.annotationControls();
    if (this.tool === "adjust") this.adjustmentControls();
    if (this.busy) this.setEnabled(false);
  }
  async selectTool(tool) {
    if (tool !== this.tool && hasAdjustments(this.adjustments)) await this.applyAdjustments();
    if (this.closed || this.busy) return;
    this.tool = tool;
    this.selected = -1;
    this.renderControls();
    this.draw();
  }
  adjustmentControls() {
    const controls = [
      ["exposure", "Exposure", -3, 3, 0.1, "Exposure in EV (stops)."],
      ["brightness", "Brightness", -100, 100, 1, "Lift or darken overall brightness."],
      ["contrast", "Contrast", -100, 100, 1, "Increase or soften midtone contrast."],
      ["saturation", "Saturation", -100, 100, 1, "-100 removes color; 0 preserves it."],
      ["warmth", "Warmth", -100, 100, 1, "Cooler blues to warmer reds."],
      ["sharpen", "Sharpen", 0, 100, 1, "Strengthen fine edges. Cannot recover lost focus."]
    ];
    for (const [key, label, min, max, step, help] of controls) {
      const input = this.range(this.controls, label, min, max, this.adjustments[key], step, (value) => {
        this.adjustments = { ...this.adjustments, [key]: value };
        this.refreshOutputSize();
      });
      input.dataset.adjustment = key;
      input.title = help;
    }
    this.controls.createDiv({ text: "Live preview \xB7 undoable on Apply", cls: "image-toolkit-hint" }).title = "Apply commits one history step. Switching tools or saving also applies pending adjustments. Undo first clears an unapplied preview.";
    const actions = this.toolActions.createDiv("image-toolkit-adjustment-actions");
    this.button(actions, "Reset sliders", () => {
      this.adjustments = { ...DEFAULT_ADJUSTMENTS };
      this.renderControls();
      this.refreshOutputSize();
    });
    this.button(actions, "Apply", () => this.applyAdjustments(), true).setAttribute("aria-label", "Apply adjustments");
  }
  applyAdjustments() {
    return this.exclusive(() => this.applyAdjustmentRaster());
  }
  async applyAdjustmentRaster() {
    if (!hasAdjustments(this.adjustments)) return;
    this.status.setText("Applying adjustments\u2026");
    const out = await this.adjustedRaster();
    if (this.closed) return;
    await this.replaceRaster(out);
  }
  resizeControls() {
    let width = this.working.width, height = this.working.height, lock = true, upscale = false;
    const ratio = width / height;
    let wi, hi;
    wi = this.number(this.controls, "Width (px)", width, (v) => {
      width = v;
      if (lock) {
        height = Math.max(1, Math.round(width / ratio));
        hi.value = String(height);
      }
    });
    hi = this.number(this.controls, "Height (px)", height, (v) => {
      height = v;
      if (lock) {
        width = Math.max(1, Math.round(height * ratio));
        wi.value = String(width);
      }
    });
    this.number(this.controls, "Scale (%)", 100, (v) => {
      width = Math.max(1, Math.round(this.working.width * v / 100));
      height = Math.max(1, Math.round(this.working.height * v / 100));
      wi.value = String(width);
      hi.value = String(height);
    }, 1, 500);
    this.check(this.controls, "Lock aspect ratio", lock, (v) => {
      lock = v;
    });
    this.check(this.controls, "Allow enlargement", upscale, (v) => {
      upscale = v;
    });
    this.button(this.toolActions, "Apply resize", () => this.exclusive(async () => {
      width = Number(wi.value);
      height = Number(hi.value);
      if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("Use whole-pixel dimensions.");
      if (!upscale && (width > this.working.width || height > this.working.height)) throw new Error("Enable enlargement to upscale.");
      const out = canvas(width, height), c = ctx(out);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(this.composite(), 0, 0, width, height);
      await this.replaceRaster(out);
    }), true);
  }
  cropControls() {
    let inspectors = this.controls;
    this.select(this.controls, "Mode", { rectangle: "Rectangle crop", board: "Board" }, this.mode, (v) => {
      this.mode = v;
      this.renderControls();
      this.draw();
    }).title = "Drag to draw a rectangle, then refine corners. Arrow keys nudge; Apply commits the crop.";
    this.controls.createDiv({ text: "Drag to select \xB7 refine corners", cls: "image-toolkit-hint" }).title = "Drag away from a handle to draw a rectangle. Drag handles independently in Board mode. Arrow keys: 1px; Shift+arrow: 10px. Apply before Save.";
    if (this.mode === "rectangle") {
      this.select(this.controls, "Aspect preset", { free: "Free", square: "1:1", landscape: "4:3", wide: "16:9", portrait: "3:4" }, "free", (v) => {
        const ratio = { square: 1, landscape: 4 / 3, wide: 16 / 9, portrait: 3 / 4 }[v];
        if (!ratio) return;
        let w = this.working.width - 1, h = w / ratio;
        if (h > this.working.height - 1) {
          h = this.working.height - 1;
          w = h * ratio;
        }
        const x = (this.working.width - 1 - w) / 2, y = (this.working.height - 1 - h) / 2;
        this.corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
        this.draw();
      });
      this.controls.title = "Aspect presets start a centered crop; subsequent dragging remains freeform.";
    } else {
      const background = this.select(this.controls, "Background", { white: "White", black: "Black" }, this.boardBackground, (v) => {
        this.boardBackground = v;
        this.scheduleBoardPreview();
      });
      background.setAttribute("aria-label", "Board background");
      background.title = "White: dark writing. Black: light writing.";
      this.range(this.controls, "Enhance", 0, 100, Math.round(this.strength * 100), 1, (v) => {
        this.strength = v / 100;
        this.scheduleBoardPreview();
      }).title = "0 leaves the rectified image unchanged; higher values clean the background and strengthen writing.";
      inspectors = this.controls.createDiv("image-toolkit-crop-previews");
      const board = inspectors.createDiv();
      board.createDiv({ text: "Board preview", cls: "image-toolkit-inspector-label" });
      this.boardPreview = board.createEl("canvas", { cls: "image-toolkit-board-preview", attr: { "aria-label": "Rectified board preview" } });
      this.scheduleBoardPreview();
    }
    const precision = this.details(inspectors, "Corner precision", true);
    this.magnifier = precision.createEl("canvas", { cls: "image-toolkit-magnifier", attr: { "aria-label": "Selected corner magnifier" } });
    this.magnifier.width = 160;
    this.magnifier.height = 120;
    if (this.mode === "board") {
      const output = this.details(this.controls, "Output size");
      this.number(output, "Width", this.boardWidth, (value) => {
        this.boardWidth = value;
        this.scheduleBoardPreview();
      }, 0).title = "Output pixels; 0 = automatic. Set one dimension to preserve the estimated ratio.";
      this.number(output, "Height", this.boardHeight, (value) => {
        this.boardHeight = value;
        this.scheduleBoardPreview();
      }, 0).title = "Output pixels; 0 = automatic.";
    }
    const cropActions = this.toolActions.createDiv("image-toolkit-crop-actions");
    this.button(cropActions, "Reset corners", () => {
      this.resetCorners();
      this.draw();
      this.scheduleBoardPreview();
    });
    this.button(cropActions, "Apply crop", () => this.exclusive(() => this.applyCrop()), true).setAttribute("aria-label", "Apply crop / board correction");
    const transforms = this.toolActions.createDiv("image-toolkit-transform");
    const actions = [["\u21B6", "left", "Rotate left 90\xB0"], ["\u21B7", "right", "Rotate right 90\xB0"], ["\u2194", "horizontal", "Flip horizontally"], ["\u2195", "vertical", "Flip vertically"]];
    for (const [icon, kind, label] of actions) {
      const button = this.button(transforms, icon, () => this.transform(kind));
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }
  annotationControls() {
    const tools = this.controls.createDiv("image-toolkit-annotation-tools");
    tools.setAttribute("role", "group");
    tools.setAttribute("aria-label", "Annotation tools");
    const choices = [["select", "mouse-pointer-2", "Select / move"], ["pen", "pencil", "Pen"], ["highlighter", "highlighter", "Highlighter"], ["arrow", "move-up-right", "Arrow"], ["rectangle", "square", "Rectangle"], ["ellipse", "circle", "Ellipse"], ["text", "type", "Text"]];
    for (const [kind, icon, label] of choices) {
      const button = this.button(tools, "", () => {
        this.markTool = kind;
        this.selected = -1;
        this.renderControls();
        this.draw();
      });
      (0, import_obsidian2.setIcon)(button, icon);
      button.dataset.annotationTool = kind;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(this.markTool === kind));
      button.toggleClass("is-active", this.markTool === kind);
    }
    const mark = this.markTool === "select" ? this.marks[this.selected] : void 0;
    const changed = () => {
      if (mark) this.refreshOutputSize();
    };
    const commit = () => {
      if (mark) void this.run(() => this.exclusive(async () => {
        await this.checkpoint();
        this.refreshOutputSize();
      }));
    };
    const color = this.label(this.controls, "Color").createEl("input", { type: "color", value: mark?.color || this.color });
    color.addEventListener("input", () => {
      this.color = color.value;
      if (mark) mark.color = color.value;
      changed();
    });
    color.addEventListener("change", commit);
    if (mark?.kind === "text" || this.markTool === "text") {
      const size = mark?.kind === "text" ? mark.width : this.fontSize;
      const input = this.range(this.controls, "Text size", 10, Math.max(256, Math.ceil(size)), size, 1, (value) => {
        this.fontSize = value;
        if (mark?.kind === "text") mark.width = value;
        changed();
      });
      input.addEventListener("change", commit);
    } else {
      const width = mark?.width || this.lineWidth;
      const input = this.range(this.controls, "Stroke width", 1, Math.max(40, Math.ceil(width)), width, 1, (value) => {
        this.lineWidth = value;
        if (mark) mark.width = value;
        changed();
      });
      input.addEventListener("change", commit);
    }
    this.controls.createDiv({ text: this.markTool === "select" ? "Drag to move \xB7 handles to reshape" : "Drag to draw \xB7 click for text", cls: "image-toolkit-hint" }).title = "Select a mark to move, resize or change its style. Arrows have endpoint handles. Text can also be edited. Delete removes the selection.";
    if (mark?.kind === "text") this.button(this.toolActions, "Edit text", () => this.editSelectedText());
    this.button(this.toolActions, "Delete selected", () => this.removeSelected());
  }
  async editSelectedText() {
    const index = this.selected, mark = this.marks[index];
    if (mark?.kind !== "text") return;
    const text = await this.askText(mark.text || "");
    if (!text || this.closed || this.marks[index] !== mark) return;
    await this.exclusive(async () => {
      mark.text = text;
      await this.checkpoint();
      this.renderControls();
      this.refreshOutputSize();
    });
  }
  selectionHandle(point) {
    const mark = this.marks[this.selected];
    if (!mark) return void 0;
    const radius = 12 * this.working.width / this.preview.getBoundingClientRect().width;
    const handles = selectionHandles(mark, this.bounds(mark));
    const closest = handles.reduce((best, handle) => !best || Math.hypot(handle.point.x - point.x, handle.point.y - point.y) < Math.hypot(best.point.x - point.x, best.point.y - point.y) ? handle : best, void 0);
    return closest && Math.hypot(closest.point.x - point.x, closest.point.y - point.y) <= radius ? closest : void 0;
  }
  resetCorners() {
    const w = this.working.width - 1, h = this.working.height - 1;
    this.corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    this.activeCorner = 0;
  }
  rectangleFromCorner(i) {
    const opposite = this.corners[(i + 2) % 4], p = this.corners[i];
    this.corners[(i + 1) % 4] = i % 2 === 0 ? { x: opposite.x, y: p.y } : { x: p.x, y: opposite.y };
    this.corners[(i + 3) % 4] = i % 2 === 0 ? { x: p.x, y: opposite.y } : { x: opposite.x, y: p.y };
  }
  position(e) {
    const r = this.preview.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * this.working.width, 0, this.working.width - 1), y: clamp((e.clientY - r.top) / r.height * this.working.height, 0, this.working.height - 1) };
  }
  pointerDown(e) {
    if (this.busy || e.button !== 0) return;
    e.preventDefault();
    this.preview.focus();
    this.preview.setPointerCapture(e.pointerId);
    const p = this.position(e);
    if (this.tool === "crop") {
      const r = this.preview.getBoundingClientRect(), radius = 22 * this.working.width / r.width;
      let closest = -1, distance = Infinity;
      this.corners.forEach((c, i) => {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < distance) {
          distance = d;
          closest = i;
        }
      });
      if (distance <= radius) {
        this.activeCorner = closest;
        this.dragging = { corner: closest, point: p };
      } else {
        this.corners = rectangleCorners(p, p);
        this.activeCorner = 2;
        this.dragging = { corner: 2, point: p, rectangle: true };
      }
      this.draw();
      return;
    }
    if (this.tool !== "annotate") return;
    ++this.sizeVersion;
    window.clearTimeout(this.estimateTimer);
    this.invalidateEncodedPreview();
    if (this.markTool === "select") {
      const handle = this.selectionHandle(p);
      if (handle) {
        const mark2 = this.marks[this.selected];
        this.dragging = { mark: this.selected, point: p, handle: handle.id, originalMark: clone(mark2), bounds: this.bounds(mark2) };
        this.draw();
        return;
      }
      const previous = this.selected;
      this.selected = -1;
      const tolerance = 8 * this.working.width / this.preview.getBoundingClientRect().width;
      for (let i = this.marks.length - 1; i >= 0; i--) {
        if (hitTestMark(this.marks[i], p, tolerance, this.measureText)) {
          this.selected = i;
          break;
        }
      }
      if (this.selected < 0 && this.marks[previous]) {
        const bounds = this.bounds(this.marks[previous]);
        if (p.x >= bounds.x && p.x <= bounds.x + bounds.w && p.y >= bounds.y && p.y <= bounds.y + bounds.h) this.selected = previous;
      }
      if (this.selected >= 0) this.dragging = { mark: this.selected, point: p, originalMark: clone(this.marks[this.selected]) };
      this.renderControls();
      this.draw();
      return;
    }
    if (this.markTool === "text") {
      this.askText().then((text) => {
        if (text && !this.closed) {
          this.marks.push({ kind: "text", points: [p], text, color: this.color, width: this.fontSize });
          this.selected = this.marks.length - 1;
          this.draw();
          void this.run(() => this.exclusive(async () => {
            await this.checkpoint();
            this.refreshOutputSize();
          }));
        }
      });
      return;
    }
    const mark = { kind: this.markTool, points: [p, { ...p }], color: this.color, width: this.lineWidth };
    this.marks.push(mark);
    this.selected = this.marks.length - 1;
    this.dragging = { mark: this.selected, point: p, drawing: true };
    this.draw();
  }
  pointerMove(e) {
    if (this.busy) return;
    const p = this.position(e), d = this.dragging;
    if (!d) {
      const handle = this.tool === "annotate" && this.markTool === "select" ? this.selectionHandle(p) : void 0;
      this.preview.style.cursor = handle ? handle.id === "nw" || handle.id === "se" ? "nwse-resize" : handle.id === "ne" || handle.id === "sw" ? "nesw-resize" : "crosshair" : this.tool === "annotate" && this.markTool === "select" ? "move" : "crosshair";
      return;
    }
    if (d.corner !== void 0) {
      if (d.rectangle) this.corners = rectangleCorners(d.point, p);
      else {
        this.corners[d.corner] = p;
        if (this.mode === "rectangle") this.rectangleFromCorner(d.corner);
      }
      this.draw();
      this.scheduleBoardPreview();
      return;
    }
    if (d.mark !== void 0) {
      const mark = this.marks[d.mark];
      if (d.drawing) {
        if (mark.kind === "pen" || mark.kind === "highlighter") mark.points.push(p);
        else mark.points[1] = p;
      } else if (d.originalMark) {
        if (d.handle === "start" || d.handle === "end") {
          const reshaped = clone(d.originalMark);
          reshaped.points[d.handle === "start" ? 0 : reshaped.points.length - 1] = p;
          this.marks[d.mark] = reshaped;
        } else if (d.handle && d.bounds) this.marks[d.mark] = resizeMark(d.originalMark, d.bounds, resizeBounds(d.bounds, d.handle, p));
        else this.marks[d.mark] = moveMark(d.originalMark, p.x - d.point.x, p.y - d.point.y);
      }
      this.draw();
    }
  }
  pointerUp() {
    const annotation = this.dragging?.mark !== void 0;
    this.dragging = void 0;
    if (annotation) void this.run(() => this.exclusive(async () => {
      await this.checkpoint();
      if (this.markTool === "select") this.renderControls();
      this.refreshOutputSize();
    }));
    else if (this.tool === "annotate") this.refreshOutputSize();
  }
  draw() {
    if (!this.preview || !this.working || this.closed) return;
    const size = fitPreviewSize(this.working.width, this.working.height, this.scroll.clientWidth || 600, this.scroll.clientHeight || 400, this.zoom);
    const ratio = this.preview.ownerDocument.defaultView?.devicePixelRatio || 1;
    const backingScale = Math.min(ratio, 4096 / Math.max(size.width, size.height));
    this.preview.width = Math.max(1, Math.round(size.width * backingScale));
    this.preview.height = Math.max(1, Math.round(size.height * backingScale));
    this.preview.style.width = `${size.width}px`;
    this.preview.style.height = `${size.height}px`;
    const c = ctx(this.preview);
    c.scale(this.preview.width / this.working.width, this.preview.height / this.working.height);
    c.drawImage(this.encodedPreview || this.working, 0, 0);
    if (!this.encodedPreview) this.paintMarks(c);
    const unit = this.working.width / size.width;
    if (this.tool === "crop") {
      c.beginPath();
      this.corners.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
      c.closePath();
      c.strokeStyle = isValidQuad(this.corners) ? "#00b8ff" : "#ff4141";
      c.lineWidth = 2 * unit;
      c.stroke();
      this.corners.forEach((p, i) => {
        c.beginPath();
        c.arc(p.x, p.y, 8 * unit, 0, Math.PI * 2);
        c.fillStyle = i === this.activeCorner ? "#ffcc00" : "#fff";
        c.fill();
        c.strokeStyle = "#111";
        c.lineWidth = unit;
        c.stroke();
        c.fillStyle = "#111";
        c.font = `${10 * unit}px sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(String(i + 1), p.x, p.y);
      });
      this.drawMagnifier();
    }
    if (this.tool === "annotate" && this.selected >= 0 && this.marks[this.selected]) {
      const mark = this.marks[this.selected], b = this.bounds(mark);
      c.strokeStyle = "#00b8ff";
      c.lineWidth = 1.5 * unit;
      c.setLineDash([5 * unit, 4 * unit]);
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.setLineDash([]);
      if (this.markTool === "select") for (const handle of selectionHandles(mark, b)) {
        c.beginPath();
        c.arc(handle.point.x, handle.point.y, 5 * unit, 0, Math.PI * 2);
        c.fillStyle = "#fff";
        c.fill();
        c.strokeStyle = "#0077c8";
        c.stroke();
      }
    }
  }
  drawMagnifier() {
    if (!this.magnifier) return;
    const p = this.corners[this.activeCorner], c = ctx(this.magnifier);
    c.fillStyle = "#777";
    c.fillRect(0, 0, 160, 120);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.working, p.x - 20, p.y - 15, 40, 30, 0, 0, 160, 120);
    c.strokeStyle = "#ffcc00";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(80, 0);
    c.lineTo(80, 120);
    c.moveTo(0, 60);
    c.lineTo(160, 60);
    c.stroke();
  }
  paintMarks(c) {
    for (const mark of this.marks) {
      c.save();
      c.strokeStyle = mark.color;
      c.fillStyle = mark.color;
      c.lineWidth = mark.width;
      c.lineCap = "round";
      c.lineJoin = "round";
      const a = mark.points[0], b = mark.points[mark.points.length - 1];
      if (mark.kind === "text") {
        c.translate(a.x, a.y);
        c.scale(mark.textScaleX ?? 1, 1);
        c.font = `${mark.width}px sans-serif`;
        c.textBaseline = "top";
        c.fillText(mark.text || "", 0, 0);
      } else if (mark.kind === "rectangle") {
        c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (mark.kind === "ellipse") {
        c.beginPath();
        c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        c.stroke();
      } else {
        if (mark.kind === "highlighter") {
          c.globalAlpha = 0.3;
          c.lineWidth = mark.width * 3;
        }
        c.beginPath();
        mark.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.stroke();
        if (mark.kind === "arrow") {
          const angle = Math.atan2(b.y - a.y, b.x - a.x), len = Math.max(12, mark.width * 4);
          c.beginPath();
          c.moveTo(b.x - len * Math.cos(angle - 0.5), b.y - len * Math.sin(angle - 0.5));
          c.lineTo(b.x, b.y);
          c.lineTo(b.x - len * Math.cos(angle + 0.5), b.y - len * Math.sin(angle + 0.5));
          c.stroke();
        }
      }
      c.restore();
    }
  }
  bounds(mark) {
    return markBounds(mark, this.measureText);
  }
  composite(background) {
    const out = canvas(this.working.width, this.working.height), c = ctx(out);
    if (background) {
      c.fillStyle = background;
      c.fillRect(0, 0, out.width, out.height);
    }
    c.drawImage(this.working, 0, 0);
    this.paintMarks(c);
    return out;
  }
  async removeSelected() {
    if (this.selected < 0) return;
    await this.exclusive(async () => {
      this.marks.splice(this.selected, 1);
      this.selected = -1;
      await this.checkpoint();
      this.renderControls();
      this.draw();
      this.refreshOutputSize();
    });
  }
  async checkpoint() {
    const blob = await encode(this.working);
    if (this.closed) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ blob, marks: clone(this.marks) });
    while (this.history.length > 2 && (this.history.length > 12 || this.history.reduce((n, s) => n + s.blob.size, 0) > 64 * 1024 * 1024)) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }
  async restore(delta) {
    await this.exclusive(async () => {
      if (hasAdjustments(this.adjustments)) {
        this.adjustments = { ...DEFAULT_ADJUSTMENTS };
        this.renderControls();
        this.refreshOutputSize();
        return;
      }
      const index = this.historyIndex + delta;
      if (index < 0 || index >= this.history.length) return;
      const state = this.history[index];
      this.working = await decode(state.blob);
      this.marks = clone(state.marks);
      this.historyIndex = index;
      this.selected = -1;
      this.resetCorners();
      this.renderControls();
      this.draw();
      this.refreshOutputSize();
    });
  }
  async replaceRaster(out) {
    this.working = out;
    this.adjustments = { ...DEFAULT_ADJUSTMENTS };
    this.marks = [];
    this.selected = -1;
    this.resetCorners();
    ++this.sizeVersion;
    window.clearTimeout(this.estimateTimer);
    this.invalidateEncodedPreview();
    await this.checkpoint();
    this.renderControls();
    this.draw();
    this.refreshOutputSize();
    this.status.setText(`Applied ${out.width} \xD7 ${out.height} \xB7 Undo to restore`);
  }
  async transform(kind) {
    await this.exclusive(async () => {
      const src = this.composite(), rotate = kind === "left" || kind === "right", out = canvas(rotate ? src.height : src.width, rotate ? src.width : src.height), c = ctx(out);
      if (kind === "right") {
        c.translate(out.width, 0);
        c.rotate(Math.PI / 2);
      }
      if (kind === "left") {
        c.translate(0, out.height);
        c.rotate(-Math.PI / 2);
      }
      if (kind === "horizontal") {
        c.translate(out.width, 0);
        c.scale(-1, 1);
      }
      if (kind === "vertical") {
        c.translate(0, out.height);
        c.scale(1, -1);
      }
      c.drawImage(src, 0, 0);
      await this.replaceRaster(out);
    });
  }
  boardSize() {
    const auto = estimateRectifiedSize(this.corners);
    let w = this.boardWidth || auto.width, h = this.boardHeight || auto.height;
    if (this.boardWidth && !this.boardHeight) h = Math.round(w * auto.height / auto.width);
    if (this.boardHeight && !this.boardWidth) w = Math.round(h * auto.width / auto.height);
    return { width: Math.max(2, Math.round(w)), height: Math.max(2, Math.round(h)) };
  }
  async applyCrop() {
    if (!isValidQuad(this.corners)) throw new Error("Choose four non-crossing corners enclosing a usable area.");
    const src = this.composite();
    if (this.mode === "rectangle") {
      const xs = this.corners.map((p) => p.x), ys = this.corners.map((p) => p.y), x = Math.round(Math.min(...xs)), y = Math.round(Math.min(...ys)), w = Math.round(Math.max(...xs)) - x + 1, h = Math.round(Math.max(...ys)) - y + 1;
      const out2 = canvas(w, h);
      ctx(out2).drawImage(src, x, y, w, h, 0, 0, w, h);
      await this.replaceRaster(out2);
      return;
    }
    const size = this.boardSize();
    canvas(size.width, size.height);
    const data = ctx(src).getImageData(0, 0, src.width, src.height);
    this.status.setText("Correcting perspective and enhancing board\u2026");
    const result = await this.process({ data: data.data.buffer, width: src.width, height: src.height, corners: this.corners, outWidth: size.width, outHeight: size.height, mode: this.boardBackground === "white" ? "whiteboard" : "blackboard", strength: this.strength });
    if (this.closed) return;
    const out = canvas(result.width, result.height);
    ctx(out).putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
    await this.replaceRaster(out);
  }
  scheduleBoardPreview() {
    window.clearTimeout(this.previewTimer);
    const version = ++this.previewVersion;
    if (this.mode === "rectangle" || !this.boardPreview) return;
    this.previewTimer = window.setTimeout(() => void this.run(async () => {
      if (this.closed || this.busy || this.previewRunning || !isValidQuad(this.corners)) return;
      if (this.mode === "rectangle") return;
      const mode = this.boardBackground === "white" ? "whiteboard" : "blackboard";
      this.previewRunning = true;
      try {
        const scale = Math.min(1, 900 / Math.max(this.working.width, this.working.height));
        const src = canvas(Math.max(2, Math.round(this.working.width * scale)), Math.max(2, Math.round(this.working.height * scale)));
        const c = ctx(src);
        c.scale(src.width / this.working.width, src.height / this.working.height);
        c.drawImage(this.working, 0, 0);
        this.paintMarks(c);
        const points = this.corners.map((p) => ({ x: p.x * (src.width - 1) / Math.max(1, this.working.width - 1), y: p.y * (src.height - 1) / Math.max(1, this.working.height - 1) }));
        const size = this.boardSize(), s = Math.min(1, 700 / Math.max(size.width, size.height));
        const result = await this.process({ data: ctx(src).getImageData(0, 0, src.width, src.height).data.buffer, width: src.width, height: src.height, corners: points, outWidth: Math.max(2, Math.round(size.width * s)), outHeight: Math.max(2, Math.round(size.height * s)), mode, strength: this.strength });
        if (version !== this.previewVersion || this.closed || !this.boardPreview) return;
        this.boardPreview.width = result.width;
        this.boardPreview.height = result.height;
        ctx(this.boardPreview).putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
      } finally {
        this.previewRunning = false;
        if (!this.closed && version !== this.previewVersion) this.scheduleBoardPreview();
      }
    }), 180);
  }
  stopWorker(error) {
    this.worker?.terminate();
    this.worker = void 0;
    this.workerReady = void 0;
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = void 0;
    }
    for (const job of this.jobs.values()) {
      window.clearTimeout(job.timer);
      job.reject(error);
    }
    this.jobs.clear();
  }
  async process(request) {
    if (!this.workerReady) this.workerReady = (async () => {
      if (this.closed) throw new Error("Editor closed.");
      this.workerUrl = URL.createObjectURL(new Blob([processing_worker_default], { type: "text/javascript" }));
      const worker2 = new Worker(this.workerUrl);
      this.worker = worker2;
      worker2.onmessage = (event) => {
        if (this.worker !== worker2) return;
        const r = event.data, job = this.jobs.get(r.id);
        if (!job) return;
        this.jobs.delete(r.id);
        window.clearTimeout(job.timer);
        r.error ? job.reject(new Error(r.error)) : job.resolve(r);
      };
      worker2.onerror = (event) => {
        if (this.worker === worker2) this.stopWorker(new Error(event.message || "Background processing failed."));
      };
    })().catch((error) => {
      this.stopWorker(error);
      throw error;
    });
    await this.workerReady;
    if (this.closed || !this.worker) throw new Error("Background processor is unavailable.");
    const worker = this.worker, id = ++this.workerSequence;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => this.stopWorker(new Error("Board processing timed out. Try a smaller image.")), 6e4);
      this.jobs.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ ...request, id }, [request.data]);
      } catch (error) {
        window.clearTimeout(timer);
        this.jobs.delete(id);
        reject(error);
      }
    });
  }
  async adjustedRaster(background) {
    const adjustments = { ...this.adjustments }, out = this.composite(background);
    if (hasAdjustments(adjustments)) {
      const pixels = ctx(out).getImageData(0, 0, out.width, out.height);
      const result = await this.process({ data: pixels.data.buffer, width: out.width, height: out.height, adjustments });
      if (this.closed) throw new Error("Editor closed.");
      ctx(out).putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
    }
    return out;
  }
  async outputBlob() {
    const out = await this.adjustedRaster(this.format === "jpg" ? "#fff" : void 0);
    const type = `image/${this.format === "jpg" ? "jpeg" : this.format}`;
    const blob = await encode(out, type, this.quality / 100);
    if (blob.type !== type) throw new Error(`This Obsidian version cannot encode ${this.format.toUpperCase()}. The original was not overwritten.`);
    return blob;
  }
  invalidateEncodedPreview() {
    this.encodedPreview?.close();
    this.encodedPreview = void 0;
    this.previewCaption?.setText("Updating\u2026");
    this.draw();
  }
  refreshOutputSize() {
    ++this.sizeVersion;
    window.clearTimeout(this.estimateTimer);
    this.invalidateEncodedPreview();
    this.estimateTimer = window.setTimeout(() => void this.run(() => this.estimateOutput()), 300);
  }
  async estimateOutput() {
    if (this.closed || this.dragging) return;
    if (this.estimating) {
      this.estimateAgain = true;
      return;
    }
    this.estimating = true;
    try {
      do {
        if (this.dragging) return;
        this.estimateAgain = false;
        const version = this.sizeVersion;
        const blob = await this.outputBlob();
        if (this.closed) return;
        if (version !== this.sizeVersion) {
          this.estimateAgain = true;
          continue;
        }
        const decoded = await createImageBitmap(blob);
        if (this.closed) {
          decoded.close();
          return;
        }
        if (version !== this.sizeVersion || this.dragging) {
          decoded.close();
          this.estimateAgain = true;
          continue;
        }
        this.encodedPreview?.close();
        this.encodedPreview = decoded;
        this.draw();
        this.previewCaption.setText(`${this.format.toUpperCase()}${this.format === "png" ? " \xB7 lossless" : ` \xB7 quality ${this.quality}`}${hasAdjustments(this.adjustments) ? " \xB7 adjusted" : ""}`);
        this.previewCaption.title = "Actual encoded preview. 100% zoom fits both dimensions.";
        const diff = Math.round((blob.size / this.original.byteLength - 1) * 100);
        this.outputInfo.setText(`${this.working.width} \xD7 ${this.working.height} \xB7 ${this.bytes(blob.size)} (${diff >= 0 ? "+" : ""}${diff}%)${diff > 0 ? " \u2191" : ""}`);
      } while (this.estimateAgain && !this.closed);
    } finally {
      this.estimating = false;
    }
  }
  bytes(n) {
    return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
  }
  async compare() {
    const modal = new import_obsidian2.Modal(this.app);
    modal.titleEl.setText("Before / after (current export settings)");
    modal.modalEl.addClass("image-toolkit-compare");
    const output = await this.outputBlob();
    if (this.closed) return;
    const urls = [URL.createObjectURL(new Blob([this.original])), URL.createObjectURL(output)];
    const row = modal.contentEl.createDiv("image-toolkit-comparison");
    ["Original", "Output"].forEach((text, i) => {
      const col = row.createDiv();
      col.createEl("h3", { text });
      col.createEl("img", { attr: { src: urls[i], alt: text } });
    });
    this.childModals.add(modal);
    modal.onClose = () => {
      this.childModals.delete(modal);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    modal.open();
  }
  askText(initial = "") {
    return new Promise((resolve) => {
      const modal = new import_obsidian2.Modal(this.app);
      modal.titleEl.setText("Annotation text");
      const input = modal.contentEl.createEl("input", { type: "text", value: initial, attr: { placeholder: "Enter text", "aria-label": "Annotation text" } });
      let result = null;
      const add = modal.contentEl.createEl("button", { text: initial ? "Apply text" : "Add text", cls: "mod-cta" });
      const submit = () => {
        result = input.value.trim();
        modal.close();
      };
      add.onclick = submit;
      input.onkeydown = (e) => {
        if (e.key === "Enter") submit();
      };
      this.childModals.add(modal);
      modal.onClose = () => {
        this.childModals.delete(modal);
        resolve(result);
      };
      modal.open();
      input.focus();
    });
  }
  async prepareBackupPreferences() {
    const current = this.options.getBackupPreferences?.() || { backupEnabled: this.options.backupEnabled, backupFolder: this.options.backupFolder, backupConfigured: this.options.backupConfigured === true };
    let preferences = current;
    if (!current.backupConfigured) {
      const choice = await new Promise((resolve) => {
        const dialog = new BackupPrompt(this.app, current, (result) => {
          this.childModals.delete(dialog);
          resolve(result);
        });
        this.childModals.add(dialog);
        dialog.open();
      });
      if (!choice || this.closed) return false;
      await this.options.saveBackupPreferences?.(choice);
      if (this.closed) return false;
      preferences = choice;
    }
    Object.assign(this.options, preferences, { backupConfigured: true });
    return !this.closed;
  }
  async save() {
    await this.exclusive(async () => {
      if (this.closed || !await this.prepareBackupPreferences()) return;
      await this.applyAdjustmentRaster();
      if (this.closed) return;
      const blob = await this.outputBlob();
      if (this.closed) return;
      const output = await blob.arrayBuffer();
      if (this.closed) return;
      const result = await saveImage(this.app, this.file, this.original, output, { backupEnabled: this.options.backupEnabled, backupFolder: this.options.backupFolder });
      try {
        refreshImageViews(this.app, this.file, this.containerEl.ownerDocument);
      } catch (error) {
        console.error("Image Toolkit: image saved, but refresh failed.", error);
        new import_obsidian2.Notice("Image saved, but the preview could not refresh. Reopen the note to see the change.");
      }
      new import_obsidian2.Notice(`Replaced ${result.path}${result.backupPath ? `
Backup: ${result.backupPath}` : ""}`, 8e3);
      this.close();
    });
  }
};

// src/recovery-dialog.ts
var import_obsidian3 = require("obsidian");

// src/recovery.ts
function sourceParent2(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
function sourceFilename2(path) {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return { basename: filename, extension: "" };
  return { basename: filename.slice(0, dot), extension: filename.slice(dot) };
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function findImageBackups(app, source, backupFolder) {
  const normalizedFolder = normalizeBackupFolder(backupFolder);
  const { basename, extension } = sourceFilename2(source.path);
  const directory = [normalizedFolder, sourceParent2(source.path)].filter(Boolean).join("/");
  const filenamePattern = new RegExp(
    `^${escapeRegExp(basename)}-backup-(\\d+)(?:-(\\d+))?${escapeRegExp(extension)}$`
  );
  const backups = [];
  for (const file of app.vault.getFiles()) {
    const slash = file.path.lastIndexOf("/");
    const fileDirectory = slash < 0 ? "" : file.path.slice(0, slash);
    if (fileDirectory !== directory) continue;
    const match = filenamePattern.exec(file.path.slice(slash + 1));
    if (!match) continue;
    const timestamp = Number(match[1]);
    const collision = match[2] === void 0 ? 0 : Number(match[2]);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime()) || String(timestamp) !== match[1] || !Number.isSafeInteger(collision) || collision < 0 || String(collision) !== (match[2] ?? "0") || match[2] !== void 0 && collision === 0) continue;
    backups.push({ file, path: file.path, timestamp, collision });
  }
  return backups.sort((left, right) => right.timestamp - left.timestamp || right.collision - left.collision);
}
function assertBackupStillPresent(app, source, version, backupFolder) {
  const stillAvailable = findImageBackups(app, source, backupFolder).some(
    (candidate) => candidate.file === version.file && candidate.path === version.path && candidate.timestamp === version.timestamp && candidate.collision === version.collision && version.file.path === version.path && app.vault.getAbstractFileByPath(version.path) === version.file
  );
  if (!stillAvailable) throw new Error("The selected backup is no longer available for this image.");
}
async function restoreImageBackup(app, source, version, originalBytes, backupBytes, backupFolder) {
  const selectedVersion = { ...version };
  const originalSnapshot = originalBytes.slice(0);
  const backupSnapshot = backupBytes.slice(0);
  assertBackupStillPresent(app, source, selectedVersion, backupFolder);
  const restoredBytes = await app.vault.readBinary(selectedVersion.file);
  assertBackupStillPresent(app, source, selectedVersion, backupFolder);
  if (!bytesEqual(restoredBytes, backupSnapshot)) {
    throw new Error("The selected backup changed after it was previewed.");
  }
  assertStaticImage(restoredBytes, source.extension.toLowerCase());
  return saveImage(app, source, originalSnapshot, restoredBytes, {
    backupEnabled: true,
    backupFolder
  });
}

// src/recovery-dialog.ts
function formatImageBytes(bytes) {
  const exact = `${bytes.toLocaleString()} bytes`;
  if (bytes < 1024) return exact;
  const unit = bytes < 1024 * 1024 ? "KB" : "MB";
  const divisor = unit === "KB" ? 1024 : 1024 * 1024;
  return `${(bytes / divisor).toFixed(2)} ${unit} (${exact})`;
}
var ImageRecovery = class extends import_obsidian3.Modal {
  constructor(app, file, backupFolder, didClose = () => {
  }) {
    super(app);
    this.file = file;
    this.backupFolder = backupFolder;
    this.didClose = didClose;
    this.closed = false;
    this.restoring = false;
    this.selectionVersion = 0;
    this.rows = [];
    this.urls = /* @__PURE__ */ new Set();
    this.sourcePath = file.path;
  }
  async onOpen() {
    this.modalEl.addClass("image-toolkit-recovery");
    this.titleEl.setText("Recover image");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.sourcePath, cls: "image-toolkit-recovery-path" });
    this.contentEl.createEl("p", { text: "Select a backup to restore. This replaces the shared image in every note. The current image will be backed up first." });
    const layout = this.contentEl.createDiv("image-toolkit-recovery-layout");
    const list = layout.createDiv("image-toolkit-recovery-versions");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Backup versions");
    list.createEl("p", { text: "Loading backup versions\u2026" });
    const panel = layout.createDiv("image-toolkit-recovery-preview");
    this.preview = panel.createEl("img", { attr: { alt: "Selected backup preview" } });
    this.preview.hidden = true;
    this.details = panel.createEl("p", { text: "Select a version to preview it." });
    this.status = this.contentEl.createEl("p", { attr: { role: "status", "aria-live": "polite" } });
    const actions = this.contentEl.createDiv("image-toolkit-recovery-actions");
    this.cancelButton = actions.createEl("button", { text: "Cancel" });
    this.cancelButton.onclick = () => this.close();
    this.restoreButton = actions.createEl("button", { text: "Restore selected version", cls: "mod-cta" });
    this.restoreButton.disabled = true;
    this.restoreButton.onclick = () => {
      void this.restore();
    };
    try {
      const versions = findImageBackups(this.app, this.file, this.backupFolder);
      list.empty();
      if (versions.length === 0) {
        list.createEl("p", { text: `No backups found for this image in ${this.backupFolder}.` });
        return;
      }
      this.original = await this.app.vault.readBinary(this.file);
      if (this.closed) return;
      this.assertSourcePresent();
      for (const version of versions) this.addVersion(list, version);
      this.status.setText(`${versions.length} backup version${versions.length === 1 ? "" : "s"} \xB7 Newest first`);
    } catch (error) {
      if (!this.closed) {
        list.empty();
        this.showError(error);
      }
    }
  }
  onClose() {
    this.closed = true;
    ++this.selectionVersion;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.preview?.removeAttribute("src");
    this.selected = void 0;
    this.original = void 0;
    this.didClose();
  }
  addVersion(list, version) {
    const row = list.createEl("button", { cls: "image-toolkit-recovery-version", attr: { type: "button", "aria-pressed": "false" } });
    row.title = version.path;
    const thumbnail = row.createEl("img", { attr: { alt: "", loading: "lazy" } });
    const metadata = row.createSpan();
    metadata.createEl("strong", { text: new Date(version.timestamp).toLocaleString() });
    metadata.createSpan({ text: `${formatImageBytes(version.file.stat.size)} \xB7 ${version.file.extension.toUpperCase()}` });
    const dimensions = metadata.createSpan({ text: "Loading dimensions\u2026" });
    metadata.createSpan({ text: version.file.name, cls: "image-toolkit-recovery-path" });
    thumbnail.onload = () => {
      if (!this.closed) dimensions.setText(`${thumbnail.naturalWidth} \xD7 ${thumbnail.naturalHeight} px`);
    };
    thumbnail.onerror = () => {
      if (!this.closed) dimensions.setText("Preview unavailable");
    };
    thumbnail.src = this.app.vault.getResourcePath(version.file);
    row.onclick = () => {
      void this.selectVersion(version, row);
    };
    this.rows.push(row);
  }
  async selectVersion(version, row) {
    if (this.closed || this.restoring) return;
    const request = ++this.selectionVersion;
    this.selected = void 0;
    this.restoreButton.disabled = true;
    this.preview.hidden = true;
    this.preview.removeAttribute("src");
    if (this.selectedUrl) {
      this.releaseUrl(this.selectedUrl);
      this.selectedUrl = void 0;
    }
    for (const candidate of this.rows) candidate.setAttribute("aria-pressed", String(candidate === row));
    this.details.setText("Loading selected backup\u2026");
    this.status.removeClass("image-toolkit-error");
    this.status.setText("");
    let url;
    try {
      if (version.file.path !== version.path || this.app.vault.getAbstractFileByPath(version.path) !== version.file) {
        throw new Error("This backup was moved or removed. Reopen Recover image to refresh the list.");
      }
      const bytes = await this.app.vault.readBinary(version.file);
      if (this.closed || request !== this.selectionVersion) return;
      assertStaticImage(bytes, this.file.extension.toLowerCase());
      url = URL.createObjectURL(new Blob([bytes]));
      this.urls.add(url);
      const probe = this.containerEl.ownerDocument.createElement("img");
      probe.src = url;
      await probe.decode();
      if (this.closed || request !== this.selectionVersion) return;
      this.selected = { version, bytes };
      this.selectedUrl = url;
      this.preview.src = url;
      this.preview.hidden = false;
      this.details.setText(`${new Date(version.timestamp).toLocaleString()}
${probe.naturalWidth} \xD7 ${probe.naturalHeight} px \xB7 ${this.file.extension.toUpperCase()}
${formatImageBytes(bytes.byteLength)}
${version.path}`);
      this.restoreButton.disabled = false;
      this.status.setText("The current version will be backed up before restoring.");
    } catch (error) {
      if (!this.closed && request === this.selectionVersion) {
        this.details.setText("Cannot use this backup. Select another version.");
        this.showError(error);
      }
    } finally {
      if (url && url !== this.selectedUrl) this.releaseUrl(url);
    }
  }
  async restore() {
    if (this.closed || this.restoring || !this.selected || !this.original) return;
    const { version, bytes } = this.selected;
    this.restoring = true;
    this.restoreButton.disabled = true;
    this.cancelButton.disabled = true;
    for (const row of this.rows) row.disabled = true;
    this.status.removeClass("image-toolkit-error");
    this.status.setText("Backing up the current image and restoring\u2026");
    try {
      this.assertSourcePresent();
      const result = await restoreImageBackup(this.app, this.file, version, this.original, bytes, this.backupFolder);
      try {
        refreshImageViews(this.app, this.file, this.containerEl.ownerDocument);
      } catch (error) {
        console.error("Image Toolkit: recovered image refresh failed.", error);
        new import_obsidian3.Notice("Image recovered. Reopen the note if its preview has not refreshed.");
      }
      new import_obsidian3.Notice(`Recovered ${result.path}
Previous version backed up: ${result.backupPath}`, 8e3);
      if (!this.closed) this.close();
    } catch (error) {
      if (!this.closed) this.showError(error);
    } finally {
      this.restoring = false;
      if (!this.closed) {
        this.restoreButton.disabled = !this.selected;
        this.cancelButton.disabled = false;
        for (const row of this.rows) row.disabled = false;
      }
    }
  }
  assertSourcePresent() {
    if (this.file.path !== this.sourcePath || this.app.vault.getAbstractFileByPath(this.sourcePath) !== this.file) {
      throw new Error("The source image was moved or removed. Reopen Recover image.");
    }
  }
  showError(error) {
    this.status.addClass("image-toolkit-error");
    this.status.setText(error instanceof Error ? error.message : String(error));
  }
  releaseUrl(url) {
    if (this.urls.delete(url)) URL.revokeObjectURL(url);
  }
};

// src/insertions.ts
var queues = /* @__PURE__ */ new WeakMap();
async function createAttachment(app, folder, filename, bytes) {
  const previous = queues.get(app.vault) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  queues.set(app.vault, current);
  await previous;
  try {
    await ensureFolder(app, folder, "image");
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    for (let index = 0; Number.isSafeInteger(index); index++) {
      const name = `${base}${index ? `-${index}` : ""}${extension}`;
      const path = [folder, name].filter(Boolean).join("/");
      if (app.vault.getAbstractFileByPath(path)) continue;
      try {
        return await app.vault.createBinary(path, bytes);
      } catch (error) {
        if (app.vault.getAbstractFileByPath(path)) continue;
        throw error;
      }
    }
    throw new Error("Could not find a unique attachment filename.");
  } finally {
    release();
    if (queues.get(app.vault) === current) queues.delete(app.vault);
  }
}
function createImageAttachment(app, file, bytes, notePath, preferences, date = /* @__PURE__ */ new Date()) {
  const folder = imageDestinationFolder(preferences.imageFolder, notePath);
  const filename = insertedImageName(file, notePath, preferences, date);
  return createAttachment(app, folder, filename, bytes);
}
async function importInsertedFile(app, file, notePath, preferences, date = /* @__PURE__ */ new Date()) {
  const image = isInsertedImage(file);
  let saved;
  if (image) {
    saved = await createImageAttachment(app, file, await file.arrayBuffer(), notePath, preferences, date);
  } else {
    const path = await app.fileManager.getAvailablePathForAttachment(file.name, notePath);
    const slash = path.lastIndexOf("/");
    const folder = slash < 0 ? "" : path.slice(0, slash);
    const filename = path.slice(slash + 1);
    saved = await createAttachment(app, folder, filename, await file.arrayBuffer());
  }
  const link = app.fileManager.generateMarkdownLink(saved, notePath);
  const embeddable = image || /\.(pdf|mp3|wav|m4a|ogg|flac|3gp|mp4|webm|ogv|mov|mkv)$/i.test(saved.path);
  return { file: saved, embed: embeddable ? `!${link.replace(/^!/, "")}` : link };
}
var InsertionRange = class {
  constructor(from, to, text) {
    this.from = from;
    this.to = to;
    this.text = text;
    this.valid = true;
  }
  update(text) {
    if (!this.valid || text === this.text) return this.valid;
    const previous = this.text;
    let start = 0;
    while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
    let end = previous.length, newEnd = text.length;
    while (end > start && newEnd > start && previous[end - 1] === text[newEnd - 1]) {
      end--;
      newEnd--;
    }
    const delta = newEnd - end;
    if (end <= this.from && start < this.from) {
      this.from += delta;
      this.to += delta;
    } else if (start < this.to || start < this.from && end > this.from) {
      this.valid = false;
    }
    this.text = text;
    return this.valid;
  }
};
var ImageInsertions = class {
  constructor(app, preferences, notify) {
    this.app = app;
    this.preferences = preferences;
    this.notify = notify;
    this.disposed = false;
    this.pending = /* @__PURE__ */ new Set();
  }
  dispose() {
    this.disposed = true;
    this.cancelPicker?.();
    this.pending.clear();
    this.restoreNativeSave?.();
  }
  enableNativeAttachments() {
    const app = this.app;
    const original = app.saveAttachment;
    if (typeof original !== "function" || this.restoreNativeSave) return;
    const hadOwnMethod = Object.prototype.hasOwnProperty.call(app, "saveAttachment");
    const save = async (name, extension, bytes) => {
      const preferences = this.preferences();
      const note = app.workspace.activeEditor?.file;
      const file = { name: `${name}.${extension}`, type: "" };
      if (this.disposed || !preferences.manageInsertedImages || note?.extension !== "md" || note !== app.workspace.getActiveFile() || !isInsertedImage(file)) {
        return original.call(app, name, extension, bytes);
      }
      try {
        return await createImageAttachment(app, file, bytes, note.path, preferences);
      } catch (error) {
        this.notify(`Image Toolkit could not insert ${file.name}: ${error instanceof Error ? error.message : String(error)}. Please retry this file.`);
        return null;
      }
    };
    app.saveAttachment = save;
    this.restoreNativeSave = () => {
      if (app.saveAttachment !== save) return;
      if (hadOwnMethod) app.saveAttachment = original;
      else delete app.saveAttachment;
    };
  }
  onEditorChange(editor, info) {
    for (const insertion of this.pending) if (insertion.editor === editor) insertion.sync(info?.file);
  }
  canPickImages(editor, info) {
    return !this.disposed && this.preferences().manageInsertedImages && !!info.file && editor.listSelections().length === 1;
  }
  pickImages(doc, editor, info) {
    const note = info.file;
    if (!note || !this.canPickImages(editor, info)) return;
    const preferences = { ...this.preferences() };
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const insertion = this.trackInsertion(editor, info, note, from, to);
    return this.insertFiles(insertion, this.chooseImages(doc), preferences);
  }
  chooseImages(doc) {
    this.cancelPicker?.();
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = "image/*,.heic,.heif";
      input.multiple = true;
      input.hidden = true;
      const finish = (files) => {
        if (this.cancelPicker !== cancel) return;
        this.cancelPicker = void 0;
        input.remove();
        resolve(files);
      };
      const cancel = () => finish([]);
      this.cancelPicker = cancel;
      input.addEventListener("cancel", cancel);
      input.addEventListener("change", () => finish(Array.from(input.files ?? []).filter(isInsertedImage)));
      doc.body.append(input);
      input.click();
    });
  }
  handle(event, editor, info) {
    const preferences = { ...this.preferences() };
    if (this.disposed || event.defaultPrevented || !preferences.manageInsertedImages || !info.file) return;
    if (editor.listSelections().length > 1) return;
    const transfer = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
    if (!transfer) return;
    const files = Array.from(transfer.files);
    if (!files.length) {
      for (const item of Array.from(transfer.items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.some(isInsertedImage)) return;
    const note = info.file;
    let from = editor.posToOffset(editor.getCursor("from"));
    let to = editor.posToOffset(editor.getCursor("to"));
    if (!("clipboardData" in event)) {
      const cm = editor.cm;
      const drop = event;
      from = cm?.posAtCoords?.({ x: drop.clientX, y: drop.clientY }) ?? editor.posToOffset(editor.getCursor());
      to = from;
    }
    event.preventDefault();
    const insertion = this.trackInsertion(editor, info, note, from, to);
    return this.insertFiles(insertion, files, preferences);
  }
  trackInsertion(editor, info, note, from, to) {
    const notePath = note.path;
    const range = new InsertionRange(from, to, editor.getValue());
    const sync = (currentFile = info.file) => {
      if (currentFile !== note || info.file !== note || info.file.path !== notePath) range.valid = false;
      return range.valid && range.update(editor.getValue());
    };
    const insertion = { editor, notePath, range, sync };
    this.pending.add(insertion);
    return insertion;
  }
  async insertFiles(insertion, selection, preferences) {
    const { editor, notePath, range, sync } = insertion;
    const links = [];
    try {
      const files = Array.isArray(selection) ? selection : await selection;
      if (this.disposed || !files.length) return;
      if (!sync()) {
        this.notify("Image Toolkit cancelled the import because the note or insertion range changed.");
        return;
      }
      const date = /* @__PURE__ */ new Date();
      for (const file of files) {
        if (this.disposed || !sync()) break;
        try {
          const result = await importInsertedFile(this.app, file, notePath, preferences, date);
          links.push(result.embed);
        } catch (error) {
          this.notify(`Image Toolkit could not insert ${file.name}: ${error instanceof Error ? error.message : String(error)}. Please retry this file.`);
        }
      }
      if (links.length) {
        if (!this.disposed && sync()) {
          this.pending.delete(insertion);
          editor.replaceRange(links.join("\n"), editor.offsetToPos(range.from), editor.offsetToPos(range.to));
        } else {
          this.notify("Image Toolkit saved attachments, but insertion was cancelled or the note changed. The files remain in the attachment folder.");
        }
      }
    } finally {
      this.pending.delete(insertion);
    }
  }
};

// src/main.ts
var ImageToolkit = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.documents = /* @__PURE__ */ new WeakSet();
    this.menuHandled = false;
    this.imageClick = false;
    this.extendedMenus = /* @__PURE__ */ new WeakSet();
    this.menuTimers = /* @__PURE__ */ new Set();
    this.editors = /* @__PURE__ */ new Set();
    this.recoveries = /* @__PURE__ */ new Set();
  }
  async onload() {
    this.settings = loadSettings(await this.loadData(), import_obsidian4.Platform.isMobile);
    this.addSettingTab(new ToolkitSettings(this.app, this));
    const insertions = new ImageInsertions(this.app, () => this.settings, (message) => new import_obsidian4.Notice(message));
    this.register(() => insertions.dispose());
    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor, info) => {
      void insertions.handle(event, editor, info);
    }));
    this.registerEvent(this.app.workspace.on("editor-drop", (event, editor, info) => {
      void insertions.handle(event, editor, info);
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => insertions.onEditorChange(editor, info)));
    if (import_obsidian4.Platform.isMobile) {
      insertions.enableNativeAttachments();
      this.addCommand({
        id: "insert-images-from-device",
        name: "Insert images from device",
        icon: "image-plus",
        editorCheckCallback: (checking, editor, info) => {
          if (!insertions.canPickImages(editor, info)) return false;
          if (!checking) void insertions.pickImages(document, editor, info);
          return true;
        }
      });
      return;
    }
    this.register(() => {
      for (const timer of this.menuTimers) window.clearTimeout(timer);
      this.menuTimers.clear();
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof import_obsidian4.TFile && supportedExtension(file.path)) {
        const context = this.clicked?.file.path === file.path ? this.clicked : { file };
        this.addMenu(menu, context);
        if (this.clicked?.file.path === file.path) this.menuHandled = true;
      }
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      if (this.clicked) {
        this.addMenu(menu, this.clicked);
        this.menuHandled = true;
        return;
      }
      if (this.imageClick || !info.file) return;
      const offset = editor.posToOffset(editor.getCursor());
      const embed = findImageEmbeds(editor.getValue()).find((e) => e.start <= offset && offset <= e.end);
      if (!embed) return;
      const file = this.resolve(embed.link, info.file.path);
      if (!file) return;
      this.addMenu(menu, { file });
      this.menuHandled = true;
    }));
    this.addCommand({ id: "edit-image-at-cursor", name: "Edit image at cursor", editorCallback: (editor, view) => {
      const offset = editor.posToOffset(editor.getCursor());
      const embed = findImageEmbeds(editor.getValue()).find((e) => e.start <= offset && offset <= e.end);
      const file = embed && view.file && this.resolve(embed.link, view.file.path);
      if (file && embed && view.file) this.open({ file }, "compress");
      else new import_obsidian4.Notice("Place the cursor on a local JPEG, PNG or WebP embed.");
    } });
    const attach = () => {
      this.attachDocument(document);
      this.app.workspace.iterateAllLeaves((leaf) => this.attachDocument(leaf.view.containerEl.ownerDocument));
    };
    this.app.workspace.onLayoutReady(attach);
    this.registerEvent(this.app.workspace.on("layout-change", attach));
    this.registerEvent(this.app.workspace.on("active-leaf-change", attach));
  }
  onunload() {
    for (const editor of this.editors) editor.close();
    for (const recovery of this.recoveries) recovery.close();
  }
  resolve(link, notePath) {
    if (isRemote(link)) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(link, notePath);
    return file && supportedExtension(file.path) ? file : null;
  }
  attachDocument(doc) {
    if (this.documents.has(doc)) return;
    this.documents.add(doc);
    this.registerDomEvent(doc, "contextmenu", (event) => {
      this.clicked = void 0;
      this.imageClick = false;
      this.menuHandled = false;
      const el = event.target;
      if (!el || el.closest(".image-toolkit-modal, .image-toolkit-recovery")) return;
      const img = el.closest("img");
      if (!img) return;
      this.imageClick = true;
      const resource = (img.currentSrc || img.src).split("?")[0];
      const file = this.app.vault.getFiles().find((f) => supportedExtension(f.path) && this.app.vault.getResourcePath(f).split("?")[0] === resource);
      if (!file) {
        queueMicrotask(() => {
          this.imageClick = false;
        });
        return;
      }
      const context = { file };
      this.clicked = context;
      const x = event.clientX, y = event.clientY;
      const timer = window.setTimeout(() => {
        if (!this.menuHandled) {
          const menu = new import_obsidian4.Menu();
          this.addMenu(menu, context);
          menu.showAtPosition({ x, y });
        }
        this.clicked = void 0;
        this.imageClick = false;
        this.menuTimers.delete(timer);
      }, 0);
      this.menuTimers.add(timer);
    }, true);
  }
  addMenu(menu, context) {
    if (this.extendedMenus.has(menu)) return;
    this.extendedMenus.add(menu);
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Edit image").setIcon("image").onClick(() => this.open(context, "compress")));
    if (this.settings.backupEnabled) menu.addItem((item) => item.setTitle("Recover image").setIcon("history").onClick(() => this.recover(context)));
  }
  recover(context) {
    if (!this.settings.backupEnabled) return;
    const recovery = new ImageRecovery(this.app, context.file, this.settings.backupFolder, () => this.recoveries.delete(recovery));
    this.recoveries.add(recovery);
    recovery.open();
  }
  open(context, tool) {
    const options = {
      tool,
      quality: this.settings.quality,
      backupEnabled: this.settings.backupEnabled,
      backupFolder: this.settings.backupFolder,
      backupConfigured: this.settings.backupConfigured,
      getBackupPreferences: () => ({ ...this.settings }),
      saveBackupPreferences: async (preferences) => {
        const next = { ...this.settings, ...preferences, backupConfigured: true };
        await this.saveData(next);
        this.settings = next;
      }
    };
    const editor = new ImageEditor(this.app, context.file, options, () => this.editors.delete(editor));
    this.editors.add(editor);
    editor.open();
  }
};
var ToolkitSettings = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Image Toolkit" });
    this.containerEl.createEl("h3", { text: "Inserted images" });
    new import_obsidian4.Setting(this.containerEl).setName("Manage all inserted images").setDesc(import_obsidian4.Platform.isMobile ? "Use your image folder for images attached with the paperclip, selected with Insert images from device, or pasted into notes." : "Use your image folder for new image files pasted or dropped into notes. Turn off to use Obsidian attachment settings.").addToggle((toggle) => toggle.setValue(this.plugin.settings.manageInsertedImages).onChange(async (value) => {
      this.plugin.settings.manageInsertedImages = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    const validatedText = (name, description, key, normalize) => {
      new import_obsidian4.Setting(this.containerEl).setName(name).setDesc(description).addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS[key]).setValue(this.plugin.settings[key]);
        text.inputEl.addEventListener("change", () => {
          void (async () => {
            try {
              const value = normalize(text.getValue());
              text.inputEl.setCustomValidity("");
              this.plugin.settings[key] = value;
              text.setValue(value);
              await this.plugin.saveData(this.plugin.settings);
              if (key === "imageNameTemplate") this.display();
            } catch (error) {
              text.inputEl.setCustomValidity(error instanceof Error ? error.message : String(error));
              text.inputEl.reportValidity();
            }
          })();
        });
        text.inputEl.addEventListener("input", () => text.inputEl.setCustomValidity(""));
      });
    };
    validatedText("Default image folder", "Type ./ for the current note folder, _Asset/ for a vault-root folder, ./_Asset/ for a folder beside the note, or / for the vault root. Missing folders are created automatically.", "imageFolder", normalizeImageFolder);
    new import_obsidian4.Setting(this.containerEl).setName("Rename inserted images").setDesc("Apply the filename template on import. Disabled: keep the original name. Name collisions always get -1, -2, etc.; existing files are never overwritten.").addToggle((toggle) => toggle.setValue(this.plugin.settings.renameInsertedImages).onChange(async (value) => {
      this.plugin.settings.renameInsertedImages = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    const presets = {
      "<original-name>.<suffix>": "Original name",
      "<original-name>-YYYY-MM-DD.<suffix>": "Original name + date",
      "<note-name>-YYYY-MM-DD-HHmmss.<suffix>": "Note name + date and time"
    };
    new import_obsidian4.Setting(this.containerEl).setName("Filename preset").addDropdown((dropdown) => dropdown.addOptions({ ...presets, "": "Custom template" }).setValue(this.plugin.settings.imageNameTemplate in presets ? this.plugin.settings.imageNameTemplate : "").onChange(async (value) => {
      if (!value) return;
      this.plugin.settings.imageNameTemplate = value;
      await this.plugin.saveData(this.plugin.settings);
      this.display();
    }));
    validatedText("Filename template", "Tokens: <original-name>, <note-name>, YYYY, MM, DD, HH, mm, ss (local date/time). Must end with .<suffix>; the original image format is preserved. Applies only when management and renaming are enabled.", "imageNameTemplate", normalizeImageNameTemplate);
    this.containerEl.createEl("p", { text: `Example: ${insertedImageName({ name: "photo.png", type: "image/png" }, "My note.md", { ...this.plugin.settings, renameInsertedImages: true })}` });
    if (import_obsidian4.Platform.isMobile) return;
    this.containerEl.createEl("h3", { text: "Image editing" });
    new import_obsidian4.Setting(this.containerEl).setName("Default quality").setDesc("JPEG / WebP only. PNG is lossless.").addSlider((slider) => slider.setLimits(10, 100, 1).setValue(this.plugin.settings.quality).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.quality = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian4.Setting(this.containerEl).setName("Back up before overwriting").setDesc("Every Save replaces the original file. When enabled, preserve its previous bytes in the backup folder first. A failed backup cancels saving.").addToggle((toggle) => toggle.setValue(this.plugin.settings.backupEnabled).onChange(async (value) => {
      this.plugin.settings.backupEnabled = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian4.Setting(this.containerEl).setName("Backup folder").setDesc("Vault-relative folder. Source subfolders are mirrored and each overwrite gets a separate backup.").addText((text) => {
      text.setPlaceholder(DEFAULT_SETTINGS.backupFolder).setValue(this.plugin.settings.backupFolder);
      text.inputEl.addEventListener("change", () => {
        void (async () => {
          try {
            const folder = normalizeBackupFolder(text.getValue());
            text.inputEl.setCustomValidity("");
            this.plugin.settings.backupFolder = folder;
            text.setValue(folder);
            await this.plugin.saveData(this.plugin.settings);
          } catch (error) {
            text.inputEl.setCustomValidity(String(error));
            text.inputEl.reportValidity();
          }
        })();
      });
      text.inputEl.addEventListener("input", () => text.inputEl.setCustomValidity(""));
    });
    this.containerEl.createEl("p", { text: "Images are processed locally. Save always overwrites the same image path and preserves its format; all notes referencing it see the change. Backups start disabled; the first Save asks whether to enable them and where to store them. Desktop-only preview release." });
  }
};
