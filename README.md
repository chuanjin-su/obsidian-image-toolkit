# Image Toolkit

An Obsidian plugin for editing local images, recovering backups, and organizing images pasted or dropped into notes. Image processing runs on your device.

## Install the beta

Requires Obsidian 1.6.0 or newer. Both installation methods work on desktop and phone. On a phone, choose a beta with mobile support.

- **With BRAT.** Install and enable BRAT from Community plugins. Run **BRAT: Add a beta plugin for testing**, enter `chuanjin-su/obsidian-image-toolkit`, and select a beta version. Enable **Image Toolkit** in Community plugins.
- **Manually.** Download `main.js`, `manifest.json`, and `styles.css` from the [GitHub releases page](https://github.com/chuanjin-su/obsidian-image-toolkit/releases). Place all three files in `.obsidian/plugins/image-toolkit/` in your vault, restart Obsidian, and enable **Image Toolkit**. You can also extract the release's `image-toolkit-<version>.zip` into `.obsidian/plugins/`.

## Edit an image on desktop

Right-click a local JPEG, PNG, or WebP image or file and choose **Edit image**. You can also place the cursor on an image embed and run **Image Toolkit: Edit image at cursor**.

- **Preview and compress.** Zoom starts at 100%, which fits the image to the available space. Zoom in and scroll to pan. The quality slider previews JPEG and WebP compression and shows the estimated output size. PNG stays lossless.
- **Resize and crop.** Enter dimensions and click **Apply resize**, or draw a selection, refine its handles, and click **Apply crop**. In **Board** mode, adjust the four corners independently to correct perspective. Choose a white or black background and use **Enhance** to clean up the background and strengthen strokes. **Corner precision** shows a close-up, and **Output size** sets optional Board dimensions.
- **Adjust color and detail.** Use **Adjust** for exposure, brightness, contrast, saturation, warmth, and sharpening. The sliders preview after 300 ms. **Apply** commits one undoable edit, and **Reset sliders** clears the preview. Switching tools or saving also commits pending adjustments.
- **Annotate.** Use the pen, highlighter, arrow, rectangle, ellipse, or text tools. The selection tool lets you move and resize marks or edit text. Raster edits flatten annotations into the image. Undo restores them.
- **Save the image.** **Save image** overwrites the original at the same path and preserves its format. Open notes that reference the image refresh automatically. **Cancel** discards unsaved edits.

The editor supports static JPEG, PNG, and WebP files up to 80 MB, 32 megapixels, and 8192 pixels per side. Edited images use the browser-decoded orientation and are saved without the original metadata. Undo history holds up to 12 states, trimming older states above roughly 64 MB of compressed image data while keeping the two most recent states.

## Back up and recover images on desktop

- **Set up backups.** Backups start off. The first save asks whether to back up originals and where to store them in the vault. **Continue & save** remembers your choice. Change it later under **Settings → Image Toolkit → Image editing**. When enabled, each overwrite saves a separate copy of the original bytes with the source subfolders mirrored. Saving stops if the backup fails.
- **Recover a version.** With backups enabled, right-click the image or file and choose **Recover image**. Select a version to preview it, then click **Restore selected version**. Restoring first saves and verifies a backup of the current image, then replaces it and refreshes open notes. To find versions in an older backup folder, set **Backup folder** back to that path.

## Manage inserted images

Open **Settings → Image Toolkit → Inserted images** and enable **Manage all inserted images**. This starts on for mobile installations without a saved preference and off for desktop installations without one. The default image folder is `_Asset/` at the vault root.

- **On a phone.** While editing a note, run **Image Toolkit: Insert images from device** from the command palette or add it to the mobile toolbar. Select one or more images. The plugin also handles pastes when the phone provides image files on the clipboard. Obsidian's built-in attachment picker uses Obsidian's own attachment settings.
- **On desktop.** Paste image files or drag them into the note from outside the vault.

The plugin saves the files to the configured folder and inserts embeds using Obsidian's link settings. Imports preserve the original bytes and extension, including for formats such as GIF and SVG. Turning management off returns pastes and drops to Obsidian's attachment handling. Existing vault images and links stay in place.

Set **Default image folder** using a vault-relative or note-relative path. The plugin creates missing folders, including nested folders.

| Path | Destination for `Notes/Example.md` |
| --- | --- |
| `./` | `Notes/` |
| `_Assets/` | `_Assets/` at the vault root |
| `./_Assets/` | `Notes/_Assets/` |
| `/` | Vault root |

Enable **Rename inserted images** to choose a **Filename preset** or enter a **Filename template**. Examples include `<original-name>-YYYY-MM-DD.<suffix>` and `<note-name>-YYYY-MM-DD-HHmmss.<suffix>`. Templates support `<original-name>`, `<note-name>`, `<suffix>`, `YYYY`, `MM`, `DD`, `HH`, `mm`, and `ss`. Dates and times are local, and templates must end with `.<suffix>`. Folder and template changes save when you leave the field. Filename collisions add `-1`, `-2`, and so on.

Mixed drops keep their order, with non-image files using Obsidian's attachment folder. Multi-cursor insertion uses Obsidian's native handling. If an edit overlaps a pending insertion or the note is switched or renamed during import, the plugin cancels the insertion. Files already saved remain in their attachment folder.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

- `src/main.ts` registers the plugin, settings, context menus, and editor command.
- `src/editor.ts`, `src/processing.ts`, and `src/processing-worker.ts` implement the editor and image processing.
- `src/insertions.ts` and `src/insertion-paths.ts` handle imports, folder paths, and filename templates.
- `src/storage.ts`, `src/recovery.ts`, and `src/refresh.ts` handle image saves, backups, recovery, and refreshing open embeds.
- `tests/` covers editing logic, path handling, backup and restore, and the bundled worker.

The build produces `main.js` at the repository root beside `manifest.json` and `styles.css`. Obsidian loads those three files directly. The processing worker is embedded in `main.js`. Reload the plugin or restart Obsidian after rebuilding. Run `npm run dev` to rebuild when source files change.

### Browser checks

Run `npm run test:browser` from the plugin directory, open `http://127.0.0.1:4178`, and wait for the editor to open with its generated test image. Run these checks in the browser console one at a time.

```js
await runImageToolkitLayoutChecks()
await runImageToolkitAdjustmentChecks()
await runImageToolkitAnnotationChecks()
await runImageToolkitBackupChecks()
await runImageToolkitRecoveryChecks()
await runImageToolkitSmoke()
```

Press Ctrl+C in the terminal to stop the harness.

## Publish a beta

Update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`. Push an annotated tag that matches the new manifest version and put the release notes in the tag message. GitHub Actions validates the versions, runs the checks, builds the plugin, and publishes the prerelease with those notes, the three plugin files, an installable ZIP, and SHA-256 checksums.
