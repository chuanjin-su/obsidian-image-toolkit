import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['esbuild.config.mjs'], { cwd: pluginRoot });
const builtMain = readFileSync(resolve(pluginRoot, 'main.js'), 'utf8');

class StubPlugin {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) { this.app = app; this.manifest = manifest; }
}
class StubModal {
  constructor(public app: any) {}
  open() { /* Keep ImageEditor.onOpen from touching a real vault or DOM. */ }
  close() { this.onClose(); }
  onClose() {}
}
class StubPluginSettingTab { constructor(public app: any, public plugin: any) {} }
class StubMenu {}
class StubNotice { constructor(_message: string) {} }
class StubSetting { constructor(_container: any) {} }
class StubTFile {}

class FakeBlob {
  readonly source: string;
  constructor(parts: unknown[], readonly options: { type?: string } = {}) {
    this.source = parts.map(part => typeof part === 'string' ? part : String(part)).join('');
  }
  async text() { return this.source; }
}

type PostedMessage = { id: number; data: ArrayBuffer; [key: string]: unknown };
type PostedWaiter = { count: number; resolve: () => void };

class FakeWorker {
  onmessage?: (event: { data: any }) => void;
  onerror?: (event: { message: string }) => void;
  terminated = false;
  readonly posted: PostedMessage[] = [];
  readonly transfers: Array<Transferable[] | undefined> = [];
  private readonly postedWaiters: PostedWaiter[] = [];
  private readonly ready: Promise<void>;
  private messageHandler?: (event: { data: unknown }) => void;
  private readonly workerContext: ReturnType<typeof createContext>;

  constructor(readonly url: string, private readonly blob: FakeBlob, private readonly holdRequests: boolean) {
    this.workerContext = createContext({
      ArrayBuffer,
      Uint8Array,
      Uint8ClampedArray,
      Int8Array,
      Int16Array,
      Uint16Array,
      Int32Array,
      Float32Array,
      Float64Array,
      Number,
      addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
        assert.equal(type, 'message');
        this.messageHandler = listener;
      },
      postMessage: (data: unknown) => {
        if (this.terminated) return;
        setImmediate(() => {
          if (!this.terminated) this.onmessage?.({ data });
        });
      },
    });
    this.ready = this.blob.text().then(source => {
      runInContext(source, this.workerContext, { filename: 'embedded-processing-worker.js' });
    });
    void this.ready.catch(error => this.onerror?.({ message: String(error) }));
  }

  postMessage(message: PostedMessage, transfer?: Transferable[]) {
    this.posted.push(message);
    this.transfers.push(transfer);
    for (let index = this.postedWaiters.length - 1; index >= 0; index--) {
      if (this.posted.length >= this.postedWaiters[index].count) {
        this.postedWaiters.splice(index, 1)[0].resolve();
      }
    }
    if (!this.holdRequests) this.dispatch(message);
  }

  waitForPosted(count: number): Promise<void> {
    if (this.posted.length >= count) return Promise.resolve();
    return new Promise(resolve => this.postedWaiters.push({ count, resolve }));
  }

  terminate() {
    this.terminated = true;
  }

  private dispatch(message: PostedMessage) {
    void this.ready.then(() => {
      if (this.terminated) return;
      setImmediate(() => {
        if (this.terminated) return;
        try {
          if (!this.messageHandler) throw new Error('Embedded worker did not register a message handler.');
          this.messageHandler({ data: message });
        } catch (error) {
          this.onerror?.({ message: String(error) });
        }
      });
    }, error => this.onerror?.({ message: String(error) }));
  }
}

function createRuntime(options: { holdRequests?: boolean } = {}) {
  const blobs = new Map<string, FakeBlob>();
  const workers: FakeWorker[] = [];
  const revokedUrls: string[] = [];
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextUrl = 0;
  let nextTimer = 0;
  const urlApi = {
    createObjectURL(blob: FakeBlob) {
      const url = `blob:image-toolkit/${++nextUrl}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url: string) { revokedUrls.push(url); },
  };
  const fakeWindow = {
    setTimeout(callback: (...args: any[]) => void, delay = 0) {
      const id = ++nextTimer;
      const handle = setTimeout(() => {
        timers.delete(id);
        callback();
      }, delay);
      timers.set(id, handle);
      return id;
    },
    clearTimeout(id: number | undefined) {
      if (id === undefined) return;
      const handle = timers.get(id);
      if (handle !== undefined) clearTimeout(handle);
      timers.delete(id);
    },
  };
  class WorkerStub extends FakeWorker {
    constructor(url: string) {
      const blob = blobs.get(url);
      if (!blob) throw new Error(`No embedded Blob was registered for ${url}`);
      super(url, blob, options.holdRequests === true);
      workers.push(this);
    }
  }
  const obsidian = {
    Menu: StubMenu,
    Modal: StubModal,
    Notice: StubNotice,
    Plugin: StubPlugin,
    PluginSettingTab: StubPluginSettingTab,
    Setting: StubSetting,
    TFile: StubTFile,
    setIcon() {},
  };
  const module = { exports: {} as any };
  runInNewContext(builtMain, {
    module,
    exports: module.exports,
    require(name: string) {
      assert.equal(name, 'obsidian');
      return obsidian;
    },
    Blob: FakeBlob,
    URL: urlApi,
    Worker: WorkerStub,
    window: fakeWindow,
  }, { filename: 'main.js' });

  const adapterReads: string[] = [];
  const app = {
    vault: {
      adapter: {
        async read(path: string) {
          adapterReads.push(path);
          const error = Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
          throw error;
        },
      },
      async readBinary() { throw new Error('The stub Modal.open must not load a vault image.'); },
    },
  };
  const plugin = new module.exports.default(app, { dir: 'image-toolkit' });
  const file = { extension: 'png', name: 'synthetic.png', path: 'images/synthetic.png' };
  plugin.open({ file }, 'crop');
  const editors = plugin.editors as Set<any>;
  assert.equal(editors.size, 1, 'plugin.open should retain the real ImageEditor instance');
  const editor = Array.from(editors)[0];

  return {
    adapterReads,
    blobs,
    editor,
    editors,
    file,
    plugin,
    revokedUrls,
    timers,
    workers,
    close() {
      for (const current of Array.from(editors)) current.close();
      const leakedWorkers = workers.filter(worker => !worker.terminated).length;
      for (const worker of workers) worker.terminate();
      const leakedTimers = timers.size;
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
      assert.equal(leakedWorkers, 0, 'test cleanup should not leave a worker running');
      assert.equal(leakedTimers, 0, 'test cleanup should not leave request timers running');
    },
  };
}

function rgba(values: number[]) { return new Uint8ClampedArray(values); }
function pixels(result: { data: ArrayBuffer }) { return new Uint8ClampedArray(result.data); }


test('built main embeds and executes board and adjustment processing without a worker asset or adapter read', async t => {
  assert.equal(existsSync(resolve(pluginRoot, 'processing-worker.js')), false, 'the build must not require a separate worker file');
  assert.doesNotMatch(builtMain, /processing-worker\.js/, 'the built main bundle must not load a separate worker file');

  const runtime = createRuntime();
  t.after(() => runtime.close());
  const source = rgba([
    10, 30, 70, 11, 80, 100, 120, 99,
    150, 170, 190, 201, 220, 230, 240, 255,
  ]);
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const identity = await runtime.editor.process({
    data: source.buffer, width: 2, height: 2, corners, outWidth: 2, outHeight: 2,
    mode: 'whiteboard', strength: 0,
  });
  assert.deepEqual(pixels(identity), source, 'perspective rectification plus zero-strength enhancement should preserve pixels');
  assert.equal(identity.width, 2);
  assert.equal(identity.height, 2);

  const whiteInput = rgba(Array.from({ length: 9 }, (_, index) => [96, 112, 128, index * 23]).flat());
  const white = await runtime.editor.process({
    data: whiteInput.buffer, width: 3, height: 3, mode: 'whiteboard', strength: 1,
  });
  const whitePixels = pixels(white);
  for (let offset = 0; offset < whitePixels.length; offset += 4) {
    assert.deepEqual(Array.from(whitePixels.slice(offset, offset + 4)), [255, 255, 255, whiteInput[offset + 3]]);
  }

  const blackInput = rgba(Array.from({ length: 9 }, (_, index) => [120, 105, 91, 255 - index * 17]).flat());
  const black = await runtime.editor.process({
    data: blackInput.buffer, width: 3, height: 3, mode: 'blackboard', strength: 1,
  });
  const blackPixels = pixels(black);
  for (let offset = 0; offset < blackPixels.length; offset += 4) {
    assert.deepEqual(Array.from(blackPixels.slice(offset, offset + 4)), [0, 0, 0, blackInput[offset + 3]]);
  }

  const adjustmentInput = rgba([35, 70, 105, 17, 130, 150, 170, 203]);
  const adjusted = await runtime.editor.process({
    data: adjustmentInput.buffer, width: 2, height: 1, adjustments: { brightness: 35 },
  });
  const adjustedPixels = pixels(adjusted);
  for (let offset = 0; offset < adjustedPixels.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) assert.ok(adjustedPixels[offset + channel] > adjustmentInput[offset + channel]);
    assert.equal(adjustedPixels[offset + 3], adjustmentInput[offset + 3], 'adjustments preserve alpha');
  }

  assert.equal(runtime.workers.length, 1, 'all operations should reuse one real worker created by the built editor');
  assert.equal(runtime.blobs.size, 1, 'the embedded worker source should be passed to Blob exactly once');
  const [workerBlob] = runtime.blobs.values();
  assert.match(workerBlob.source, /Request data must be an ArrayBuffer/);
  assert.equal(runtime.workers[0].posted.length, 4);
  assert.equal(runtime.adapterReads.length, 0, 'processing must never read processing-worker.js from the vault');
  assert.equal(runtime.timers.size, 0, 'completed processing should clear every request timeout');
});


test('built worker handles concurrent board and adjustment requests and remains reusable', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.close());
  const boardInput = rgba(Array.from({ length: 16 }, (_, index) => [84, 96, 108, index * 13]).flat());
  const photoInput = rgba([40, 60, 80, 23, 110, 130, 150, 211]);
  const [board, photo] = await Promise.all([
    runtime.editor.process({ data: boardInput.buffer, width: 4, height: 4, mode: 'whiteboard', strength: 1 }),
    runtime.editor.process({ data: photoInput.buffer, width: 2, height: 1, adjustments: { brightness: 25 } }),
  ]);

  assert.equal(board.width, 4);
  assert.equal(board.height, 4);
  for (let offset = 0; offset < pixels(board).length; offset += 4) assert.equal(pixels(board)[offset], 255);
  const photoPixels = pixels(photo);
  assert.ok(photoPixels[0] > photoInput[0]);
  assert.ok(photoPixels[4] > photoInput[4]);
  assert.equal(photoPixels[3], photoInput[3]);
  assert.equal(photoPixels[7], photoInput[7]);

  const again = await runtime.editor.process({
    data: rgba([20, 40, 60, 77]).buffer, width: 1, height: 1, adjustments: { brightness: 10 },
  });
  assert.ok(pixels(again)[0] > 20);
  assert.equal(runtime.workers.length, 1, 'concurrent jobs and subsequent work must reuse the same worker');
  assert.equal(runtime.workers[0].posted.length, 3);
  assert.deepEqual(runtime.workers[0].posted.map(message => message.id), [1, 2, 3]);
  assert.ok(runtime.workers[0].transfers.every(transfer => transfer?.length === 1));
  assert.equal(runtime.adapterReads.length, 0);
  assert.equal(runtime.timers.size, 0, 'completed concurrent requests should clear every timeout');
});


test('stopWorker rejects in-flight work, releases resources, and a closed editor cannot restart it', async t => {
  const runtime = createRuntime({ holdRequests: true });
  t.after(() => runtime.close());
  const request = runtime.editor.process({
    data: rgba([40, 60, 80, 255]).buffer, width: 1, height: 1, adjustments: { brightness: 10 },
  });
  const worker = runtime.workers[0];
  await worker.waitForPosted(1);
  assert.equal(runtime.editor.jobs.size, 1);
  assert.equal(runtime.timers.size, 1, 'each active request should have a timeout');

  runtime.editor.stopWorker(new Error('forced worker shutdown'));
  await assert.rejects(request, /forced worker shutdown/);
  assert.equal(worker.terminated, true);
  assert.deepEqual(runtime.revokedUrls, [worker.url]);
  assert.equal(runtime.editor.jobs.size, 0);
  assert.equal(runtime.editor.worker, undefined);
  assert.equal(runtime.editor.workerUrl, undefined);
  assert.equal(runtime.timers.size, 0, 'stopWorker must clear active request timers');

  runtime.editor.close();
  await assert.rejects(
    runtime.editor.process({ data: rgba([1, 2, 3, 4]).buffer, width: 1, height: 1, adjustments: { brightness: 1 } }),
    /Editor closed\./,
  );
  assert.equal(runtime.workers.length, 1, 'a closed editor must not create another worker');
  assert.equal(runtime.adapterReads.length, 0);
  assert.equal(runtime.timers.size, 0);
});
