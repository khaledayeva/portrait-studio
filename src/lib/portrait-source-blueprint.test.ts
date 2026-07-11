import { describe, expect, it } from "vitest";
import {
  PORTRAIT_CELL_COUNT,
  PORTRAIT_GRID_HEIGHT,
  PORTRAIT_GRID_WIDTH,
  portraitCellMaterialId,
} from "./portrait-blueprint";
import { createBlueprintFromSourcePixels } from "./portrait-source-blueprint";

function blankSource() {
  return new Uint8ClampedArray(PORTRAIT_CELL_COUNT * 4);
}

function paintPixel(
  pixels: Uint8ClampedArray,
  column: number,
  row: number,
  value = 255,
) {
  const index = (row * PORTRAIT_GRID_WIDTH + column) * 4;
  pixels[index] = value;
  pixels[index + 1] = value;
  pixels[index + 2] = value;
  pixels[index + 3] = 255;
}

describe("source portrait conversion", () => {
  it("creates the expected editable semantic layer set", () => {
    const blueprint = createBlueprintFromSourcePixels(blankSource());
    expect(blueprint.layers.map((layer) => layer.id)).toEqual([
      "shirt",
      "neck",
      "face",
      "hair",
      "beard",
      "censor",
      "highlights",
    ]);
  });

  it("routes source landmarks into the intended semantic layers", () => {
    const pixels = blankSource();
    paintPixel(pixels, 96, Math.floor(PORTRAIT_GRID_HEIGHT * 0.18));
    paintPixel(pixels, 96, Math.floor(PORTRAIT_GRID_HEIGHT * 0.29));
    paintPixel(pixels, 96, Math.floor(PORTRAIT_GRID_HEIGHT * 0.38));
    paintPixel(pixels, 96, Math.floor(PORTRAIT_GRID_HEIGHT * 0.48));
    paintPixel(pixels, 96, Math.floor(PORTRAIT_GRID_HEIGHT * 0.7));

    const blueprint = createBlueprintFromSourcePixels(pixels);
    for (const layerId of ["hair", "censor", "face", "neck", "shirt"]) {
      const layer = blueprint.layers.find((candidate) => candidate.id === layerId);
      expect(layer).toBeDefined();
      expect(layer?.cells.some((cell) => portraitCellMaterialId(cell) > 0)).toBe(true);
    }
  });

  it("rejects pixel buffers that cannot represent the fixed master grid", () => {
    expect(() => createBlueprintFromSourcePixels(new Uint8ClampedArray(4))).toThrow(
      `Source pixels must contain exactly ${
        PORTRAIT_GRID_WIDTH * PORTRAIT_GRID_HEIGHT * 4
      } values`,
    );
  });
});
