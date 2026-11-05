# Image Toolkit 0.2.1 Beta

**Fixes Board cropping and photo adjustments after installing with BRAT.**

Version 0.2.0 depended on a separate `processing-worker.js` that BRAT did not install, causing an ENOENT error. Version 0.2.1 embeds the complete worker in `main.js` and no longer reads any worker file from the vault. Processing still runs locally in a background Web Worker.

## Update with BRAT
Update Image Toolkit to **0.2.1** in BRAT, then reload Obsidian or disable/re-enable Image Toolkit. If your installation is pinned to 0.2.0, select 0.2.1. No manual worker download is needed; existing settings and images are preserved.

## Manual installation
Download **image-toolkit-0.2.1.zip**, extract it, and copy its **image-toolkit** folder into your vault's **.obsidian/plugins/** folder. Alternatively, install the three standalone assets: **main.js**, **manifest.json** and **styles.css**. Reload Obsidian and enable Image Toolkit. Do not use GitHub's automatic source-code ZIP as the plugin.

Requires **Obsidian desktop 1.6.0+**. This remains a prerelease.

## Included features
Compression and real encoded-quality previews; resize, crop, rotate and flip; Board perspective correction and white/black scan cleanup; basic photo adjustments; movable/resizable annotations; undo/redo; compact layout with pinned Save/Apply.

## Safety and limitations
- **Save overwrites the original image at the same path and preserves its format.** Every note using it sees the edit.
- Backups default **off**. First Save asks whether to enable them and where to keep them; either choice is remembered. Test on disposable images and enable backups for important images.
- Static JPEG/PNG/WebP only; maximum 80 MB input, 32 MP and 8192 pixels per side. Metadata is not retained.
- Large images may take several seconds and substantial memory. Enhancement cannot recover glare, blur or missing writing.
- Full native Obsidian acceptance across themes and pop-out windows remains pending.

## Validation
All 81 automated tests, typecheck and production build pass. Regression tests exercise the built production bundle with no separate worker available. Browser checks cover 50 layouts, 10 adjustment, 13 editing/BRAT, 7 backup and 6 annotation scenarios with worker-file reads forced to fail. No real fixture files are written.

**SHA256SUMS.txt** provides checksums for the three plugin files and installable ZIP.
