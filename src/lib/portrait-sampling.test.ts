import { describe, expect, it } from "vitest";
import {
  PORTRAIT_GRID_HEIGHT,
  PORTRAIT_GRID_WIDTH,
  TRANSPARENT_CELL,
  createPortraitBlueprint,
  packPortraitCell,
  portraitCellIntensity,
  portraitCellMaterialId,
} from "./portrait-blueprint";
import { portraitGlyphForCell, samplePortraitBlueprint } from "./portrait-sampling";

const EXACT_RUNTIME_GRIDS = [
  { viewport: "717x1000", width: 91, height: 136 },
  { viewport: "1280x1200", width: 108, height: 162 },
  { viewport: "1600x900", width: 82, height: 122 },
] as const;

describe("portrait runtime sampling", () => {
  it("keeps semantic material ids and intensity when sampling matching dimensions", () => {
    const blueprint = createPortraitBlueprint();
    blueprint.layers[0].cells[123] = packPortraitCell(4, 217);
    const sampled = samplePortraitBlueprint(
      blueprint,
      PORTRAIT_GRID_WIDTH,
      PORTRAIT_GRID_HEIGHT,
    );
    expect(sampled[123]).toBe(packPortraitCell(4, 217));
  });

  it("preserves a deliberate outline against an equally covered ordinary material", () => {
    const blueprint = createPortraitBlueprint();
    const layer = blueprint.layers[0];
    layer.cells[0] = packPortraitCell(1, 220);
    layer.cells[1] = packPortraitCell(9, 250);
    const sampled = samplePortraitBlueprint(blueprint, 96, 144);
    expect(portraitCellMaterialId(sampled[0])).toBe(9);
  });

  it("weights fractional source overlap instead of growing a thin contour", () => {
    const blueprint = createPortraitBlueprint();
    const layer = blueprint.layers[0];
    layer.cells[0] = packPortraitCell(1, 220);
    layer.cells[1] = packPortraitCell(9, 250);

    // At 128 columns, target cell zero covers all of source column zero but
    // only half of column one. The ordinary material therefore owns 2/3 of
    // the footprint and must beat the outline's 1/3 coverage.
    const sampled = samplePortraitBlueprint(blueprint, 128, PORTRAIT_GRID_HEIGHT);
    expect(portraitCellMaterialId(sampled[0])).toBe(1);
  });

  it("uses overlap-weighted intensity for the winning material", () => {
    const blueprint = createPortraitBlueprint();
    const layer = blueprint.layers[0];
    layer.cells[0] = packPortraitCell(1, 100);
    layer.cells[1] = packPortraitCell(1, 200);

    // Full weight for column zero and half weight for column one:
    // (100 * 1 + 200 * .5) / 1.5 = 133.33.
    const sampled = samplePortraitBlueprint(blueprint, 128, PORTRAIT_GRID_HEIGHT);
    expect(portraitCellIntensity(sampled[0])).toBe(133);
  });

  it("requires minCoverage before sampling priority can promote a material", () => {
    const blueprint = createPortraitBlueprint();
    const skin = blueprint.materials.find((material) => material.id === 1);
    expect(skin).toBeDefined();
    skin!.runtime.minCoverage = 0.4;
    skin!.runtime.samplingPriority = 2;
    blueprint.layers[0].cells[0] = packPortraitCell(1, 220);

    // One source cell covers 1/3 of the first 3x1 runtime footprint.
    const sampled = samplePortraitBlueprint(blueprint, 64, PORTRAIT_GRID_HEIGHT);
    expect(sampled[0]).toBe(TRANSPARENT_CELL);
  });

  it.each(EXACT_RUNTIME_GRIDS)(
    "preserves one authored outline column without growth at $viewport",
    ({ width, height }) => {
      const blueprint = createPortraitBlueprint();
      const layer = blueprint.layers[0];
      const sourceColumn = PORTRAIT_GRID_WIDTH / 2;
      for (let row = 0; row < PORTRAIT_GRID_HEIGHT; row++) {
        layer.cells[row * PORTRAIT_GRID_WIDTH + sourceColumn] =
          packPortraitCell(9, 250);
      }

      const sampled = samplePortraitBlueprint(blueprint, width, height);
      const expectedColumn = Math.floor(
        (sourceColumn * width) / PORTRAIT_GRID_WIDTH,
      );
      let paintedCount = 0;
      for (let row = 0; row < height; row++) {
        let paintedInRow = 0;
        for (let column = 0; column < width; column++) {
          const materialId = portraitCellMaterialId(
            sampled[row * width + column],
          );
          if (materialId !== 0) {
            paintedCount++;
            paintedInRow++;
            expect(column).toBe(expectedColumn);
            expect(materialId).toBe(9);
          }
        }
        expect(paintedInRow).toBe(1);
      }
      expect(paintedCount).toBe(height);
    },
  );

  it("only returns glyphs from the cell material family", () => {
    const blueprint = createPortraitBlueprint();
    const material = blueprint.materials.find((candidate) => candidate.id === 5);
    expect(material).toBeDefined();
    for (let frame = 0; frame < 300; frame++) {
      const glyph = portraitGlyphForCell(
        packPortraitCell(5, 150),
        material!,
        42,
        frame,
      );
      expect(Array.from(material!.glyphs)).toContain(glyph);
    }
  });
});
