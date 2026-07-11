import { describe, expect, it } from "vitest";
import { packPortraitCell } from "./portrait-blueprint";
import {
  bresenhamLine,
  floodFill4,
  paintRasterMask,
  polygonLassoMask,
  rasterBrushLine,
  rasterBrushEdits,
  rasterEllipse,
  rasterRectangle,
  stampDiskBrush,
} from "./portrait-raster";

const INK = packPortraitCell(1, 240);
const SHADOW = packPortraitCell(3, 100);

function painted(cells: Uint16Array): number[] {
  return Array.from(cells, (cell, index) => (cell === 0 ? -1 : index)).filter(
    (index) => index >= 0,
  );
}

describe("Bresenham lines", () => {
  it("includes both endpoints for horizontal, vertical, and diagonal lines", () => {
    expect(bresenhamLine(1, 2, 4, 2)).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(bresenhamLine(3, 1, 3, 3)).toHaveLength(3);
    expect(bresenhamLine(0, 0, 4, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
  });

  it("works in reverse and rejects fractional coordinates", () => {
    expect(bresenhamLine(4, 1, 1, 1).map((point) => point.x)).toEqual([4, 3, 2, 1]);
    expect(() => bresenhamLine(0.5, 0, 1, 1)).toThrow(TypeError);
  });
});

describe("disk brushes", () => {
  it("paints one cell at radius zero without mutating the source", () => {
    const source = new Uint16Array(25);
    const result = stampDiskBrush(source, 5, 5, 2, 2, INK, { radius: 0 });
    expect(source.every((cell) => cell === 0)).toBe(true);
    expect(painted(result)).toEqual([12]);
  });

  it("clips a hard disk safely at the raster boundary", () => {
    const result = stampDiskBrush(new Uint16Array(25), 5, 5, 0, 0, INK, {
      radius: 2,
      hardness: 1,
      density: 1,
    });
    expect(painted(result).length).toBeGreaterThan(3);
    expect(result[0]).toBe(INK);
    expect(result.length).toBe(25);
  });

  it("uses deterministic density for identical seeds", () => {
    const source = new Uint16Array(21 * 21);
    const options = { radius: 8, hardness: 0.7, density: 0.46, seed: 91 };
    const first = stampDiskBrush(source, 21, 21, 10, 10, INK, options);
    const second = stampDiskBrush(source, 21, 21, 10, 10, INK, options);
    const different = stampDiskBrush(source, 21, 21, 10, 10, INK, {
      ...options,
      seed: 92,
    });
    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it("connects every Bresenham point in a brush stroke", () => {
    const result = rasterBrushLine(
      new Uint16Array(100),
      10,
      10,
      { x: 1, y: 1 },
      { x: 8, y: 6 },
      INK,
      { radius: 0 },
    );
    for (const point of bresenhamLine(1, 1, 8, 6)) {
      expect(result[point.y * 10 + point.x]).toBe(INK);
    }
  });

  it("returns the same hot-path footprint without allocating a full raster", () => {
    const options = { radius: 2, hardness: 0.8, density: 1, seed: 7 };
    const raster = rasterBrushLine(
      new Uint16Array(20 * 20),
      20,
      20,
      { x: 2, y: 3 },
      { x: 15, y: 11 },
      INK,
      options,
    );
    const edits = rasterBrushEdits(
      20,
      20,
      { x: 2, y: 3 },
      { x: 15, y: 11 },
      INK,
      options,
    );
    const fromEdits = new Uint16Array(20 * 20);
    for (const edit of edits) fromEdits[edit.index] = edit.value;
    expect(fromEdits).toEqual(raster);
  });
});

describe("rectangles and ellipses", () => {
  it("draws rectangle outlines and fills, including reversed corners", () => {
    const source = new Uint16Array(36);
    const outline = rasterRectangle(
      source,
      6,
      6,
      { x: 4, y: 4 },
      { x: 1, y: 1 },
      INK,
    );
    expect(painted(outline)).toHaveLength(12);
    expect(outline[2 * 6 + 2]).toBe(0);
    const fill = rasterRectangle(
      source,
      6,
      6,
      { x: 1, y: 1 },
      { x: 4, y: 4 },
      INK,
      { fill: true },
    );
    expect(painted(fill)).toHaveLength(16);
  });

  it("clips rectangles that extend beyond the canvas", () => {
    const fill = rasterRectangle(
      new Uint16Array(16),
      4,
      4,
      { x: -5, y: -5 },
      { x: 1, y: 1 },
      INK,
      { fill: true },
    );
    expect(painted(fill)).toEqual([0, 1, 4, 5]);
  });

  it("draws a hollow ellipse outline and a denser filled ellipse", () => {
    const source = new Uint16Array(11 * 11);
    const outline = rasterEllipse(
      source,
      11,
      11,
      { x: 2, y: 1 },
      { x: 8, y: 9 },
      INK,
    );
    const fill = rasterEllipse(
      source,
      11,
      11,
      { x: 2, y: 1 },
      { x: 8, y: 9 },
      INK,
      { fill: true },
    );
    expect(outline[5 * 11 + 5]).toBe(0);
    expect(fill[5 * 11 + 5]).toBe(INK);
    expect(painted(fill).length).toBeGreaterThan(painted(outline).length);
  });

  it("handles a one-cell ellipse", () => {
    const result = rasterEllipse(
      new Uint16Array(9),
      3,
      3,
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      INK,
    );
    expect(painted(result)).toEqual([4]);
  });
});

describe("flood fill and lasso", () => {
  it("fills only the four-connected target region", () => {
    const source = new Uint16Array(7 * 5);
    const cells = rasterRectangle(
      source,
      7,
      5,
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      INK,
      { fill: true },
    );
    const result = floodFill4(cells, 7, 5, { x: 0, y: 0 }, SHADOW);
    expect(result[0]).toBe(SHADOW);
    expect(result[1]).toBe(SHADOW);
    expect(result[2]).toBe(INK);
    expect(result[3]).toBe(0);
    expect(cells[0]).toBe(0);
  });

  it("fills a large raster iteratively without stack recursion", () => {
    const result = floodFill4(
      new Uint16Array(300 * 200),
      300,
      200,
      { x: 150, y: 100 },
      INK,
    );
    expect(result.every((cell) => cell === INK)).toBe(true);
  });

  it("creates a polygon mask and applies it without mutating the source", () => {
    const mask = polygonLassoMask(6, 6, [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 1, y: 4 },
    ]);
    expect(mask[2 * 6 + 2]).toBe(1);
    expect(mask[0]).toBe(0);
    const source = new Uint16Array(36);
    const result = paintRasterMask(source, 6, 6, mask, INK);
    expect(source[2 * 6 + 2]).toBe(0);
    expect(result[2 * 6 + 2]).toBe(INK);
    expect(result[0]).toBe(0);
  });

  it("returns an empty mask for fewer than three lasso points", () => {
    expect(
      polygonLassoMask(3, 3, [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ]).some((value) => value !== 0),
    ).toBe(false);
  });
});
