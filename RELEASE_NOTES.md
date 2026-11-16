# Image Toolkit 0.2.3 Beta

**Choose where pasted/dropped images are saved and how they are named.**

## New
- **Manage all inserted images:** an opt-in setting manages new image files pasted or dragged into note editors. Off by default, so existing installations retain Obsidian's attachment behavior.
- **Default image folder:** type `./` for the note's folder, `_Asset/` for a vault-root asset folder, `./_Asset/` for an asset folder beside the note, or `/` for the vault root. Nested folders are created automatically; unsafe paths are rejected.
- **Rename inserted images:** keep original filenames or choose a preset/custom template such as `<original-name>-YYYY-MM-DD.<suffix>`. Tokens include `<original-name>`, `<note-name>`, `<suffix>`, `YYYY`, `MM`, `DD`, `HH`, `mm`, and `ss`. Date/time is local; the original extension and image bytes are preserved.
- **Safe imports:** duplicate names receive numbered suffixes instead of overwriting existing files. Concurrent imports are serialized during path allocation and writing. Generated embeds follow Obsidian's link-format settings.
- **Mixed attachments:** image/non-image file batches keep their order. Non-images use Obsidian's attachment folder; PDFs/audio/video remain embedded.
- **Editing during import:** insertion ranges track surrounding edits without temporary note text or extra undo-history entries. Overlapping edits, note switching/renaming and plugin unload cancel pending insertion without replacing the user's text. Successfully saved files remain available in their attachment folder.
- Backup recovery, rendered-image refresh and the embedded processing worker remain available.

## Enable image management
After updating, open **Settings → Image Toolkit → Inserted images**, enable **Manage all inserted images**, and type a **Default image folder**. Optionally enable **Rename inserted images** and select a preset or edit the filename template. Templates must end with `.<suffix>`. Folder/template edits save when you leave the field.

## Update with BRAT
Update Image Toolkit to **0.2.3** in BRAT, then reload Obsidian or disable/re-enable Image Toolkit. If pinned to an older beta, select 0.2.3. Existing settings, images and backups are preserved. Image management and automatic renaming start disabled.

## Manual installation
Download **image-toolkit-0.2.3.zip**, extract it, and copy its **image-toolkit** folder into your vault's **.obsidian/plugins/** folder. Alternatively, install the three standalone assets: **main.js**, **manifest.json** and **styles.css**. Reload Obsidian and enable Image Toolkit. Do not use GitHub's automatic source-code ZIP as the plugin.

Requires **Obsidian desktop 1.6.0+**. This is a beta prerelease, not a stable release.

## Safety and limitations
- Image management applies to new file pastes/drops in note editors. It does not relocate existing vault images, download remote image URLs, or intercept file imports performed by other plugins. Multi-cursor insertion uses Obsidian's native handling.
- Import management accepts formats such as GIF and SVG without decoding them. The image editor still supports only static JPEG/PNG/WebP, with limits of 80 MB input, 32 MP and 8192 pixels per side. Edited exports do not retain metadata; imports preserve the original bytes.
- Saving/recovering an edited image replaces the original at the same path. Every note sharing it sees the change. Backups remain off until configured; enable them to show **Recover image**. Test on disposable images first.
- If an insertion is cancelled after files were saved, those files remain in the attachment folder; a notice explains this. Failed files in a partially successful batch must be retried.
- Native Obsidian acceptance of the new import settings remains pending; automated tests use a simulated host.

## Validation
All **135 automated tests**, TypeScript typecheck, production build, JavaScript syntax check and diff whitespace checks pass. New tests cover folder validation, filename tokens, settings migration, unchanged image bytes, concurrent filename collisions, mixed attachments, link formats, clipboard fallback, drops, failed imports, partial batches, in-flight settings snapshots, surrounding edits, note switching/renaming, multi-cursor fallback, undo-history behavior and plugin unload.

**SHA256SUMS.txt** provides checksums for the three plugin files and installable ZIP.
