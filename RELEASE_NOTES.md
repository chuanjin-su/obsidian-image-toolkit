# Image Toolkit 0.2.0 Beta

Local image editing for **Obsidian desktop 1.6.0+**. This is a prerelease: native Obsidian acceptance testing across themes, menus and pop-out windows is still pending.

## Highlights
- Compression with an actual encoded-quality preview and output-size estimate.
- Resize, crop, rotate and flip; four-corner perspective correction with white/black board cleanup.
- A basic **Adjust** tab: exposure, brightness, contrast, saturation, warmth and sharpening, with preview, reset, apply and undo/redo.
- Annotation icons with movable/resizable shapes, arrow endpoints and editable text.
- Compact window-bounded layout with persistent Save/Apply; Board and Corner precision previews stack vertically.
- One **Edit image** context-menu action, fit-relative zoom, and bounded undo history.

## Install
1. Download **image-toolkit-0.2.0.zip** and extract it.
2. Copy the enclosed **image-toolkit** folder into your vault's **.obsidian/plugins/** folder.
3. Reload Obsidian and enable **Image Toolkit** in Settings → Community plugins.

Alternatively, put all four standalone assets—**main.js**, **manifest.json**, **styles.css**, and **processing-worker.js**—in **.obsidian/plugins/image-toolkit/**. The worker file is required. Do not install GitHub's automatic source-code ZIP as the plugin.

## Safety and limitations
- **Save overwrites the original image at the same path and preserves its format.** Every note using it sees the edit.
- Backups default **off**. First Save asks whether to enable backups and where to keep them; either choice is remembered. Test on disposable images and enable backups for important images.
- Processing is local. Supports static JPEG, PNG and WebP only; no RAW, GIF, SVG, APNG or animated WebP.
- Maximum 80 MB input, 32 MP and 8192 pixels per side. Metadata is not retained; large-image previews may take several seconds and substantial memory.
- Scan enhancement cannot recover clipped glare, blur or missing writing.

## Validation
78 unit tests, typecheck and production build pass. Browser checks cover 50 layouts, 10 adjustment, 12 editing, 7 backup and 6 annotation scenarios using in-memory vaults. These do not replace native Obsidian acceptance testing.

**SHA256SUMS.txt** provides checksums for the installable assets and ZIP.
