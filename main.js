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
var import_obsidian3 = require("obsidian");

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
async function ensureFolder(app, path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing) {
      if (!isFolder(existing)) throw new Error(`Cannot create backup folder because '${current}' is a file.`);
      continue;
    }
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      const created2 = app.vault.getAbstractFileByPath(current);
      if (!isFolder(created2)) throw error;
    }
    const created = app.vault.getAbstractFileByPath(current);
    if (!isFolder(created)) throw new Error(`Could not create backup folder '${current}'.`);
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
async function saveImage(app, source, originalBytes, output, options) {
  if (output.byteLength === 0) throw new Error("Cannot save an empty image.");
  const sourcePath = source.path;
  const originalSnapshot = originalBytes.slice(0);
  const outputSnapshot = output.slice(0);
  assertSourceStillPresent(app, source, sourcePath);
  if (!options.backupEnabled) {
    await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
    assertSourceStillPresent(app, source, sourcePath);
    await app.vault.modifyBinary(source, outputSnapshot.slice(0));
    return { path: sourcePath };
  }
  const backupFolder = normalizeBackupFolder(options.backupFolder);
  await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
  const backup = await createUniqueBackup(app, sourcePath, backupFolder, originalSnapshot);
  await assertBackupWritten(app, backup, originalSnapshot);
  await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
  assertSourceStillPresent(app, source, sourcePath);
  await app.vault.modifyBinary(source, outputSnapshot.slice(0));
  return { path: sourcePath, backupPath: backup.path };
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

// src/backup-dialog.ts
var import_obsidian = require("obsidian");

// src/settings.ts
var DEFAULT_SETTINGS = {
  quality: 85,
  backupEnabled: false,
  backupConfigured: false,
  backupFolder: "Image Toolkit Backups"
};
function loadSettings(saved) {
  const record = typeof saved === "object" && saved !== null && !Array.isArray(saved) ? saved : {};
  const hasConfigurationMarker = typeof record.backupConfigured === "boolean";
  return {
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
      const source = await this.app.vault.adapter.read(`${this.options.pluginDir}/processing-worker.js`);
      if (this.closed) throw new Error("Editor closed.");
      this.workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
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
      new import_obsidian2.Notice(`Replaced ${result.path}${result.backupPath ? `
Backup: ${result.backupPath}` : ""}`, 8e3);
      this.close();
    });
  }
};

// src/main.ts
var ImageToolkit = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.documents = /* @__PURE__ */ new WeakSet();
    this.menuHandled = false;
    this.imageClick = false;
    this.extendedMenus = /* @__PURE__ */ new WeakSet();
    this.menuTimers = /* @__PURE__ */ new Set();
    this.editors = /* @__PURE__ */ new Set();
  }
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.register(() => {
      for (const timer of this.menuTimers) window.clearTimeout(timer);
      this.menuTimers.clear();
    });
    this.addSettingTab(new ToolkitSettings(this.app, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof import_obsidian3.TFile && supportedExtension(file.path)) {
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
      else new import_obsidian3.Notice("Place the cursor on a local JPEG, PNG or WebP embed.");
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
      if (!el || el.closest(".image-toolkit-modal")) return;
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
          const menu = new import_obsidian3.Menu();
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
  }
  open(context, tool) {
    const options = {
      tool,
      quality: this.settings.quality,
      backupEnabled: this.settings.backupEnabled,
      backupFolder: this.settings.backupFolder,
      backupConfigured: this.settings.backupConfigured,
      pluginDir: this.manifest.dir,
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
var ToolkitSettings = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Image Toolkit" });
    new import_obsidian3.Setting(this.containerEl).setName("Default quality").setDesc("JPEG / WebP only. PNG is lossless.").addSlider((slider) => slider.setLimits(10, 100, 1).setValue(this.plugin.settings.quality).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.quality = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian3.Setting(this.containerEl).setName("Back up before overwriting").setDesc("Every Save replaces the original file. When enabled, preserve its previous bytes in the backup folder first. A failed backup cancels saving.").addToggle((toggle) => toggle.setValue(this.plugin.settings.backupEnabled).onChange(async (value) => {
      this.plugin.settings.backupEnabled = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian3.Setting(this.containerEl).setName("Backup folder").setDesc("Vault-relative folder. Source subfolders are mirrored and each overwrite gets a separate backup.").addText((text) => {
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
