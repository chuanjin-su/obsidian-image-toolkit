import assert from "node:assert/strict";
import test from "node:test";
import type { App, TFile } from "obsidian";
import { findImageBackups, restoreImageBackup, type ImageBackup } from "../src/recovery";
import { bytesEqual } from "../src/storage";

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
  failCreateBinary?: (path: string) => boolean;
  failRead?: (file: FakeFile) => boolean;
  afterCreate?: (path: string) => void | Promise<void>;
  readCount = 0;
  modifyCount = 0;

  addFile(path: string, bytes: ArrayBuffer): FakeFile {
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

  getFiles(): FakeFile[] {
    return [...this.entries.values()].filter((entry): entry is FakeFile => !("children" in entry));
  }

  async readBinary(file: FakeFile): Promise<ArrayBuffer> {
    this.readCount++;
    if (this.failRead?.(file)) throw new Error("Backup read failed.");
    if (this.entries.get(file.path) !== file) throw new Error("File does not exist.");
    return file.bytes.slice(0);
  }

  async createFolder(path: string): Promise<FakeFolder> {
    if (this.entries.has(path)) throw new Error("Folder already exists.");
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    if (parent && !this.isFolder(this.entries.get(parent))) throw new Error("Parent folder does not exist.");
    const folder = { path, children: [] };
    this.entries.set(path, folder);
    return folder;
  }

  async createBinary(path: string, bytes: ArrayBuffer): Promise<FakeFile> {
    if (this.failCreateBinary?.(path)) throw new Error("Backup disk write failed.");
    if (this.entries.has(path)) throw new Error("File already exists.");
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    if (parent && !this.isFolder(this.entries.get(parent))) throw new Error("Parent folder does not exist.");
    const file = this.addFile(path, bytes);
    await this.afterCreate?.(path);
    return file;
  }

  async modifyBinary(file: FakeFile, bytes: ArrayBuffer): Promise<void> {
    if (this.entries.get(file.path) !== file) throw new Error("File does not exist.");
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

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function jpeg(marker = 0): ArrayBuffer {
  return bytes(0xff, 0xd8, 0xff, marker);
}

function getFile(vault: FakeVault, path: string): FakeFile {
  const file = vault.entries.get(path);
  assert.ok(file && !("children" in file), `Expected a file at ${path}`);
  return file as FakeFile;
}

function getBackup(vault: FakeVault, source: FakeFile, path: string, backupFolder = "Archives"): ImageBackup {
  const version = findImageBackups(fakeApp(vault), source as unknown as TFile, backupFolder)
    .find((backup) => backup.path === path);
  assert.ok(version, `Expected discovered backup at ${path}`);
  return version;
}

test("discovery matches escaped basenames and exact mirrored paths, sorted by timestamp then collision", () => {
  const vault = new FakeVault();
  const source = vault.addFile("Albums/Trips/holiday+[1].photo.PNG", jpeg());
  const correct = "Archives/Albums/Trips/holiday+[1].photo-backup-";
  const expected = [
    `${correct}200-2.PNG`,
    `${correct}200-1.PNG`,
    `${correct}200.PNG`,
    `${correct}199.PNG`,
  ];
  for (const path of [
    `${correct}199.PNG`,
    `${correct}200.PNG`,
    `${correct}200-1.PNG`,
    `${correct}200-2.PNG`,
    "Archives/Albums/Trips/holidayX1.photo-backup-999.PNG",
    "Archives/Albums/Trips/holiday+[1].photo-backup-201.jpg",
    "Archives/Albums/Tripster/holiday+[1].photo-backup-999.PNG",
    "Other/Albums/Trips/holiday+[1].photo-backup-999.PNG",
    "Archives/Albums/Trips/Nested/holiday+[1].photo-backup-999.PNG",
    `${correct}0201.PNG`,
    `${correct}201-0.PNG`,
    `${correct}201-extra.PNG`,
    `${correct}9007199254740991.PNG`,
    `${correct}9007199254740992.PNG`,
  ]) vault.addFile(path, jpeg());
  vault.addFile("Archives/Albums/Trips/holiday+[1]Xphoto-backup-999.PNG", jpeg());

  const backups = findImageBackups(fakeApp(vault), source as unknown as TFile, "Archives//./");
  assert.deepEqual(backups.map((backup) => backup.path), expected);
  assert.deepEqual(backups.map(({ timestamp, collision }) => [timestamp, collision]), [
    [200, 2], [200, 1], [200, 0], [199, 0],
  ]);
});

test("same basenames in different source parents discover only their own mirrored backups", () => {
  const vault = new FakeVault();
  const first = vault.addFile("One/photo.jpg", jpeg(1));
  vault.addFile("Two/photo.jpg", jpeg(2));
  const firstBackup = "Archives/One/photo-backup-123.jpg";
  const secondBackup = "Archives/Two/photo-backup-123.jpg";
  vault.addFile(firstBackup, jpeg(3));
  vault.addFile(secondBackup, jpeg(4));

  assert.deepEqual(
    findImageBackups(fakeApp(vault), first as unknown as TFile, "Archives").map((item) => item.path),
    [firstBackup],
  );
});

test("restoration writes selected bytes and keeps both the selected and newly preserved backups", async () => {
  const vault = new FakeVault();
  const sourceBytes = jpeg(9);
  const selectedBytes = jpeg(3);
  const source = vault.addFile("Album/photo.JPEG", sourceBytes);
  const selectedPath = "Archives/Album/photo-backup-123.JPEG";
  const selectedFile = vault.addFile(selectedPath, selectedBytes);
  const version = getBackup(vault, source, selectedPath);

  const result = await restoreImageBackup(
    fakeApp(vault), source as unknown as TFile, version, sourceBytes, selectedBytes, "Archives",
  );

  assert.deepEqual(result.path, source.path);
  assert.ok(result.backupPath);
  assert.match(result.backupPath, /^Archives\/Album\/photo-backup-\d+(?:-\d+)?\.JPEG$/);
  assert.equal(bytesEqual(source.bytes, selectedBytes), true);
  assert.equal(bytesEqual(getFile(vault, selectedPath).bytes, selectedBytes), true);
  assert.equal(bytesEqual(getFile(vault, result.backupPath).bytes, sourceBytes), true);
  assert.equal(getFile(vault, selectedPath), selectedFile);
  assert.equal(vault.modifyCount, 1);
});

test("invalid, missing, or moved versions cannot be restored", async (t) => {
  await t.test("a version from another source is rejected", async () => {
    const vault = new FakeVault();
    const source = vault.addFile("One/photo.jpg", jpeg(1));
    const other = vault.addFile("Two/photo.jpg", jpeg(2));
    const otherPath = "Archives/Two/photo-backup-1.jpg";
    vault.addFile(otherPath, jpeg(3));
    const otherVersion = getBackup(vault, other, otherPath);
    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, otherVersion, source.bytes, jpeg(3), "Archives"),
      /no longer available/,
    );
    assert.equal(vault.modifyCount, 0);
  });

  await t.test("a forged identity or metadata is rejected", async () => {
    const vault = new FakeVault();
    const source = vault.addFile("photo.jpg", jpeg(1));
    const path = "Archives/photo-backup-10.jpg";
    vault.addFile(path, jpeg(2));
    const version = getBackup(vault, source, path);
    const forged = { ...version, timestamp: 11 };
    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, forged, source.bytes, jpeg(2), "Archives"),
      /no longer available/,
    );
    assert.equal(vault.modifyCount, 0);
  });

  await t.test("a missing version is rejected", async () => {
    const vault = new FakeVault();
    const source = vault.addFile("photo.jpg", jpeg(1));
    const path = "Archives/photo-backup-10.jpg";
    vault.addFile(path, jpeg(2));
    const version = getBackup(vault, source, path);
    vault.entries.delete(path);
    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, source.bytes, jpeg(2), "Archives"),
      /no longer available/,
    );
    assert.equal(vault.modifyCount, 0);
  });

  await t.test("a moved version is rejected", async () => {
    const vault = new FakeVault();
    const source = vault.addFile("photo.jpg", jpeg(1));
    const path = "Archives/photo-backup-10.jpg";
    const file = vault.addFile(path, jpeg(2));
    const version = getBackup(vault, source, path);
    vault.entries.delete(path);
    file.path = "Elsewhere/photo-backup-10.jpg";
    vault.entries.set(file.path, file);
    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, source.bytes, jpeg(2), "Archives"),
      /no longer available/,
    );
    assert.equal(vault.modifyCount, 0);
  });
});

test("changed backup bytes are rejected without changing the source", async () => {
  const vault = new FakeVault();
  const sourceBytes = jpeg(1);
  const previewBytes = jpeg(2);
  const source = vault.addFile("photo.jpg", sourceBytes);
  const path = "Archives/photo-backup-10.jpg";
  const backup = vault.addFile(path, previewBytes);
  const version = getBackup(vault, source, path);
  backup.bytes = jpeg(3);

  await assert.rejects(
    restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, previewBytes, "Archives"),
    /changed after it was previewed/,
  );
  assert.equal(bytesEqual(source.bytes, sourceBytes), true);
  assert.equal(vault.modifyCount, 0);
});

test("invalid or wrong-format backup bytes are rejected before preserving or replacing the source", async () => {
  const vault = new FakeVault();
  const sourceBytes = jpeg(1);
  const source = vault.addFile("photo.png", bytes(0, 1, 2));
  const invalidBytes = bytes(0, 1, 2);
  const path = "Archives/photo-backup-10.png";
  vault.addFile(path, invalidBytes);
  const version = getBackup(vault, source, path);

  await assert.rejects(
    restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, invalidBytes, "Archives"),
    /Invalid PNG/,
  );
  assert.equal(bytesEqual(source.bytes, bytes(0, 1, 2)), true);
  assert.equal(vault.modifyCount, 0);
  assert.equal(vault.getFiles().filter((file) => file.path.includes("photo-backup-")).length, 1);
});

test("source conflict checks use the modal-open snapshot", async () => {
  const vault = new FakeVault();
  const modalSnapshot = jpeg(1);
  const changedSource = jpeg(2);
  const source = vault.addFile("photo.jpg", changedSource);
  const selectedBytes = jpeg(3);
  const path = "Archives/photo-backup-10.jpg";
  vault.addFile(path, selectedBytes);
  const version = getBackup(vault, source, path);

  await assert.rejects(
    restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, modalSnapshot, selectedBytes, "Archives"),
    /changed while it was being edited/,
  );
  assert.equal(bytesEqual(source.bytes, changedSource), true);
  assert.equal(vault.modifyCount, 0);
  assert.equal(vault.getFiles().filter((file) => file.path.includes("photo-backup-")).length, 1);
});

test("backup read and backup creation failures abort restoration", async (t) => {
  await t.test("reading the selected backup fails", async () => {
    const vault = new FakeVault();
    const sourceBytes = jpeg(1);
    const source = vault.addFile("photo.jpg", sourceBytes);
    const selectedBytes = jpeg(2);
    const path = "Archives/photo-backup-10.jpg";
    const backup = vault.addFile(path, selectedBytes);
    const version = getBackup(vault, source, path);
    vault.failRead = (file) => file === backup;

    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, selectedBytes, "Archives"),
      /Backup read failed/,
    );
    assert.equal(bytesEqual(source.bytes, sourceBytes), true);
    assert.equal(vault.modifyCount, 0);
    assert.equal(vault.getFiles().filter((file) => file.path.includes("photo-backup-")).length, 1);
  });

  await t.test("creating the source-preservation backup fails", async () => {
    const vault = new FakeVault();
    const sourceBytes = jpeg(1);
    const source = vault.addFile("photo.jpg", sourceBytes);
    const selectedBytes = jpeg(2);
    const selectedPath = "Archives/photo-backup-10.jpg";
    vault.addFile(selectedPath, selectedBytes);
    const version = getBackup(vault, source, selectedPath);
    vault.failCreateBinary = (path) => path !== selectedPath;

    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, selectedBytes, "Archives"),
      /disk write failed/,
    );
    assert.equal(bytesEqual(source.bytes, sourceBytes), true);
    assert.equal(vault.modifyCount, 0);
    assert.equal(bytesEqual(getFile(vault, selectedPath).bytes, selectedBytes), true);
  });

  await t.test("an unverifiable source-preservation backup prevents restoration", async () => {
    const vault = new FakeVault();
    const sourceBytes = jpeg(1);
    const source = vault.addFile("photo.jpg", sourceBytes);
    const selectedBytes = jpeg(2);
    const selectedPath = "Archives/photo-backup-10.jpg";
    vault.addFile(selectedPath, selectedBytes);
    const version = getBackup(vault, source, selectedPath);
    vault.afterCreate = (path) => {
      if (path !== selectedPath) getFile(vault, path).bytes = jpeg(9);
    };

    await assert.rejects(
      restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, selectedBytes, "Archives"),
      /backup image could not be verified/,
    );
    assert.equal(bytesEqual(source.bytes, sourceBytes), true);
    assert.equal(vault.modifyCount, 0);
    assert.equal(bytesEqual(getFile(vault, selectedPath).bytes, selectedBytes), true);
  });
});

test("source changes while its preservation backup is written abort the overwrite", async () => {
  const vault = new FakeVault();
  const sourceBytes = jpeg(1);
  const changedBytes = jpeg(4);
  const source = vault.addFile("photo.jpg", sourceBytes);
  const selectedBytes = jpeg(2);
  const selectedPath = "Archives/photo-backup-10.jpg";
  vault.addFile(selectedPath, selectedBytes);
  const version = getBackup(vault, source, selectedPath);
  vault.afterCreate = (path) => {
    if (path !== selectedPath) source.bytes = changedBytes.slice(0);
  };

  await assert.rejects(
    restoreImageBackup(fakeApp(vault), source as unknown as TFile, version, sourceBytes, selectedBytes, "Archives"),
    /changed while it was being edited/,
  );
  assert.equal(bytesEqual(source.bytes, changedBytes), true);
  assert.equal(vault.modifyCount, 0);
  assert.equal(bytesEqual(getFile(vault, selectedPath).bytes, selectedBytes), true);
  const preserved = vault.getFiles().find((file) => file.path !== selectedPath && file.path.includes("photo-backup-"));
  assert.ok(preserved);
  assert.equal(bytesEqual(preserved.bytes, sourceBytes), true);
});
