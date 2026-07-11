import {
  CUTOUT_CELL,
  isPortraitCellValid,
  packPortraitCell,
  portraitCellIntensity,
  portraitCellMaterialId,
  TRANSPARENT_CELL,
} from "./portrait-blueprint";

export interface RasterPoint {
  x: number;
  y: number;
}

export interface BrushStampOptions {
  /** Radius in cells. A radius of zero paints exactly one cell. */
  radius: number;
  /** 0 produces a soft edge, 1 produces a hard disk. */
  hardness?: number;
  /** Deterministic occupancy from 0 through 1. */
  density?: number;
  /** Integer salt for deterministic density dithering. */
  seed?: number;
}

export interface RasterShapeOptions {
  fill?: boolean;
}

export interface RasterCellEdit {
  index: number;
  value: number;
}

function assertRaster(
  cells: Uint16Array,
  width: number,
  height: number,
): void {
  if (!(cells instanceof Uint16Array)) {
    throw new TypeError("cells must be a Uint16Array");
  }
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("height must be a positive integer");
  }
  if (cells.length !== width * height) {
    throw new RangeError("cells length must equal width times height");
  }
}

function assertCellValue(value: number): void {
  if (!isPortraitCellValid(value)) {
    throw new RangeError("value must be a valid packed portrait cell");
  }
}

function requireInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function densitySample(x: number, y: number, seed: number): number {
  const value =
    Math.imul(x | 0, 0x1f123bb5) ^
    Math.imul(y | 0, 0x5f356495) ^
    Math.imul(seed | 0, 0x6c8e9cf5);
  return mix32(value) / 0x1_0000_0000;
}

function validateBrushOptions(options: BrushStampOptions): Required<BrushStampOptions> {
  const hardness = options.hardness ?? 1;
  const density = options.density ?? 1;
  const seed = options.seed ?? 0;
  if (
    typeof options.radius !== "number" ||
    !Number.isFinite(options.radius) ||
    options.radius < 0
  ) {
    throw new RangeError("radius must be a finite non-negative number");
  }
  if (!Number.isFinite(hardness) || hardness < 0 || hardness > 1) {
    throw new RangeError("hardness must be from 0 through 1");
  }
  if (!Number.isFinite(density) || density < 0 || density > 1) {
    throw new RangeError("density must be from 0 through 1");
  }
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  return { radius: options.radius, hardness, density, seed };
}

function valueAtCoverage(value: number, coverage: number): number {
  if (
    value === TRANSPARENT_CELL ||
    value === CUTOUT_CELL ||
    coverage >= 1
  ) {
    return value;
  }
  const materialId = portraitCellMaterialId(value);
  const intensity = portraitCellIntensity(value);
  return packPortraitCell(materialId, Math.max(1, Math.round(intensity * coverage)));
}

function stampDiskInto(
  target: Uint16Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  value: number,
  options: Required<BrushStampOptions>,
): void {
  if (options.radius === 0) {
    const x = Math.round(centerX);
    const y = Math.round(centerY);
    if (
      options.density > 0 &&
      inBounds(x, y, width, height) &&
      densitySample(x, y, options.seed) < options.density
    ) {
      target[y * width + x] = value;
    }
    return;
  }

  const outerRadius = options.radius + 0.5;
  const hardRadius = outerRadius * options.hardness;
  const x0 = Math.floor(centerX - outerRadius);
  const x1 = Math.ceil(centerX + outerRadius);
  const y0 = Math.floor(centerY - outerRadius);
  const y1 = Math.ceil(centerY + outerRadius);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inBounds(x, y, width, height)) continue;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > outerRadius) continue;
      const coverage =
        distance <= hardRadius || hardRadius === outerRadius
          ? 1
          : Math.max(
              0,
              (outerRadius - distance) / (outerRadius - hardRadius),
            );
      const occupancy = options.density * coverage;
      if (occupancy <= 0) continue;
      if (
        occupancy < 1 &&
        densitySample(x, y, options.seed) >= occupancy
      ) {
        continue;
      }
      target[y * width + x] = valueAtCoverage(value, coverage);
    }
  }
}

function stampDiskEditsInto(
  edits: Map<number, number>,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  value: number,
  options: Required<BrushStampOptions>,
): void {
  const write = (x: number, y: number, coverage: number) => {
    if (!inBounds(x, y, width, height)) return;
    const next = valueAtCoverage(value, coverage);
    const index = y * width + x;
    // Preserve the exact sequential stamp semantics of rasterBrushLine.
    // A later soft edge can replace an earlier hard center in that reference
    // implementation, so the sparse hot path must retain the last write too.
    edits.set(index, next);
  };

  if (options.radius === 0) {
    const x = Math.round(centerX);
    const y = Math.round(centerY);
    if (
      options.density > 0 &&
      inBounds(x, y, width, height) &&
      densitySample(x, y, options.seed) < options.density
    ) {
      write(x, y, 1);
    }
    return;
  }

  const outerRadius = options.radius + 0.5;
  const hardRadius = outerRadius * options.hardness;
  for (let y = Math.floor(centerY - outerRadius); y <= Math.ceil(centerY + outerRadius); y++) {
    for (let x = Math.floor(centerX - outerRadius); x <= Math.ceil(centerX + outerRadius); x++) {
      if (!inBounds(x, y, width, height)) continue;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > outerRadius) continue;
      const coverage =
        distance <= hardRadius || hardRadius === outerRadius
          ? 1
          : Math.max(0, (outerRadius - distance) / (outerRadius - hardRadius));
      const occupancy = options.density * coverage;
      if (occupancy <= 0) continue;
      if (occupancy < 1 && densitySample(x, y, options.seed) >= occupancy) continue;
      write(x, y, coverage);
    }
  }
}

/** Inclusive integer Bresenham line, with no implicit viewport clipping. */
export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): RasterPoint[] {
  requireInteger(x0, "x0");
  requireInteger(y0, "y0");
  requireInteger(x1, "x1");
  requireInteger(y1, "y1");

  const points: RasterPoint[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

export function stampDiskBrush(
  cells: Uint16Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  value: number,
  options: BrushStampOptions,
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    throw new TypeError("Brush center must contain finite coordinates");
  }
  const normalized = validateBrushOptions(options);
  const result = new Uint16Array(cells);
  stampDiskInto(
    result,
    width,
    height,
    centerX,
    centerY,
    value,
    normalized,
  );
  return result;
}

export function rasterBrushLine(
  cells: Uint16Array,
  width: number,
  height: number,
  start: RasterPoint,
  end: RasterPoint,
  value: number,
  options: BrushStampOptions,
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  const normalized = validateBrushOptions(options);
  const result = new Uint16Array(cells);
  for (const point of bresenhamLine(start.x, start.y, end.x, end.y)) {
    stampDiskInto(
      result,
      width,
      height,
      point.x,
      point.y,
      value,
      normalized,
    );
  }
  return result;
}

/**
 * Produce only the changed footprint for an interpolated brush segment. This
 * is the editor hot path and avoids allocating or scanning a full document
 * raster for every pointer event.
 */
export function rasterBrushEdits(
  width: number,
  height: number,
  start: RasterPoint,
  end: RasterPoint,
  value: number,
  options: BrushStampOptions,
): RasterCellEdit[] {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("height must be a positive integer");
  }
  assertCellValue(value);
  const normalized = validateBrushOptions(options);
  const edits = new Map<number, number>();
  for (const point of bresenhamLine(start.x, start.y, end.x, end.y)) {
    stampDiskEditsInto(
      edits,
      width,
      height,
      point.x,
      point.y,
      value,
      normalized,
    );
  }
  return Array.from(edits, ([index, editValue]) => ({ index, value: editValue }));
}

export function rasterRectangle(
  cells: Uint16Array,
  width: number,
  height: number,
  start: RasterPoint,
  end: RasterPoint,
  value: number,
  options: RasterShapeOptions = {},
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  requireInteger(start.x, "start.x");
  requireInteger(start.y, "start.y");
  requireInteger(end.x, "end.x");
  requireInteger(end.y, "end.y");
  const result = new Uint16Array(cells);
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const x0 = Math.max(0, left);
  const x1 = Math.min(width - 1, right);
  const y0 = Math.max(0, top);
  const y1 = Math.min(height - 1, bottom);
  if (x0 > x1 || y0 > y1) return result;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (
        options.fill ||
        x === left ||
        x === right ||
        y === top ||
        y === bottom
      ) {
        result[y * width + x] = value;
      }
    }
  }
  return result;
}

function ellipseContains(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): boolean {
  if (radiusX === 0 && radiusY === 0) return x === centerX && y === centerY;
  if (radiusX === 0) {
    return x === Math.round(centerX) && Math.abs(y - centerY) <= radiusY + 0.5;
  }
  if (radiusY === 0) {
    return y === Math.round(centerY) && Math.abs(x - centerX) <= radiusX + 0.5;
  }
  const nx = (x - centerX) / (radiusX + 0.5);
  const ny = (y - centerY) / (radiusY + 0.5);
  return nx * nx + ny * ny <= 1;
}

export function rasterEllipse(
  cells: Uint16Array,
  width: number,
  height: number,
  start: RasterPoint,
  end: RasterPoint,
  value: number,
  options: RasterShapeOptions = {},
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  requireInteger(start.x, "start.x");
  requireInteger(start.y, "start.y");
  requireInteger(end.x, "end.x");
  requireInteger(end.y, "end.y");
  const result = new Uint16Array(cells);
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const radiusX = (right - left) / 2;
  const radiusY = (bottom - top) / 2;
  const x0 = Math.max(0, left);
  const x1 = Math.min(width - 1, right);
  const y0 = Math.max(0, top);
  const y1 = Math.min(height - 1, bottom);
  if (x0 > x1 || y0 > y1) return result;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!ellipseContains(x, y, centerX, centerY, radiusX, radiusY)) continue;
      if (options.fill) {
        result[y * width + x] = value;
        continue;
      }
      const isBoundary =
        !ellipseContains(x - 1, y, centerX, centerY, radiusX, radiusY) ||
        !ellipseContains(x + 1, y, centerX, centerY, radiusX, radiusY) ||
        !ellipseContains(x, y - 1, centerX, centerY, radiusX, radiusY) ||
        !ellipseContains(x, y + 1, centerX, centerY, radiusX, radiusY);
      if (isBoundary) result[y * width + x] = value;
    }
  }
  return result;
}

/** Iterative four-neighbor flood fill that never recurses on the JS stack. */
export function floodFill4(
  cells: Uint16Array,
  width: number,
  height: number,
  start: RasterPoint,
  value: number,
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  requireInteger(start.x, "start.x");
  requireInteger(start.y, "start.y");
  const result = new Uint16Array(cells);
  if (!inBounds(start.x, start.y, width, height)) return result;
  const startIndex = start.y * width + start.x;
  const target = result[startIndex];
  if (target === value) return result;

  const queue = new Int32Array(cells.length);
  let read = 0;
  let write = 0;
  queue[write++] = startIndex;
  result[startIndex] = value;

  while (read < write) {
    const index = queue[read++];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && result[neighbor] === target) {
        result[neighbor] = value;
        queue[write++] = neighbor;
      }
    }
  }
  return result;
}

function pointOnSegment(
  x: number,
  y: number,
  start: RasterPoint,
  end: RasterPoint,
): boolean {
  const cross =
    (x - start.x) * (end.y - start.y) -
    (y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot =
    (x - start.x) * (end.x - start.x) +
    (y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const lengthSquared =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared;
}

function pointInPolygon(x: number, y: number, points: readonly RasterPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous];
    const b = points[index];
    if (pointOnSegment(x, y, a, b)) return true;
    const crosses =
      (a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonLassoMask(
  width: number,
  height: number,
  points: readonly RasterPoint[],
): Uint8Array {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("height must be a positive integer");
  }
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError(`points[${index}] must contain finite coordinates`);
    }
  }
  const mask = new Uint8Array(width * height);
  if (points.length < 3) return mask;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pointInPolygon(x, y, points)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function paintRasterMask(
  cells: Uint16Array,
  width: number,
  height: number,
  mask: Uint8Array,
  value: number,
): Uint16Array {
  assertRaster(cells, width, height);
  assertCellValue(value);
  if (!(mask instanceof Uint8Array) || mask.length !== cells.length) {
    throw new RangeError("mask must be a Uint8Array matching the raster length");
  }
  const result = new Uint16Array(cells);
  for (let index = 0; index < mask.length; index++) {
    if (mask[index] !== 0) result[index] = value;
  }
  return result;
}
