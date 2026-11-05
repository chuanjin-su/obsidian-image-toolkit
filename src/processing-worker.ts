import { enhanceBoard, estimateRectifiedSize, rectifyImage, MAX_PIXELS, MAX_DIMENSION, type Point } from './processing';

export interface ProcessingRequest {
  id: number;
  data: ArrayBuffer;
  width: number;
  height: number;
  corners?: Point[];
  outWidth?: number;
  outHeight?: number;
  mode?: 'whiteboard' | 'blackboard';
  strength?: number;
}

export type ProcessingResponse =
  | { id: number; data: ArrayBuffer; width: number; height: number }
  | { id: number; error: string };

type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ProcessingResponse, transfer?: Transferable[]): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function handleMessage(event: MessageEvent<unknown>, scope: WorkerScope): void {
  const raw = event.data;
  const id = isRecord(raw) && Number.isSafeInteger(raw.id) ? raw.id as number : -1;
  try {
    if (!isRecord(raw)) throw new TypeError('Invalid processing request.');
    const request = raw as unknown as ProcessingRequest;
    if (!(request.data instanceof ArrayBuffer)) throw new TypeError('Request data must be an ArrayBuffer.');
    if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
      throw new RangeError('Image dimensions must be positive integers.');
    }
    if (request.width > MAX_DIMENSION || request.height > MAX_DIMENSION || request.width > Math.floor(MAX_PIXELS / request.height)) {
      throw new RangeError('Image dimensions exceed the processing limits.');
    }
    const expectedLength = request.width * request.height * 4;
    if (request.data.byteLength !== expectedLength) throw new RangeError('Image data length does not match its dimensions.');

    let data: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(request.data);
    let width = request.width;
    let height = request.height;
    let didWork = false;

    if (request.corners !== undefined) {
      let outputSize;
      if (request.outWidth === undefined && request.outHeight === undefined) {
        outputSize = estimateRectifiedSize(request.corners);
      } else {
        if (request.outWidth === undefined || request.outHeight === undefined) {
          throw new RangeError('Both output dimensions must be provided.');
        }
        outputSize = { width: request.outWidth, height: request.outHeight };
      }
      data = rectifyImage(data, width, height, request.corners, outputSize.width, outputSize.height);
      width = outputSize.width;
      height = outputSize.height;
      didWork = true;
    } else if (request.outWidth !== undefined || request.outHeight !== undefined) {
      throw new RangeError('Output dimensions require perspective corners.');
    }

    if (request.mode !== undefined) {
      data = enhanceBoard(data, width, height, request.mode, request.strength ?? 1);
      didWork = true;
    } else if (request.strength !== undefined) {
      throw new RangeError('Enhancement strength requires a board mode.');
    }
    if (!didWork) throw new TypeError('Request must specify perspective correction or board enhancement.');

    const response: ProcessingResponse = { id, data: data.buffer as ArrayBuffer, width, height };
    scope.postMessage(response, [response.data]);
  } catch (error) {
    const response: ProcessingResponse = {
      id,
      error: error instanceof Error ? error.message : 'Image processing failed.',
    };
    scope.postMessage(response);
  }
}

// Avoid registering a worker handler when this module is imported by tests or
// other main-thread code. In a WorkerGlobalScope, both methods are available.
const workerScope = globalThis as unknown as Partial<WorkerScope>;
if (typeof document === 'undefined' && typeof workerScope.addEventListener === 'function' && typeof workerScope.postMessage === 'function') {
  workerScope.addEventListener('message', event => handleMessage(event, workerScope as WorkerScope));
}
