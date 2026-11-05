import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hitTestMark,
  markBounds,
  moveMark,
  resizeBounds,
  resizeMark,
  selectionHandles,
  type Bounds,
  type Corner,
  type Mark,
} from '../src/annotations';
import type { Point } from '../src/processing';

const measureText = (text: string, fontSize: number) => text.length * fontSize / 2;
const bounds: Bounds = { x: 10, y: 20, w: 100, h: 80 };

function mark(overrides: Partial<Mark> = {}): Mark {
  return { kind: 'pen', points: [{ x: 10, y: 20 }, { x: 110, y: 100 }], color: '#c04aff', width: 4, ...overrides };
}

function assertBounds(actual: Bounds, expected: Bounds): void {
  assert.deepEqual(actual, expected);
}

test('markBounds uses all geometry points and top-aligned text metrics', () => {
  assertBounds(markBounds(mark({ points: [{ x: 8, y: 12 }, { x: -2, y: 45 }, { x: 6, y: 21 }] }), measureText), {
    x: -2, y: 12, w: 10, h: 33,
  });
  const text = mark({ kind: 'text', points: [{ x: 7, y: 9 }], text: 'abcd', width: 20 });
  assertBounds(markBounds(text, measureText), { x: 7, y: 9, w: 40, h: 24 });
  assertBounds(markBounds({ ...text, textScaleX: 1.5 }, measureText), { x: 7, y: 9, w: 60, h: 24 });
});

test('moveMark clones the mark and translates every point without mutation', () => {
  const original = mark({ kind: 'highlighter', text: 'kept', textScaleX: 1.25 });
  const points = original.points.map(point => ({ ...point }));
  const moved = moveMark(original, -3, 8);
  assert.notEqual(moved, original);
  assert.notEqual(moved.points, original.points);
  assert.notEqual(moved.points[0], original.points[0]);
  assert.deepEqual(original.points, points);
  assert.deepEqual(moved.points, [{ x: 7, y: 28 }, { x: 107, y: 108 }]);
  assert.equal(moved.color, original.color);
  assert.equal(moved.width, original.width);
  assert.equal(moved.text, original.text);
  assert.equal(moved.textScaleX, original.textScaleX);
});

test('resizeBounds grows all four handles in their drag directions and anchors the opposite corner', () => {
  const cases: Array<{ corner: Corner; point: Point; expected: Bounds; anchor: Point }> = [
    { corner: 'nw', point: { x: 0, y: 10 }, expected: { x: 0, y: 10, w: 110, h: 90 }, anchor: { x: 110, y: 100 } },
    { corner: 'ne', point: { x: 130, y: 10 }, expected: { x: 10, y: 10, w: 120, h: 90 }, anchor: { x: 10, y: 100 } },
    { corner: 'se', point: { x: 130, y: 120 }, expected: { x: 10, y: 20, w: 120, h: 100 }, anchor: { x: 10, y: 20 } },
    { corner: 'sw', point: { x: 0, y: 120 }, expected: { x: 0, y: 20, w: 110, h: 100 }, anchor: { x: 110, y: 20 } },
  ];
  for (const { corner, point, expected, anchor } of cases) {
    const resized = resizeBounds(bounds, corner, point);
    assertBounds(resized, expected);
    const opposite = corner === 'nw' ? { x: resized.x + resized.w, y: resized.y + resized.h }
      : corner === 'ne' ? { x: resized.x, y: resized.y + resized.h }
      : corner === 'se' ? { x: resized.x, y: resized.y }
      : { x: resized.x + resized.w, y: resized.y };
    assert.deepEqual(opposite, anchor);
  }
});

test('resizeBounds clamps crossing handles to the minimum size without flipping', () => {
  const crossed: Array<{ corner: Corner; point: Point; expected: Bounds }> = [
    { corner: 'nw', point: { x: 200, y: 200 }, expected: { x: 108, y: 98, w: 2, h: 2 } },
    { corner: 'ne', point: { x: -100, y: 200 }, expected: { x: 10, y: 98, w: 2, h: 2 } },
    { corner: 'se', point: { x: -100, y: -100 }, expected: { x: 10, y: 20, w: 2, h: 2 } },
    { corner: 'sw', point: { x: 200, y: -100 }, expected: { x: 108, y: 20, w: 2, h: 2 } },
  ];
  for (const { corner, point, expected } of crossed) assertBounds(resizeBounds(bounds, corner, point), expected);
  assertBounds(resizeBounds({ x: 4, y: 5, w: 0, h: 0 }, 'se', { x: 4, y: 5 }), { x: 4, y: 5, w: 2, h: 2 });
  assertBounds(resizeBounds(bounds, 'se', { x: 10, y: 20 }, 5), { x: 10, y: 20, w: 5, h: 5 });
});

test('resizeMark transforms rectangle, ellipse, and freehand points in each direction and preserves stroke properties', () => {
  const targets: Bounds[] = [
    { x: 0, y: 0, w: 200, h: 160 },
    { x: 20, y: 30, w: 50, h: 40 },
    { x: 50, y: 60, w: 100, h: 80 },
    { x: 120, y: 140, w: 20, h: 16 },
  ];
  const originalPoints = [{ x: 10, y: 20 }, { x: 60, y: 60 }, { x: 110, y: 100 }];
  for (const kind of ['rectangle', 'ellipse', 'pen', 'highlighter'] as const) {
    const original = mark({ kind, points: originalPoints.map(point => ({ ...point })) });
    const before = original.points.map(point => ({ ...point }));
    for (const target of targets) {
      const resized = resizeMark(original, bounds, target);
      assert.deepEqual(resized.points, [
        { x: target.x, y: target.y },
        { x: target.x + target.w / 2, y: target.y + target.h / 2 },
        { x: target.x + target.w, y: target.y + target.h },
      ]);
      assert.equal(resized.width, original.width);
      assert.equal(resized.color, original.color);
      assert.deepEqual(original.points, before);
    }
  }
});

test('text resizing uses vertical font scaling and compensates horizontal scaling', () => {
  const original = mark({
    kind: 'text', points: [{ x: 10, y: 20 }], width: 20, text: 'abcdefghij', textScaleX: 2, color: 'teal',
  });
  const from = markBounds(original, measureText);
  assertBounds(from, { x: 10, y: 20, w: 200, h: 24 });
  const to = { x: 30, y: 40, w: 600, h: 48 };
  const resized = resizeMark(original, from, to);
  assert.deepEqual(resized.points, [{ x: to.x, y: to.y }]);
  assert.equal(resized.width, 40);
  assert.equal(resized.textScaleX, 3);
  assertBounds(markBounds(resized, measureText), to);
  assert.equal(resized.text, original.text);
  assert.equal(resized.color, 'teal');
  assert.equal(original.width, 20);
  assert.equal(original.textScaleX, 2);
  assert.deepEqual(original.points, [{ x: 10, y: 20 }]);
});

test('resizing degenerate bounds stays finite for geometry and text', () => {
  const degenerate = mark({ points: [{ x: 5, y: 7 }, { x: 5, y: 7 }] });
  const resized = resizeMark(degenerate, { x: 5, y: 7, w: 0, h: 0 }, { x: 20, y: 30, w: 10, h: 12 });
  assert.deepEqual(resized.points, [{ x: 20, y: 30 }, { x: 20, y: 30 }]);
  for (const point of resized.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));

  const text = mark({ kind: 'text', points: [{ x: 5, y: 7 }], width: 0, text: 'empty-ish' });
  const resizedText = resizeMark(text, { x: 5, y: 7, w: 0, h: 0 }, { x: 20, y: 30, w: 10, h: 12 });
  assert.ok(Number.isFinite(resizedText.width));
  assert.ok(Number.isFinite(resizedText.textScaleX));
  assert.ok(Number.isFinite(resizedText.points[0].x) && Number.isFinite(resizedText.points[0].y));
});

test('hit testing finds stroke proximity for colored paths and round endpoints', () => {
  const path = mark({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], width: 2, color: '#ef3456' });
  assert.equal(hitTestMark(path, { x: 5, y: 1.9 }, 1, measureText), true);
  assert.equal(hitTestMark(path, { x: 5, y: 2.1 }, 1, measureText), false);
  assert.equal(hitTestMark(path, { x: -1.9, y: 0 }, 1, measureText), true);
  assert.equal(hitTestMark(path, { x: -2.1, y: 0 }, 1, measureText), false);
  assert.equal(hitTestMark(mark({ points: [{ x: 3, y: 4 }], width: 2 }), { x: 3, y: 5.9 }, 1, measureText), true);
  assert.equal(hitTestMark(mark({ points: [{ x: 3, y: 4 }], width: 2 }), { x: 3, y: 6.1 }, 1, measureText), false);
});

test('highlighter hit width is three times the stored stroke width', () => {
  const highlighter = mark({ kind: 'highlighter', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], width: 2, color: 'yellow' });
  assert.equal(hitTestMark(highlighter, { x: 10, y: 3.9 }, 1, measureText), true);
  assert.equal(hitTestMark(highlighter, { x: 10, y: 4.1 }, 1, measureText), false);
  assert.equal(hitTestMark({ ...highlighter, kind: 'pen' }, { x: 10, y: 3.9 }, 1, measureText), false);
});

test('arrows hit their shaft and rendered arrowhead strokes', () => {
  const arrow = mark({ kind: 'arrow', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }], width: 2 });
  assert.equal(hitTestMark(arrow, { x: 15, y: 1 }, 0, measureText), true);
  assert.equal(hitTestMark(arrow, { x: 24.7, y: 2.875 }, 0, measureText), true);
  assert.equal(hitTestMark(arrow, { x: 22, y: 6 }, 0, measureText), false);
});

test('rectangle and ellipse hit their outlines, not distant interiors or exteriors', () => {
  const rectangle = mark({ kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], width: 2 });
  assert.equal(hitTestMark(rectangle, { x: 10, y: 0.9 }, 0, measureText), true);
  assert.equal(hitTestMark(rectangle, { x: 10, y: 5 }, 0, measureText), false);
  assert.equal(hitTestMark(rectangle, { x: 10, y: 1.1 }, 0, measureText), false);

  const ellipse = mark({ kind: 'ellipse', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], width: 2 });
  assert.equal(hitTestMark(ellipse, { x: 10, y: 0.9 }, 0, measureText), true);
  assert.equal(hitTestMark(ellipse, { x: 10, y: 5 }, 0, measureText), false);
  assert.equal(hitTestMark(ellipse, { x: 10, y: -1.1 }, 0, measureText), false);
  assert.equal(hitTestMark(mark({ kind: 'ellipse', points: [{ x: 4, y: 4 }] }), { x: 4.9, y: 4 }, 0, measureText), true);
});

test('text hit testing uses the scaled top-aligned bounding box', () => {
  const text = mark({ kind: 'text', points: [{ x: 5, y: 7 }], text: 'abcd', width: 20, textScaleX: 2 });
  assert.equal(hitTestMark(text, { x: 44, y: 30 }, 0, measureText), true);
  assert.equal(hitTestMark(text, { x: 85.1, y: 10 }, 10, measureText), false);
  assert.equal(hitTestMark(text, { x: 10, y: 31.1 }, 10, measureText), false);
});

test('selection handles are four corners except for arrow endpoints', () => {
  assert.deepEqual(selectionHandles(mark(), bounds), [
    { id: 'nw', point: { x: 10, y: 20 } },
    { id: 'ne', point: { x: 110, y: 20 } },
    { id: 'se', point: { x: 110, y: 100 } },
    { id: 'sw', point: { x: 10, y: 100 } },
  ]);
  const arrow = mark({ kind: 'arrow', points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] });
  const handles = selectionHandles(arrow, bounds);
  assert.deepEqual(handles, [
    { id: 'start', point: { x: 1, y: 2 } },
    { id: 'end', point: { x: 8, y: 9 } },
  ]);
  handles[0].point.x = 100;
  assert.equal(arrow.points[0].x, 1);
});
