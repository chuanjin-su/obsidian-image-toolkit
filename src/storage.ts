import type { App, TFile } from "obsidian";

export function bytesEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

/** Normalize a vault-relative backup folder and reject paths that could leave the vault. */
export function normalizeBackupFolder(folder: string): string {
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

  const parts = slashPath.split("/").map(part => part.trim()).filter((part) => part !== "" && part !== ".");
  if (parts.some(part => /[:*?"<>|]/.test(part))) {
    throw new Error('Backup folder contains unsupported filename characters.');
  }
  if (parts.includes("..")) {
    throw new Error("Backup folder cannot contain '..' path segments.");
  }
  if (parts.length === 0) {
    throw new Error("Backup folder must not be empty.");
  }
  return parts.join("/");
}

function assertSourceStillPresent(app: App, source: TFile, expectedPath: string): void {
  if (source.path !== expectedPath || app.vault.getAbstractFileByPath(expectedPath) !== source) {
    throw new Error("The source image was removed or moved while it was being saved.");
  }
}

async function assertSourceUnchanged(
  app: App,
  source: TFile,
  expectedPath: string,
  originalBytes: ArrayBuffer,
): Promise<void> {
  assertSourceStillPresent(app, source, expectedPath);
  const currentBytes = await app.vault.readBinary(source);
  assertSourceStillPresent(app, source, expectedPath);
  if (!bytesEqual(currentBytes, originalBytes)) {
    throw new Error("The source image changed while it was being edited.");
  }
}

type FolderLike = { path: string; children?: unknown };

function isFolder(entry: unknown): entry is FolderLike {
  return typeof entry === "object" && entry !== null && Array.isArray((entry as FolderLike).children);
}

export async function ensureFolder(app: App, path: string, label = 'backup'): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing) {
      if (!isFolder(existing)) throw new Error(`Cannot create ${label} folder because '${current}' is a file.`);
      continue;
    }

    try {
      await app.vault.createFolder(current);
    } catch (error) {
      // A concurrently-created directory is fine, but never treat a file collision as success.
      const created = app.vault.getAbstractFileByPath(current);
      if (!isFolder(created)) throw error;
    }
    const created = app.vault.getAbstractFileByPath(current);
    if (!isFolder(created)) throw new Error(`Could not create ${label} folder '${current}'.`);
  }
}

function sourceParent(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function sourceFilename(path: string): { basename: string; extension: string } {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return { basename: filename, extension: "" };
  return { basename: filename.slice(0, dot), extension: filename.slice(dot) };
}

function isBackupCollision(app: App, path: string): boolean {
  return app.vault.getAbstractFileByPath(path) !== null;
}

async function createUniqueBackup(
  app: App,
  sourcePath: string,
  backupFolder: string,
  originalBytes: ArrayBuffer,
): Promise<{ path: string; file: TFile }> {
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

async function assertBackupWritten(
  app: App,
  backup: { path: string; file: TFile },
  originalBytes: ArrayBuffer,
): Promise<void> {
  if (backup.file.path !== backup.path || app.vault.getAbstractFileByPath(backup.path) !== backup.file) {
    throw new Error("The backup image could not be verified.");
  }
  const backupBytes = await app.vault.readBinary(backup.file);
  if (
    backup.file.path !== backup.path ||
    app.vault.getAbstractFileByPath(backup.path) !== backup.file ||
    !bytesEqual(backupBytes, originalBytes)
  ) {
    throw new Error("The backup image could not be verified.");
  }
}

// Editor saves and recoveries share this queue, even across separate dialogs.
const imageSaveQueues = new WeakMap<App['vault'], WeakMap<TFile, Promise<void>>>();

async function withImageSaveLock<T>(app: App, source: TFile, action: () => Promise<T>): Promise<T> {
  let queue = imageSaveQueues.get(app.vault);
  if (!queue) { queue = new WeakMap();imageSaveQueues.set(app.vault, queue); }
  const previous = queue.get(source) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  queue.set(source, current);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (queue.get(source) === current) queue.delete(source);
  }
}

export async function saveImage(
  app: App,
  source: TFile,
  originalBytes: ArrayBuffer,
  output: ArrayBuffer,
  options: { backupEnabled: boolean; backupFolder: string },
): Promise<{ path: string; backupPath?: string }> {
  if (output.byteLength === 0) throw new Error("Cannot save an empty image.");

  const sourcePath = source.path;
  const originalSnapshot = originalBytes.slice(0);
  const outputSnapshot = output.slice(0);
  const preferences = { ...options };
  return withImageSaveLock(app, source, async () => {
    // Check snapshots only after acquiring the lock, including when an earlier write failed.
    assertSourceStillPresent(app, source, sourcePath);
    if (!preferences.backupEnabled) {
      await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
      assertSourceStillPresent(app, source, sourcePath);
      await app.vault.modifyBinary(source, outputSnapshot.slice(0));
      return { path: sourcePath };
    }

    const backupFolder = normalizeBackupFolder(preferences.backupFolder);
    await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
    const backup = await createUniqueBackup(app, sourcePath, backupFolder, originalSnapshot);
    await assertBackupWritten(app, backup, originalSnapshot);
    // Keep a successfully-created backup if the source changed while the backup was written.
    await assertSourceUnchanged(app, source, sourcePath, originalSnapshot);
    assertSourceStillPresent(app, source, sourcePath);
    await app.vault.modifyBinary(source, outputSnapshot.slice(0));
    return { path: sourcePath, backupPath: backup.path };
  });
}
