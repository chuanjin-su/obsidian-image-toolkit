# Image Toolkit 0.2.2 Beta

**Recover previous image versions and refresh edited images without reopening the note.**

## New and fixed
- **Recover image:** when backups are enabled, a new action appears directly below **Edit image**. Browse backups newest first with thumbnails, date/time, file size, pixel dimensions, format and filename. Select a version for a larger preview, then restore it.
- **Safe recovery:** restoring preserves the current image in a new verified backup first, keeps existing history and restores the selected bytes without re-encoding. Missing, moved or changed backups and source-image conflicts prevent recovery; a failed safety backup cancels the overwrite. Canceling the picker writes nothing.
- **Immediate refresh:** saving or recovering reloads matching rendered images across open panes, transcluded notes and pop-out windows, without rewriting note text or recreating the note view.
- **Concurrent-write protection:** saves and recoveries for the same image are serialized and recheck their source snapshots, preventing one operation from silently overwriting another.
- The processing worker remains embedded in `main.js`; no separate worker file is required for BRAT installations.

## Update with BRAT
Update Image Toolkit to **0.2.2** in BRAT, then reload Obsidian or disable/re-enable Image Toolkit. If pinned to an older beta, select 0.2.2. Existing settings, images and backups are preserved.

## Manual installation
Download **image-toolkit-0.2.2.zip**, extract it, and copy its **image-toolkit** folder into your vault\'s **.obsidian/plugins/** folder. Alternatively, install the three standalone assets: **main.js**, **manifest.json** and **styles.css**. Reload Obsidian and enable Image Toolkit. Do not use GitHub\'s automatic source-code ZIP as the plugin.

Requires **Obsidian desktop 1.6.0+**. This is a beta prerelease, not a stable release.

## Safety and limitations
- Saving and recovering replace the original image at the same path. Every note sharing that image sees the change. Test on disposable images first.
- Backups default **off**. First Save asks whether to enable them and where to keep them; either choice is remembered. Enable backups in Settings → Image Toolkit to show **Recover image**.
- Recovery searches only the currently configured backup folder and matches the original image path. If the backup folder changed, switch back to the earlier folder to find its versions. Renamed or moved source images are not automatically linked to their former history.
- Static JPEG/PNG/WebP only. Editing limits remain 80 MB input, 32 MP and 8192 pixels per side; edited exports do not retain metadata. Recovery restores backup bytes unchanged.
- Large images may take several seconds and substantial memory. Full native Obsidian acceptance across themes and pop-out windows remains pending.

## Validation
All **111 automated tests**, typecheck and production build pass. Browser validation covers **96 cases**: 50 layouts, 10 adjustments, 6 annotations, 7 backup onboarding, 9 recovery and 14 editing/refresh/BRAT checks. Recovery checks cover previews and metadata, exact-byte restoration, reversible safety backups, source/backup conflicts, write failures, cancellation and rendered-image refresh. Test resources are kept in memory; real fixture files are not written.

**SHA256SUMS.txt** provides checksums for the three plugin files and installable ZIP.
