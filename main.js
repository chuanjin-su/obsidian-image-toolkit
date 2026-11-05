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
var import_obsidian2 = require("obsidian");

// src/editor.ts
var import_obsidian = require("obsidian");

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
var ImageEditor = class extends import_obsidian.Modal {
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
    this.tool = options.tool;
    this.quality = clamp(Number(options.quality) || 85, 10, 100);
    this.format = file.extension.toLowerCase() === "jpeg" ? "jpg" : file.extension.toLowerCase();
  }
  async onOpen() {
    this.modalEl.addClass("image-toolkit-modal");
    this.titleEl.setText(`Image Toolkit \u2014 ${this.file.name}`);
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
        new import_obsidian.Notice(String(e));
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
    for (const [id, title] of [["compress", "Compress"], ["resize", "Resize"], ["crop", "Crop / board"], ["annotate", "Annotate"]]) {
      const b = this.button(toolbar, title, () => {
        this.tool = id;
        this.selected = -1;
        this.renderControls();
        this.draw();
      });
      b.dataset.tool = id;
    }
    this.button(toolbar, "Undo", () => this.restore(-1));
    this.button(toolbar, "Redo", () => this.restore(1));
    this.button(toolbar, "Reset", () => this.exclusive(async () => {
      this.working = await decode(new Blob([this.original]));
      this.marks = [];
      this.resetCorners();
      await this.checkpoint();
      this.renderControls();
      this.draw();
      this.refreshOutputSize();
    }));
    const layout = this.contentEl.createDiv("image-toolkit-layout");
    const viewport = layout.createDiv("image-toolkit-viewport");
    const zoomBar = viewport.createDiv("image-toolkit-zoom");
    this.range(zoomBar, "Zoom (100% = fit)", 25, 300, this.zoom, 5, (value) => {
      this.zoom = value;
      this.draw();
    });
    this.previewCaption = viewport.createDiv("image-toolkit-preview-caption");
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
    this.controls = layout.createDiv("image-toolkit-controls");
    this.status = this.contentEl.createDiv("image-toolkit-status");
    this.status.setAttribute("role", "status");
    this.status.setText(`Original: ${this.working.width} \xD7 ${this.working.height} \xB7 ${this.bytes(this.original.byteLength)}. Crop / resize controls require Apply before saving.`);
    const footer = this.contentEl.createDiv("image-toolkit-footer");
    this.outputInfo = footer.createSpan();
    this.button(footer, "Cancel", () => this.close());
    this.button(footer, "Save image", () => this.save(), true);
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
    const label = this.label(parent, `${text}: ${value}`);
    const title = label.firstChild;
    const input = label.createEl("input", { type: "range", value: String(value), attr: { min: String(min), max: String(max), step: String(step) } });
    input.addEventListener("input", () => {
      title.textContent = `${text}: ${input.value}`;
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
  renderControls() {
    if (!this.controls) return;
    this.controls.empty();
    this.boardPreview = void 0;
    this.magnifier = void 0;
    this.contentEl.querySelectorAll("[data-tool]").forEach((el) => el.toggleClass("is-active", el.dataset.tool === this.tool));
    if (this.tool === "compress") {
      this.controls.createEl("h3", { text: "Compression / export" });
      this.controls.createEl("p", { text: "Quality changes update the actual encoded preview after 300 ms. JPEG/WebP quality affects output size; PNG remains lossless. Saving preserves the original format and replaces the same file. Metadata is not retained." });
      this.button(this.controls, "Before / after", () => this.compare());
    }
    if (this.tool === "resize") this.resizeControls();
    if (this.tool === "crop") this.cropControls();
    if (this.tool === "annotate") this.annotationControls();
    this.controls.createEl("hr");
    this.controls.createEl("h3", { text: "Save" });
    this.controls.createEl("p", { text: `Format: ${this.format.toUpperCase()} (preserved). Save replaces ${this.file.path} for every note using it.`, cls: "image-toolkit-hint" });
    if (this.format !== "png") this.range(this.controls, "Quality", 10, 100, this.quality, 1, (v) => {
      this.quality = v;
      this.refreshOutputSize();
    });
    this.controls.createEl("p", { text: this.options.backupEnabled ? `A backup is saved to ${this.options.backupFolder} before every overwrite.` : "Backups are disabled in Image Toolkit settings. Saving permanently replaces the image.", cls: "image-toolkit-hint" });
  }
  resizeControls() {
    this.controls.createEl("h3", { text: "Resize" });
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
    this.button(this.controls, "Apply resize", () => this.exclusive(async () => {
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
    this.controls.createEl("h3", { text: "Crop / straighten" });
    this.select(this.controls, "Mode", { rectangle: "Rectangle crop", board: "Board" }, this.mode, (v) => {
      this.mode = v;
      this.renderControls();
      this.draw();
    });
    this.controls.createEl("p", { text: "Drag anywhere away from a corner to draw an initial rectangle. Then drag each corner to match the board perspective. Arrow keys nudge a selected corner (Shift: 10px). Apply before saving." });
    this.button(this.controls, "Reset corners", () => {
      this.resetCorners();
      this.draw();
      this.scheduleBoardPreview();
    });
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
      this.controls.createEl("small", { text: "Aspect presets initialize a centered crop; dragging remains freeform." });
    } else {
      this.select(this.controls, "Board background", { white: "White \u2014 dark writing", black: "Black \u2014 light writing" }, this.boardBackground, (v) => {
        this.boardBackground = v;
        this.scheduleBoardPreview();
      });
      this.range(this.controls, "Enhancement strength", 0, 100, Math.round(this.strength * 100), 1, (v) => {
        this.strength = v / 100;
        this.scheduleBoardPreview();
      });
      this.number(this.controls, "Output width (0 = automatic)", this.boardWidth, (v) => {
        this.boardWidth = v;
        this.scheduleBoardPreview();
      }, 0);
      this.number(this.controls, "Output height (0 = automatic)", this.boardHeight, (v) => {
        this.boardHeight = v;
        this.scheduleBoardPreview();
      }, 0);
      this.controls.createEl("small", { text: "Set either dimension to preserve the estimated ratio, or both to choose an exact rectangle. Preview is reduced-resolution. Enhancement cannot recover glare or blur." });
      this.boardPreview = this.controls.createEl("canvas", { cls: "image-toolkit-board-preview", attr: { "aria-label": "Rectified board preview" } });
      this.scheduleBoardPreview();
    }
    this.magnifier = this.controls.createEl("canvas", { cls: "image-toolkit-magnifier", attr: { "aria-label": "Selected corner magnifier" } });
    this.magnifier.width = 160;
    this.magnifier.height = 120;
    this.button(this.controls, "Apply crop / board correction", () => this.exclusive(() => this.applyCrop()), true);
    const transforms = this.controls.createDiv("image-toolkit-transform");
    this.button(transforms, "Rotate \u21B6", () => this.transform("left"));
    this.button(transforms, "Rotate \u21B7", () => this.transform("right"));
    this.button(transforms, "Flip \u2194", () => this.transform("horizontal"));
    this.button(transforms, "Flip \u2195", () => this.transform("vertical"));
  }
  annotationControls() {
    this.controls.createEl("h3", { text: "Annotations" });
    this.select(this.controls, "Tool", { pen: "Pen", highlighter: "Highlighter", arrow: "Arrow", rectangle: "Rectangle", ellipse: "Ellipse", text: "Text", select: "Select / move" }, this.markTool, (v) => {
      this.markTool = v;
      this.selected = -1;
      this.draw();
    });
    const color = this.label(this.controls, "Color").createEl("input", { type: "color", value: this.color });
    color.addEventListener("input", () => {
      this.color = color.value;
    });
    this.range(this.controls, "Stroke width", 1, 40, this.lineWidth, 1, (v) => {
      this.lineWidth = v;
    });
    this.range(this.controls, "Text size", 10, 120, this.fontSize, 1, (v) => {
      this.fontSize = v;
    });
    this.controls.createEl("p", { text: "Drag to draw. Text prompts on click. Select / move: click an object, drag to move it, Delete to remove it. Raster operations flatten annotations; Undo restores them." });
    this.button(this.controls, "Delete selected", () => this.removeSelected());
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
      this.selected = -1;
      for (let i = this.marks.length - 1; i >= 0; i--) {
        const b = this.bounds(this.marks[i]), pad = 10 * this.working.width / this.preview.getBoundingClientRect().width;
        if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
          this.selected = i;
          break;
        }
      }
      if (this.selected >= 0) this.dragging = { mark: this.selected, point: p, originalPoints: clone(this.marks[this.selected].points) };
      this.draw();
      return;
    }
    if (this.markTool === "text") {
      this.askText().then((text) => {
        if (text && !this.closed) {
          this.marks.push({ kind: "text", points: [p], text, color: this.color, width: this.fontSize });
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
    if (!this.dragging || this.busy) return;
    const p = this.position(e), d = this.dragging;
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
      } else if (d.originalPoints) {
        const dx = p.x - d.point.x, dy = p.y - d.point.y;
        mark.points = d.originalPoints.map((v) => ({ x: v.x + dx, y: v.y + dy }));
      }
      this.draw();
    }
  }
  pointerUp() {
    const annotation = this.dragging?.mark !== void 0;
    this.dragging = void 0;
    if (annotation) void this.run(() => this.exclusive(async () => {
      await this.checkpoint();
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
      const b = this.bounds(this.marks[this.selected]);
      c.strokeStyle = "#00b8ff";
      c.lineWidth = 2 * unit;
      c.setLineDash([6 * unit, 4 * unit]);
      c.strokeRect(b.x - 4 * unit, b.y - 4 * unit, b.w + 8 * unit, b.h + 8 * unit);
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
        c.font = `${mark.width}px sans-serif`;
        c.textBaseline = "top";
        c.fillText(mark.text || "", a.x, a.y);
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
    if (mark.kind === "text") {
      const c = ctx(this.working);
      c.font = `${mark.width}px sans-serif`;
      return { x: mark.points[0].x, y: mark.points[0].y, w: c.measureText(mark.text || "").width, h: mark.width * 1.2 };
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of mark.points) {
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
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
    this.marks = [];
    this.selected = -1;
    this.resetCorners();
    await this.checkpoint();
    this.renderControls();
    this.draw();
    this.refreshOutputSize();
    this.status.setText(`Applied: ${out.width} \xD7 ${out.height}. Annotations flattened into the raster; Undo restores the previous state.`);
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
  async outputBlob() {
    const out = this.composite(this.format === "jpg" ? "#fff" : void 0);
    const type = `image/${this.format === "jpg" ? "jpeg" : this.format}`;
    const blob = await encode(out, type, this.quality / 100);
    if (blob.type !== type) throw new Error(`This Obsidian version cannot encode ${this.format.toUpperCase()}. The original was not overwritten.`);
    return blob;
  }
  invalidateEncodedPreview() {
    this.encodedPreview?.close();
    this.encodedPreview = void 0;
    this.previewCaption?.setText("Updating encoded preview\u2026");
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
        this.previewCaption.setText(`Encoded preview: ${this.format.toUpperCase()}${this.format === "png" ? " (lossless)" : ` \xB7 quality ${this.quality}`} \xB7 100% zoom fits the image`);
        const diff = Math.round((blob.size / this.original.byteLength - 1) * 100);
        this.outputInfo.setText(`${this.working.width} \xD7 ${this.working.height} \xB7 ${this.bytes(blob.size)} (${diff >= 0 ? "+" : ""}${diff}% vs original)${diff > 0 ? " \u2014 larger" : ""}`);
      } while (this.estimateAgain && !this.closed);
    } finally {
      this.estimating = false;
    }
  }
  bytes(n) {
    return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
  }
  async compare() {
    const modal = new import_obsidian.Modal(this.app);
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
  askText() {
    return new Promise((resolve) => {
      const modal = new import_obsidian.Modal(this.app);
      modal.titleEl.setText("Annotation text");
      const input = modal.contentEl.createEl("input", { type: "text", attr: { placeholder: "Enter text", "aria-label": "Annotation text" } });
      let result = null;
      const add = modal.contentEl.createEl("button", { text: "Add text", cls: "mod-cta" });
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
  async save() {
    await this.exclusive(async () => {
      if (this.closed) return;
      const blob = await this.outputBlob();
      if (this.closed) return;
      const output = await blob.arrayBuffer();
      if (this.closed) return;
      const result = await saveImage(this.app, this.file, this.original, output, { backupEnabled: this.options.backupEnabled, backupFolder: this.options.backupFolder });
      new import_obsidian.Notice(`Replaced ${result.path}${result.backupPath ? `
Backup: ${result.backupPath}` : ""}`, 8e3);
      this.close();
    });
  }
};

// src/main.ts
var DEFAULTS = { quality: 85, backupEnabled: true, backupFolder: "Image Toolkit Backups" };
var ImageToolkit = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.documents = /* @__PURE__ */ new WeakSet();
    this.menuHandled = false;
    this.imageClick = false;
    this.extendedMenus = /* @__PURE__ */ new WeakSet();
    this.menuTimers = /* @__PURE__ */ new Set();
    this.editors = /* @__PURE__ */ new Set();
  }
  async onload() {
    const saved = await this.loadData() || {};
    this.settings = {
      quality: Number.isFinite(saved.quality) ? Math.max(10, Math.min(100, saved.quality)) : DEFAULTS.quality,
      backupEnabled: typeof saved.backupEnabled === "boolean" ? saved.backupEnabled : DEFAULTS.backupEnabled,
      backupFolder: typeof saved.backupFolder === "string" ? saved.backupFolder : DEFAULTS.backupFolder
    };
    this.register(() => {
      for (const timer of this.menuTimers) window.clearTimeout(timer);
      this.menuTimers.clear();
    });
    this.addSettingTab(new ToolkitSettings(this.app, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof import_obsidian2.TFile && supportedExtension(file.path)) {
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
      else new import_obsidian2.Notice("Place the cursor on a local JPEG, PNG or WebP embed.");
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
          const menu = new import_obsidian2.Menu();
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
    const actions = [
      ["Edit image\u2026", "compress", "image"],
      ["Compress\u2026", "compress", "minimize-2"],
      ["Resize\u2026", "resize", "scaling"],
      ["Crop / straighten\u2026", "crop", "crop"],
      ["Annotate\u2026", "annotate", "pencil"]
    ];
    menu.addSeparator();
    for (const [title, tool, icon] of actions) menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(() => this.open(context, tool)));
  }
  open(context, tool) {
    const options = { tool, quality: this.settings.quality, backupEnabled: this.settings.backupEnabled, backupFolder: this.settings.backupFolder, pluginDir: this.manifest.dir };
    const editor = new ImageEditor(this.app, context.file, options, () => this.editors.delete(editor));
    this.editors.add(editor);
    editor.open();
  }
};
var ToolkitSettings = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Image Toolkit" });
    new import_obsidian2.Setting(this.containerEl).setName("Default quality").setDesc("JPEG / WebP only. PNG is lossless.").addSlider((slider) => slider.setLimits(10, 100, 1).setValue(this.plugin.settings.quality).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.quality = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("Back up before overwriting").setDesc("Every Save replaces the original file. When enabled, preserve its previous bytes in the backup folder first. A failed backup cancels saving.").addToggle((toggle) => toggle.setValue(this.plugin.settings.backupEnabled).onChange(async (value) => {
      this.plugin.settings.backupEnabled = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("Backup folder").setDesc("Vault-relative folder. Source subfolders are mirrored and each overwrite gets a separate backup.").addText((text) => {
      text.setPlaceholder(DEFAULTS.backupFolder).setValue(this.plugin.settings.backupFolder);
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
    this.containerEl.createEl("p", { text: "Images are processed locally. Save always overwrites the same image path and preserves its format; all notes referencing it see the change. Backups are enabled by default. Desktop-only preview release." });
  }
};
