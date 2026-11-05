import assert from "node:assert/strict";
import test from "node:test";
import type { App, TFile } from "obsidian";
import { bytesEqual, normalizeBackupFolder, saveImage } from "../src/storage";

interface FakeFile {
  path: string;
  basename: string;
  extension: string;
  bytes: ArrayBuffer;
}

interface FakeFolder {
  path: string;
  children: unknown[];
}

type FakeEntry = FakeFile | FakeFolder;

class FakeVault {
  entries = new Map<string, FakeEntry>();
  folderCreations: string[] = [];
  collisionPaths = new Set<string>();
  afterCreate?: (path: string) => void | Promise<void>;
  beforeRead?: (file: FakeFile, readNumber: number) => void;
  failCreateBinary?: (path: string) => boolean;
  readCount = 0;
  modifyCount = 0;

  addFile(path: string, bytes: ArrayBuffer = new ArrayBuffer(0)): FakeFile {
    this.addInitialFolders(path);
    const filename = path.slice(path.lastIndexOf("/") + 1);
    const dot = filename.lastIndexOf(".");
    const file: FakeFile = {
      path,
      basename: dot > 0 ? filename.slice(0, dot) : filename,
      extension: dot > 0 ? filename.slice(dot + 1) : "",
      bytes: bytes.slice(0),
    };
    this.entries.set(path, file);
    return file;
  }

  getAbstractFileByPath(path: string): FakeEntry | null {
    return this.entries.get(path) ?? null;
  }

  async readBinary(file: FakeFile): Promise<ArrayBuffer> {
    this.readCount++;
    this.beforeRead?.(file, this.readCount);
    if (this.entries.get(file.path) !== file) throw new Error("File does not exist");
    return file.bytes.slice(0);
  }

  async createFolder(path: string): Promise<FakeFolder> {
    if (this.entries.has(path) || this.collisionPaths.delete(path)) throw new Error("Folder already exists.");
    const slash = path.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : path.slice(0, slash);
    if (parentPath && !this.isFolder(this.entries.get(parentPath))) throw new Error("Parent folder does not exist.");
    const folder: FakeFolder = { path, children: [] };
    this.entries.set(path, folder);
    this.folderCreations.push(path);
    return folder;
  }

  async createBinary(path: string, bytes: ArrayBuffer): Promise<FakeFile> {
    if (this.failCreateBinary?.(path)) throw new Error("Backup disk write failed.");
    if (this.collisionPaths.delete(path) || this.entries.has(path)) throw new Error("File already exists.");
    const slash = path.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : path.slice(0, slash);
    if (parentPath && !this.isFolder(this.entries.get(parentPath))) throw new Error("Parent folder does not exist.");
    const file = this.addFile(path, bytes);
    await this.afterCreate?.(path);
    return file;
  }

  async modifyBinary(file: FakeFile, bytes: ArrayBuffer): Promise<void> {
    if (this.entries.get(file.path) !== file) throw new Error("File does not exist");
    this.modifyCount++;
    file.bytes = bytes.slice(0);
  }

  private addInitialFolders(path: string): void {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.entries.has(current)) this.entries.set(current, { path: current, children: [] });
    }
  }

  private isFolder(entry: FakeEntry | undefined): entry is FakeFolder {
    return !!entry && "children" in entry;
  }
}

function fakeApp(vault: FakeVault): App {
  return { vault } as unknown as App;
}

function arrayBuffer(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function fileAt(vault: FakeVault, path: string): FakeFile {
  const entry = vault.entries.get(path);
  assert.ok(entry && !("children" in entry), `Expected file at ${path}`);
  return entry as FakeFile;
}

test("bytesEqual compares all bytes and lengths", () => {
  assert.equal(bytesEqual(arrayBuffer(1, 2, 3), arrayBuffer(1, 2, 3)), true);
  assert.equal(bytesEqual(arrayBuffer(1, 2, 3), arrayBuffer(1, 2, 4)), false);
  assert.equal(bytesEqual(arrayBuffer(1), arrayBuffer(1, 0)), false);
});

test("backup folder normalization is vault-relative and rejects unsafe paths", () => {
  assert.equal(normalizeBackupFolder("Images\\\\//./Backups/"), "Images/Backups");
  assert.equal(normalizeBackupFolder("  My Backups  /./Images"), "My Backups/Images");

  for (const invalid of [
    "",
    "   ",
    ".",
    "./.",
    "a/../b",
    "a/ .. /b",
    " /vault/backups ",
    "a/b:c",
    "..\\secret",
    "/vault/backups",
    "\\vault\\backups",
    "//server/share",
    "\\\\server\\share",
    "C:\\vault\\backups",
    "C:/vault/backups",
    "C:relative",
    `a/\u0000/b`,
    `a/\u001f/b`,
    `a/\u007f/b`,
    `a/\u009f/b`,
  ]) {
    assert.throws(() => normalizeBackupFolder(invalid), { message: /Backup folder/ }, `Rejected ${JSON.stringify(invalid)}`);
  }
});

test("enabled backups recursively create folders and mirror the source parent", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1, 2, 3);
  const source = vault.addFile("Albums/Trips/photo.JPEG", original);
  const result = await saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(9), {
    backupEnabled: true,
    backupFolder: "Archives//./Images/",
  });

  assert.equal(result.path, "Albums/Trips/photo.JPEG");
  assert.ok(result.backupPath);
  assert.match(result.backupPath, /^Archives\/Images\/Albums\/Trips\/photo-backup-\d+\.JPEG$/);
  assert.deepEqual(vault.folderCreations, [
    "Archives",
    "Archives/Images",
    "Archives/Images/Albums",
    "Archives/Images/Albums/Trips",
  ]);
  assert.equal(bytesEqual(fileAt(vault, result.backupPath).bytes, original), true);
  assert.equal(bytesEqual(source.bytes, arrayBuffer(9)), true);
  assert.equal(vault.modifyCount, 1);
});

test("every enabled-backup save keeps a unique backup and overwrites the same path", async () => {
  const vault = new FakeVault();
  const firstBytes = arrayBuffer(1, 2);
  const secondBytes = arrayBuffer(3, 4);
  const source = vault.addFile("photo.JpG", firstBytes);

  const first = await saveImage(fakeApp(vault), source as unknown as TFile, firstBytes, secondBytes, {
    backupEnabled: true,
    backupFolder: "Backups",
  });
  const thirdBytes = arrayBuffer(5, 6);
  const second = await saveImage(fakeApp(vault), source as unknown as TFile, secondBytes, thirdBytes, {
    backupEnabled: true,
    backupFolder: "Backups",
  });

  assert.equal(first.path, "photo.JpG");
  assert.equal(second.path, "photo.JpG");
  assert.ok(first.backupPath && second.backupPath);
  assert.notEqual(first.backupPath, second.backupPath);
  assert.match(first.backupPath, /^Backups\/photo-backup-\d+(?:-\d+)?\.JpG$/);
  assert.equal(bytesEqual(fileAt(vault, first.backupPath).bytes, firstBytes), true);
  assert.equal(bytesEqual(fileAt(vault, second.backupPath).bytes, secondBytes), true);
  assert.equal(bytesEqual(source.bytes, thirdBytes), true);
  assert.equal(vault.modifyCount, 2);
  assert.equal([...vault.entries.values()].filter((entry) => !("children" in entry)).length, 3);
});

test("same-basename files in different parents have unambiguous backup paths", async () => {
  const vault = new FakeVault();
  const firstBytes = arrayBuffer(1);
  const secondBytes = arrayBuffer(2);
  const firstSource = vault.addFile("First/photo.png", firstBytes);
  const secondSource = vault.addFile("Second/photo.png", secondBytes);

  const first = await saveImage(fakeApp(vault), firstSource as unknown as TFile, firstBytes, arrayBuffer(3), {
    backupEnabled: true,
    backupFolder: "Backups",
  });
  const second = await saveImage(fakeApp(vault), secondSource as unknown as TFile, secondBytes, arrayBuffer(4), {
    backupEnabled: true,
    backupFolder: "Backups",
  });

  assert.ok(first.backupPath?.startsWith("Backups/First/"));
  assert.ok(second.backupPath?.startsWith("Backups/Second/"));
  assert.notEqual(first.backupPath, second.backupPath);
  assert.equal(bytesEqual(fileAt(vault, first.backupPath as string).bytes, firstBytes), true);
  assert.equal(bytesEqual(fileAt(vault, second.backupPath as string).bytes, secondBytes), true);
});

test("backup creation failure aborts the overwrite", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1, 2);
  const source = vault.addFile("folder/photo.png", original);
  vault.failCreateBinary = (path) => path.includes("photo-backup-");

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(8), {
      backupEnabled: true,
      backupFolder: "Backups",
    }),
    /disk write failed/,
  );
  assert.equal(vault.modifyCount, 0);
  assert.equal(bytesEqual(source.bytes, original), true);
});

test("a file blocking a backup folder aborts without overwriting the source", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1);
  const source = vault.addFile("photo.png", original);
  vault.addFile("Backups", arrayBuffer(7));

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(8), {
      backupEnabled: true,
      backupFolder: "Backups/Nested",
    }),
    /is a file/,
  );
  assert.equal(vault.modifyCount, 0);
  assert.equal(bytesEqual(source.bytes, original), true);
});

test("disabled backup overwrites in place without validating or creating the unused folder", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1, 2);
  const output = arrayBuffer(3, 4);
  const source = vault.addFile("folder/photo.PnG", original);

  const result = await saveImage(fakeApp(vault), source as unknown as TFile, original, output, {
    backupEnabled: false,
    backupFolder: "../not/a/valid/path",
  });

  assert.deepEqual(result, { path: "folder/photo.PnG" });
  assert.deepEqual(vault.folderCreations, []);
  assert.equal([...vault.entries.keys()].some((path) => path.includes("backup")), false);
  assert.equal(bytesEqual(source.bytes, output), true);
  assert.equal(vault.modifyCount, 1);
});

test("changed source bytes before backup creation prevent overwrite", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1, 2);
  const source = vault.addFile("photo.png", original);
  vault.beforeRead = (file, readNumber) => {
    if (file === source && readNumber === 1) source.bytes = arrayBuffer(7, 8);
  };

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(9), {
      backupEnabled: true,
      backupFolder: "Backups",
    }),
    /changed while it was being edited/,
  );
  assert.equal(vault.modifyCount, 0);
  assert.equal([...vault.entries.keys()].some((path) => path.includes("photo-backup-")), false);
});

test("source changes after backup creation are detected and the backup is retained", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1, 2);
  const source = vault.addFile("photo.png", original);
  vault.afterCreate = (path) => {
    if (path.includes("photo-backup-")) source.bytes = arrayBuffer(7, 8);
  };

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(9), {
      backupEnabled: true,
      backupFolder: "Backups",
    }),
    /changed while it was being edited/,
  );
  const backupPath = [...vault.entries.keys()].find((path) => path.includes("photo-backup-"));
  assert.ok(backupPath);
  assert.equal(bytesEqual(fileAt(vault, backupPath).bytes, original), true);
  assert.equal(bytesEqual(source.bytes, arrayBuffer(7, 8)), true);
  assert.equal(vault.modifyCount, 0);
});

test("source movement after backup creation is detected and leaves the backup intact", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1);
  const source = vault.addFile("folder/photo.png", original);
  vault.afterCreate = (path) => {
    if (!path.includes("photo-backup-")) return;
    vault.entries.delete(source.path);
    source.path = "moved/photo.png";
    vault.entries.set(source.path, source);
  };

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(2), {
      backupEnabled: true,
      backupFolder: "Backups",
    }),
    /removed or moved/,
  );
  assert.equal(vault.entries.get("moved/photo.png"), source);
  assert.equal(vault.modifyCount, 0);
  assert.equal([...vault.entries.keys()].some((path) => path.startsWith("Backups/folder/photo-backup-")), true);
});

test("empty output and a missing source are rejected", async () => {
  const vault = new FakeVault();
  const original = arrayBuffer(1);
  const source = vault.addFile("photo.png", original);

  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, new ArrayBuffer(0), {
      backupEnabled: false,
      backupFolder: "unused",
    }),
    /empty image/,
  );
  vault.entries.delete(source.path);
  await assert.rejects(
    saveImage(fakeApp(vault), source as unknown as TFile, original, arrayBuffer(2), {
      backupEnabled: false,
      backupFolder: "unused",
    }),
    /removed or moved/,
  );
  assert.equal(vault.modifyCount, 0);
});
