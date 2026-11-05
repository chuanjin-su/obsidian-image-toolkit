import type { Point } from './processing';

export type MarkKind = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'ellipse' | 'text';
export type Mark = {
  kind: MarkKind;
  points: Point[];
  color: string;
  width: number;
  text?: string;
  textScaleX?: number;
};
export type Bounds = { x: number; y: number; w: number; h: number };
export type Corner = 'nw' | 'ne' | 'se' | 'sw';

const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];

/** Return the axis-aligned bounds of a mark. Text is positioned by its top-left corner. */
export function markBounds(mark: Mark, measureText: (text: string, fontSize: number) => number): Bounds {
  if (mark.kind === 'text') {
    const point = mark.points[0] ?? { x: 0, y: 0 };
    const fontSize = mark.width;
    return {
      x: point.x,
      y: point.y,
      w: measureText(mark.text ?? '', fontSize) * (mark.textScaleX ?? 1),
      h: fontSize * 1.2,
    };
  }

  if (mark.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let left = mark.points[0].x;
  let top = mark.points[0].y;
  let right = left;
  let bottom = top;
  for (const point of mark.points.slice(1)) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Translate a mark without changing the original mark or its points. */
export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  return {
    ...mark,
    points: mark.points.map(point => ({ x: point.x + dx, y: point.y + dy })),
  };
}

/** Resize a bounds rectangle while keeping the opposite corner fixed. */
export function resizeBounds(bounds: Bounds, corner: Corner, point: Point, minSize = 2): Bounds {
  const minimum = Number.isFinite(minSize) ? Math.max(0, minSize) : 2;
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  const px = Number.isFinite(point.x) ? point.x : left;
  const py = Number.isFinite(point.y) ? point.y : top;

  switch (corner) {
    case 'nw': {
      const x = Math.min(px, right - minimum);
      const y = Math.min(py, bottom - minimum);
      return { x, y, w: right - x, h: bottom - y };
    }
    case 'ne': {
      const x = Math.max(px, left + minimum);
      const y = Math.min(py, bottom - minimum);
      return { x: left, y, w: x - left, h: bottom - y };
    }
    case 'se': {
      const x = Math.max(px, left + minimum);
      const y = Math.max(py, top + minimum);
      return { x: left, y: top, w: x - left, h: y - top };
    }
    case 'sw': {
      const x = Math.min(px, right - minimum);
      const y = Math.max(py, top + minimum);
      return { x, y: top, w: right - x, h: y - top };
    }
  }
}

function scaleCoordinate(value: number, fromStart: number, fromSize: number, toStart: number, toSize: number): number {
  // A collapsed source axis has no relative position to preserve; map it to the
  // corresponding leading edge rather than dividing by zero.
  const fraction = fromSize === 0 ? 0 : (value - fromStart) / fromSize;
  return toStart + fraction * toSize;
}

function scaleRatio(toSize: number, fromSize: number): number {
  return fromSize === 0 ? 1 : toSize / fromSize;
}

/** Resize a mark's geometry from one bounds rectangle to another. */
export function resizeMark(mark: Mark, from: Bounds, to: Bounds): Mark {
  const points = mark.points.map(point => ({
    x: scaleCoordinate(point.x, from.x, from.w, to.x, to.w),
    y: scaleCoordinate(point.y, from.y, from.h, to.y, to.h),
  }));
  if (mark.kind !== 'text') return { ...mark, points };

  const heightScale = scaleRatio(to.h, from.h);
  const widthScale = scaleRatio(to.w, from.w);
  const textScaleX = (mark.textScaleX ?? 1) * scaleRatio(widthScale, heightScale);
  return { ...mark, points, width: mark.width * heightScale, textScaleX };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function distanceToPath(point: Point, points: Point[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

function distanceToEllipse(point: Point, first: Point, last: Point): number {
  const centerX = (first.x + last.x) / 2;
  const centerY = (first.y + last.y) / 2;
  const radiusX = Math.abs(last.x - first.x) / 2;
  const radiusY = Math.abs(last.y - first.y) / 2;
  const dx = Math.abs(point.x - centerX);
  const dy = Math.abs(point.y - centerY);
  if (radiusX === 0 && radiusY === 0) return Math.hypot(dx, dy);
  if (radiusX === 0) return distanceToSegment(point, { x: centerX, y: centerY - radiusY }, { x: centerX, y: centerY + radiusY });
  if (radiusY === 0) return distanceToSegment(point, { x: centerX - radiusX, y: centerY }, { x: centerX + radiusX, y: centerY });

  const distanceSquaredAt = (angle: number): number => {
    const x = radiusX * Math.cos(angle) - dx;
    const y = radiusY * Math.sin(angle) - dy;
    return x * x + y * y;
  };
  const derivative = (angle: number): number => {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return (radiusY * radiusY - radiusX * radiusX) * sin * cos + radiusX * dx * sin - radiusY * dy * cos;
  };

  // The nearest point is in the first quadrant by symmetry. Find every
  // stationary point there, then select the least-distance candidate.
  const end = Math.PI / 2;
  const samples = 128;
  let bestSquared = Math.min(distanceSquaredAt(0), distanceSquaredAt(end));
  let previousAngle = 0;
  let previousDerivative = derivative(previousAngle);
  for (let index = 1; index <= samples; index++) {
    const angle = end * index / samples;
    const currentDerivative = derivative(angle);
    bestSquared = Math.min(bestSquared, distanceSquaredAt(angle));
    if (previousDerivative === 0) bestSquared = Math.min(bestSquared, distanceSquaredAt(previousAngle));
    if ((previousDerivative < 0 && currentDerivative > 0) || (previousDerivative > 0 && currentDerivative < 0)) {
      let low = previousAngle;
      let high = angle;
      let lowDerivative = previousDerivative;
      for (let iteration = 0; iteration < 48; iteration++) {
        const middle = (low + high) / 2;
        const middleDerivative = derivative(middle);
        if (middleDerivative === 0) { low = middle; high = middle; break; }
        if ((lowDerivative < 0 && middleDerivative > 0) || (lowDerivative > 0 && middleDerivative < 0)) {
          high = middle;
        } else {
          low = middle;
          lowDerivative = middleDerivative;
        }
      }
      bestSquared = Math.min(bestSquared, distanceSquaredAt((low + high) / 2));
    }
    previousAngle = angle;
    previousDerivative = currentDerivative;
  }
  return Math.sqrt(bestSquared);
}

function distanceToRectangle(point: Point, first: Point, last: Point): number {
  const left = Math.min(first.x, last.x);
  const right = Math.max(first.x, last.x);
  const top = Math.min(first.y, last.y);
  const bottom = Math.max(first.y, last.y);
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  return Math.min(...corners.map((corner, index) => distanceToSegment(point, corner, corners[(index + 1) % corners.length])));
}

/** Test proximity to the rendered stroke (or containment in a text mark). */
export function hitTestMark(mark: Mark, point: Point, tolerance: number, measureText: (text: string, fontSize: number) => number): boolean {
  if (mark.points.length === 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (mark.kind === 'text') {
    const bounds = markBounds(mark, measureText);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h;
  }

  const strokeWidth = Number.isFinite(mark.width) ? Math.abs(mark.width) : 0;
  const hitRadius = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0) + strokeWidth * (mark.kind === 'highlighter' ? 3 : 1) / 2;
  let distance: number;
  if (mark.kind === 'rectangle') {
    distance = distanceToRectangle(point, mark.points[0], mark.points[mark.points.length - 1]);
  } else if (mark.kind === 'ellipse') {
    distance = distanceToEllipse(point, mark.points[0], mark.points[mark.points.length - 1]);
  } else {
    distance = distanceToPath(point, mark.points);
    if (mark.kind === 'arrow' && mark.points.length >= 2) {
      const start = mark.points[0];
      const end = mark.points[mark.points.length - 1];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(12, strokeWidth * 4);
      const first = { x: end.x - length * Math.cos(angle - 0.5), y: end.y - length * Math.sin(angle - 0.5) };
      const second = { x: end.x - length * Math.cos(angle + 0.5), y: end.y - length * Math.sin(angle + 0.5) };
      distance = Math.min(distance, distanceToSegment(point, first, end), distanceToSegment(point, end, second));
    }
  }
  return distance <= hitRadius;
}

/** Return resize handles in stable clockwise order. */
export function selectionHandles(mark: Mark, bounds: Bounds): Array<{ id: 'start' | 'end' | Corner; point: Point }> {
  if (mark.kind === 'arrow') {
    if (mark.points.length === 0) return [];
    return [
      { id: 'start', point: { ...mark.points[0] } },
      { id: 'end', point: { ...mark.points[mark.points.length - 1] } },
    ];
  }
  const points: Record<Corner, Point> = {
    nw: { x: bounds.x, y: bounds.y },
    ne: { x: bounds.x + bounds.w, y: bounds.y },
    se: { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    sw: { x: bounds.x, y: bounds.y + bounds.h },
  };
  return CORNERS.map(id => ({ id, point: points[id] }));
}
