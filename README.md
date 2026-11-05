# Image Toolkit 0.2 — desktop preview

Local static JPEG/PNG/WebP editing in Obsidian.

## Use
Reload the plugin (or Obsidian) after rebuilding. Enable **Image Toolkit** in Community plugins if needed. Right-click an image/file → **Edit image** (the only image-menu action), or run **Image Toolkit: Edit image at cursor**.

- **Zoom:** 100% fits both width and height. Higher values zoom relative to fit; scroll to pan.
- **Quality:** bottom-left beside dimensions and output size. After 300 ms the main canvas shows the encoded/decoded result. JPEG/WebP only; PNG remains lossless.
- **Resize:** set dimensions and click **Apply resize**.
- **Crop:** draw a rectangle, refine handles, then **Apply crop**. **Corner precision** starts open; **Output size** holds optional Board dimensions.
- **Board:** select Board, drag an initial rectangle, refine its four corners. Select white or black background. Enhancement starts at 0; increasing it applies scan-style background cleanup and stroke enhancement. Inspect the reduced preview before Apply.
- **Adjust:** exposure (±3 EV), brightness, contrast, saturation, warmth, and sharpening. Sliders preview after a 300 ms debounce; full-resolution processing/encoding can take longer on large images. **Reset sliders** discards the preview; **Apply** commits one undoable edit. Switching tools or saving also commits pending adjustments so they are not lost. Undo first clears an unapplied preview.
- **Annotate:** choose the icon buttons for selection, pen, highlighter, arrow, rectangle, ellipse or text. Select / move exposes corner resize handles (arrows use endpoints). Selected text supports resizing, font/color changes and **Edit text**. Raster operations flatten annotations; Undo restores them.
- **Save image:** always overwrites the original path and preserves its format. All notes using that image see the change. There is no copy/overwrite toggle or format-conversion option.
- **First Save:** backups start **off**. A dialog asks whether to enable backups and which vault-relative folder to use. Continue remembers the choice; Cancel writes nothing. Change it later in Settings → Image Toolkit. When enabled, each overwrite gets a unique original-byte backup with source subfolders mirrored. A failed backup cancels saving. Legacy settings without the new confirmation marker ask again instead of silently retaining the former default-on behavior.
- Cancel before saving leaves files untouched. Crop/resize changes require Apply before Save.

## Compact layout
The modal stays within the window. Quality/result size sit bottom-left; Cancel/Save stay bottom-right. The preview takes the remaining height, and Apply stays pinned below the tool panel. Board preview is above the unfolded Corner precision preview; custom output size stays collapsed; tooltips replace long instructions. Compress uses the full preview width. Only zoomed images or expanded tool options scroll—not the modal page.

## Limits
Desktop preview; no GIF, SVG, APNG, animated WebP, in-plugin remote importer, RAW-file decoding or format conversion. Maximum 80 MB input, 32 MP decoded image, 8192 px per side. Browser-decoded EXIF orientation; metadata not retained. History capped at 12 states / roughly 64 MB compressed rasters (at least two kept). Full-resolution processing can still use substantial memory.

Enhancement cannot recover clipped glare, blur or missing writing; extreme shadows and very faint strokes still need visual judgment. Aspect presets initialize a ratio but do not lock subsequent dragging. Native Obsidian context-menu behavior varies by view/version and needs host acceptance testing.

## Develop
```sh
npm install
npm run typecheck
npm test
npm run build
npm run test:browser
# Open http://127.0.0.1:4178, wait for editor.
# Browser console: await runImageToolkitLayoutChecks() // 50 compact-layout cases
# Then: await runImageToolkitAdjustmentChecks() // 10 adjustment cases
# Then: await runImageToolkitAnnotationChecks() // 6 interaction cases
# Then: await runImageToolkitBackupChecks() // 7 onboarding cases
# Then: await runImageToolkitSmoke() // 12 editing scenarios
# Ctrl-C, or POST /__stop, to stop the loopback server.
```

The browser harness uses an in-memory vault and never writes the real fixture. Ship `manifest.json`, `main.js`, `styles.css`, `processing-worker.js`; exclude `node_modules`.

Project tracking: vault-root **Image Toolkit** Markdown notes.
