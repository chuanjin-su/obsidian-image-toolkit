# Image Toolkit 0.2 — desktop preview

Local static JPEG/PNG/WebP editing in Obsidian.

## Use
Reload the plugin (or Obsidian) after rebuilding. Enable **Image Toolkit** in Community plugins if needed. Right-click an image/file → **Edit image…**, or run **Image Toolkit: Edit image at cursor**.

- **Zoom:** 100% fits both width and height. Higher values zoom relative to fit; scroll to pan.
- **Quality:** after 300 ms of inactivity the main canvas shows the actual encoded/decoded result. JPEG/WebP only; PNG remains lossless.
- **Resize:** set dimensions and click **Apply resize**.
- **Crop:** draw a rectangle, refine handles, then **Apply crop / board correction**.
- **Board:** select Board, drag an initial rectangle, refine its four corners. Select white or black background. Enhancement starts at 0; increasing it applies scan-style background cleanup and stroke enhancement. Inspect the reduced preview before Apply.
- **Annotate:** pen, highlighter, arrows, shapes, text; Select / move and Delete. Raster operations flatten annotations; Undo restores them.
- **Save image:** always overwrites the original path and preserves its format. All notes using that image see the change. There is no copy/overwrite toggle or format-conversion option.
- **Backups:** Settings → Image Toolkit → **Back up before overwriting** and **Backup folder**. Enabled by default in `Image Toolkit Backups`. Each overwrite gets a unique original-byte backup, with source subfolders mirrored. A failed backup cancels saving.
- Cancel before saving leaves files untouched. Crop/resize changes require Apply before Save.

## Limits
Desktop preview; no GIF, SVG, APNG, animated WebP, in-plugin remote importer or format conversion. Maximum 80 MB input, 32 MP decoded image, 8192 px per side. Browser-decoded EXIF orientation; metadata not retained. History capped at 12 states / roughly 64 MB compressed rasters (at least two kept). Full-resolution processing can still use substantial memory.

Enhancement cannot recover clipped glare, blur or missing writing; extreme shadows and very faint strokes still need visual judgment. Aspect presets initialize a ratio but do not lock subsequent dragging. Native Obsidian context-menu behavior varies by view/version and needs host acceptance testing.

## Develop
```sh
npm install
npm run typecheck
npm test
npm run build
npm run test:browser
# Open http://127.0.0.1:4178, wait for editor.
# Browser console: await runImageToolkitSmoke()
# Ctrl-C, or POST /__stop, to stop the loopback server.
```

The browser harness uses an in-memory vault and never writes the real fixture. Ship `manifest.json`, `main.js`, `styles.css`, `processing-worker.js`; exclude `node_modules`.

Project tracking: vault-root **Image Toolkit** Markdown notes.
