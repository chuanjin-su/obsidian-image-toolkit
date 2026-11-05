import type { App, TFile } from 'obsidian';

let revision = 0;
const resourceKey = (url: string): string => url.split(/[?#]/, 1)[0];

/** Reload rendered copies of an overwritten image without touching note text or editor state. */
export function refreshImageViews(app: App, file: TFile, ownerDocument: Document): void {
  const resource = app.vault.getResourcePath(file);
  const key = resourceKey(resource);
  const fresh = new URL(resource);
  // mtime alone can be unchanged on rapid saves or coarse-grained filesystems.
  fresh.searchParams.set('image-toolkit', `${Date.now()}-${++revision}`);

  const documents = new Set<Document>([ownerDocument]);
  app.workspace.iterateAllLeaves(leaf => documents.add(leaf.view.containerEl.ownerDocument));
  // Include pop-out windows and transcluded notes; match the actual resource,
  // not a basename or an embed link resolved against the outer note.
  for (const doc of documents) {
    for (const img of doc.querySelectorAll('img')) {
      if (resourceKey(img.currentSrc || img.src) === key) img.src = fresh.href;
    }
  }
}
