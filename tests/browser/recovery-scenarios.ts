import { saveImage, bytesEqual } from '../../src/storage';
import { findImageBackups } from '../../src/recovery';
import { assert, until, withFixture } from './fixture';

export async function runRecoveryChecks() { return withFixture(async (g, doc) => {
  const checks: string[] = [], app = g.app, folder = 'Recovery Backups';
  g.editor.close();
  const png = async (width: number, height: number, color: string) => {
    const canvas = doc.createElement('canvas');canvas.width = width;canvas.height = height;
    const context = canvas.getContext('2d')!;context.fillStyle = color;context.fillRect(0, 0, width, height);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return blob.arrayBuffer();
  };
  const first = await png(3, 2, 'red'), second = await png(4, 3, 'blue'), current = await png(7, 5, 'green');
  const source = await app.vault.createBinary('Recovery Fixtures/photo.png', first);
  await saveImage(app, source, first, second, { backupEnabled: true, backupFolder: folder });
  await saveImage(app, source, second, current, { backupEnabled: true, backupFolder: folder });
  const baseline = findImageBackups(app, source, folder);
  const open = async (backupFolder = folder) => {
    const modal = new g.ImageRecovery(app, source, backupFolder);modal.open();
    await until(() => modal.rows.length > 0 || modal.contentEl.textContent.includes('No backups found'), 'Recovery did not load');
    return modal;
  };
  const select = async (modal: any, index: number) => {
    modal.rows[index].click();
    await until(() => !!modal.selected || modal.status.classList.contains('image-toolkit-error'), 'Backup preview did not load');
    assert(!!modal.selected, `Cannot select backup: ${modal.status.textContent}`);
  };
  let modal = await open('No Such Backups');
  assert(modal.restoreButton.disabled && modal.contentEl.textContent.includes('No backups found'), 'Empty history must disable Restore');
  modal.close();checks.push('empty backup history is explained without writing files');

  modal = await open();
  await until(() => [...modal.contentEl.querySelectorAll('.image-toolkit-recovery-version img')].every((img: any) => img.complete && img.naturalWidth > 0), 'Version thumbnails did not decode');
  const text = modal.contentEl.textContent;
  assert(modal.rows.length === 2 && text.includes('4 × 3 px') && text.includes('3 × 2 px') && text.includes('bytes') && text.includes('PNG'), 'Rows show all dimensions, byte sizes, formats');
  assert(modal.rows[0].title === baseline[0].path, 'Newest version first');checks.push('newest-first versions with thumbnails, dates, dimensions, sizes, formats and paths');
  await select(modal, 0);
  assert(modal.preview.naturalWidth === 4 || modal.details.textContent.includes('4 × 3 px'), 'Newest backup preview must match saved dimensions');
  const firstUrl = modal.selectedUrl;
  await select(modal, 1);
  assert(modal.details.textContent.includes('3 × 2 px') && modal.selectedUrl !== firstUrl && !modal.urls.has(firstUrl), 'Selection replaces preview and releases previous URL');
  const beforeCancel = g.saved.length;modal.cancelButton.click();
  assert(modal.closed && modal.urls.size === 0 && g.saved.length === beforeCancel, 'Cancel must only release resources');checks.push('selection previews exact bytes; switching and cancel release resources without writes');

  const embedded = doc.createElement('img');embedded.src = app.vault.getResourcePath(source);doc.body.append(embedded);await embedded.decode();
  assert(embedded.naturalWidth === 7, 'Current fixture dimensions');
  modal = await open();await select(modal, 1);await modal.restore();await embedded.decode();
  assert(modal.closed && bytesEqual(g.data.get(source.path), first), 'Restore writes exact selected bytes and closes popup');
  assert(embedded.naturalWidth === 3 && embedded.naturalHeight === 2, 'Rendered note must refresh to restored pixels/dimensions');
  assert(g.data.get('fixture.md') === '![[fixture.jpg|400]]', 'Restore never changes note text');
  const after = findImageBackups(app, source, folder);
  assert(after.length === 3 && bytesEqual(g.data.get(after[0].path), current), 'Current bytes must be backed up before restore');
  assert(baseline.every(version => g.files.get(version.path) === version.file), 'Existing history stays intact');
  checks.push('byte-exact restore, current-version safety backup, unchanged history and immediate rendered refresh');

  modal = await open();await select(modal, 0);await modal.restore();await embedded.decode();
  assert(bytesEqual(g.data.get(source.path), current) && embedded.naturalWidth === 7, 'Restore can itself be undone using safety backup');checks.push('recovery can be reversed using the automatic safety backup');

  modal = await open();await select(modal, 0);
  const chosen = modal.selected.version.path, savedBackup = g.data.get(chosen), writes = g.saved.length;
  g.data.set(chosen, second);await modal.restore();
  assert(!modal.closed && modal.status.classList.contains('image-toolkit-error') && g.saved.length === writes && bytesEqual(g.data.get(source.path), current), 'Changed backup must not overwrite source');
  g.data.set(chosen, savedBackup);modal.close();checks.push('changed backup bytes reject stale selection without writing');

  modal = await open();await select(modal, 0);g.data.set(source.path, second);
  const beforeConflict = g.saved.length;await modal.restore();
  assert(!modal.closed && modal.status.classList.contains('image-toolkit-error') && g.saved.length === beforeConflict && bytesEqual(g.data.get(source.path), second), 'Source conflict must be preserved');
  g.data.set(source.path, current);modal.close();checks.push('source changes while popup is open prevent recovery');

  modal = await open();await select(modal, 0);
  const create = app.vault.createBinary;app.vault.createBinary = async () => { throw new Error('Simulated backup write failure'); };
  try { await modal.restore(); } finally { app.vault.createBinary = create; }
  assert(!modal.closed && modal.status.textContent.includes('write failure') && bytesEqual(g.data.get(source.path), current) && !modal.cancelButton.disabled, 'Backup failure must preserve source and restore controls');
  modal.close();checks.push('failed safety backup prevents restore and leaves usable controls');

  modal = await open();
  const read = app.vault.readBinary;let release!: () => void;
  app.vault.readBinary = async (file: any) => { if (file !== source) await new Promise<void>(resolve => { release = resolve; });return read(file); };
  const pending = modal.selectVersion(findImageBackups(app, source, folder)[0], modal.rows[0]);
  await until(() => !!release, 'Preview read did not start');modal.close();release();await pending;app.vault.readBinary = read;
  assert(!modal.selected && modal.urls.size === 0, 'Closing during preview must cancel late selection');checks.push('closing during an asynchronous preview cancels late results');
  embedded.remove();
  assert(g.errors.length === 0, `Unhandled errors: ${g.errors.join(', ')}`);
  return { checks, errors: g.errors };
}); }
