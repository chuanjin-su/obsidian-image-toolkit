# Image Toolkit 0.2 — desktop beta

Local static JPEG/PNG/WebP editing in Obsidian.

## Install the beta
**BRAT:** add `chuanjin-su/obsidian-image-toolkit` and select **0.2.1** or newer. If already installed, check for updates in BRAT and reload Obsidian (or disable/re-enable Image Toolkit). If pinned to 0.2.0, change the selected version. Version 0.2.1 fixes the missing-worker error in Board/Adjust on BRAT installs.

**Manual:** download **image-toolkit-0.2.1.zip** from the [0.2.1 Beta release](https://github.com/chuanjin-su/obsidian-image-toolkit/releases/tag/0.2.1). Extract it and copy the enclosed `image-toolkit` folder into your vault's `.obsidian/plugins/`, then reload Obsidian and enable the plugin. Obsidian desktop 1.6.0+ is required.

For manual installation without the ZIP, download the three standard assets: `main.js`, `manifest.json`, and `styles.css`. The background worker is embedded in `main.js`; no extra worker file is needed. This is a prerelease; test with disposable images first. See [release notes](RELEASE_NOTES.md).

## Use
Reload the plugin (or Obsidian) after rebuilding. Enable **Image Toolkit** in Community plugins if needed. Right-click an image/file → **Edit image** (the only image-menu action), or run **Image Toolkit: Edit image at cursor**.

- **Zoom:** 100% fits both width and height. Higher values zoom relative to fit; scroll to pan.
- **Quality:** bottom-left beside dimensions and output size. After 300 ms the main canvas shows the encoded/decoded result. JPEG/WebP only; PNG remains lossless.
- **Resize:** set dimensions and click **Apply resize**.
- **Crop:** draw a rectangle, refine handles, then **Apply crop**. **Corner precision** starts open; **Output size** holds optional Board dimensions.
- **Board:** select Board, drag an initial rectangle, refine its four corners. Select white or black background. Enhancement starts at 0; increasing it applies scan-style background cleanup and stroke enhancement. Inspect the reduced preview before Apply.
- **Adjust:** exposure (±3 EV), brightness, contrast, saturation, warmth, and sharpening. Sliders preview after a 300 ms debounce; full-resolution processing/encoding can take longer on large images. **Reset sliders** discards the preview; **Apply** commits one undoable edit. Switching tools or saving also commits pending adjustments so they are not lost. Undo first clears an unapplied preview.
- **Annotate:** choose the icon buttons for selection, pen, highlighter, arrow, rectangle, ellipse or text. Select / move exposes corner resize handles (arrows use endpoints). Selected text supports resizing, font/color changes and **Edit text**. Raster operations flatten annotations; Undo restores them.
- **Save image:** always overwrites the original path and preserves its format. Rendered copies refresh immediately across open panes and pop-out windows, without reopening the note or changing its text. There is no copy/overwrite toggle or format-conversion option.
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
# Then: await runImageToolkitSmoke() // 14 editing / refresh / BRAT scenarios
# Ctrl-C, or POST /__stop, to stop the loopback server.
```

## Publish a beta
Update `manifest.json`, `package.json`, `package-lock.json`, `versions.json` and `RELEASE_NOTES.md` for the intended version. Push a tag matching `manifest.version` exactly (no `v` prefix). GitHub Actions validates, tests and builds the plugin, then publishes a **prerelease** containing the three standard plugin files, an installable ZIP and SHA-256 checksums. It does not publish stable releases.

Project tracking: vault-root **Image Toolkit** Markdown notes.
