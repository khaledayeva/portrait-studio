import { describe, expect, it } from "vitest";
import {
  TRANSPARENT_CELL,
  createPortraitBlueprint,
  packPortraitCell,
  portraitCellMaterialId,
} from "./portrait-blueprint";
import type { Cell } from "./halftone";
import {
  parsePortraitBlueprint,
  serializePortraitBlueprint,
} from "./portrait-blueprint-codec";
import {
  applyPortraitBlueprintToCells,
  createPortraitRuntimeGrid,
  portraitRuntimeAppearance,
  portraitRuntimeLayout,
} from "./portrait-runtime";

const VIEWPORT_GRIDS = [
  { viewport: [717, 1000], portrait: [91, 136] },
  { viewport: [1280, 1200], portrait: [108, 162] },
  { viewport: [1600, 900], portrait: [82, 122] },
] as const;

describe("shared portrait runtime", () => {
  it.each(VIEWPORT_GRIDS)(
    "matches the live portrait grid at $viewport",
    ({ viewport, portrait }) => {
      const layout = portraitRuntimeLayout(viewport[0], viewport[1]);
      expect([layout.portraitColumns, layout.portraitRows]).toEqual(portrait);
    },
  );

  it.each(VIEWPORT_GRIDS)(
    "applies a canonical export at the $viewport runtime grid",
    ({ viewport }) => {
      const authored = createPortraitBlueprint("Runtime contract");
      for (let row = 70; row < 220; row++) {
        authored.layers[0].cells[row * authored.width + 96] =
          packPortraitCell(9, 250);
      }
      const imported = parsePortraitBlueprint(
        serializePortraitBlueprint(authored),
      );
      const layout = portraitRuntimeLayout(viewport[0], viewport[1]);
      expect(
        createPortraitRuntimeGrid(imported, layout),
      ).toEqual(createPortraitRuntimeGrid(authored, layout));
    },
  );

  it("applies exactly the same sampled document grid the editor previews", () => {
    const blueprint = createPortraitBlueprint();
    const layout = portraitRuntimeLayout(717, 1000);
    const sourceIndex = 144 * blueprint.width + 96;
    blueprint.layers[0].cells[sourceIndex] = packPortraitCell(7, 241);
    const sampled = createPortraitRuntimeGrid(blueprint, layout);
    const cells: Cell[] = Array.from(
      { length: layout.columns * layout.rows },
      (_, index) => {
        const column = index % layout.columns;
        const row = Math.floor(index / layout.columns);
        const portraitX = column - layout.portraitColumn;
        const portraitY = row - layout.portraitRow;
        return {
          x: column * layout.spacing + layout.spacing / 2,
          y: row * layout.spacing + layout.spacing / 2,
          alpha: 0.14,
          tone: 0,
          figure: false,
          halo: false,
          censor: false,
          nx: (portraitX + 0.5) / layout.portraitColumns,
          ny: (portraitY + 0.5) / layout.portraitRows,
          phase: 0,
          seed: 0.5,
        };
      },
    );

    const applied = applyPortraitBlueprintToCells(
      cells,
      blueprint,
      layout,
      0.14,
    );
    for (let gridIndex = 0; gridIndex < applied.length; gridIndex++) {
      const gridColumn = gridIndex % layout.columns;
      const gridRow = Math.floor(gridIndex / layout.columns);
      const column = gridColumn - layout.portraitColumn;
      const row = gridRow - layout.portraitRow;
      const insidePortrait =
        column >= 0 &&
        column < layout.portraitColumns &&
        row >= 0 &&
        row < layout.portraitRows;
      const sampledCell = insidePortrait
        ? sampled[row * layout.portraitColumns + column]
        : TRANSPARENT_CELL;
      const rendered = applied[gridIndex];
      if (sampledCell === TRANSPARENT_CELL) {
        expect(rendered.figure).toBe(false);
      } else {
        expect(rendered.portraitCellValue).toBe(sampledCell);
        expect(rendered.portraitMaterialId).toBe(
          portraitCellMaterialId(sampledCell),
        );
      }
    }
  });

  it("returns deterministic material animation state for a timestamp", () => {
    const blueprint = createPortraitBlueprint();
    const material = blueprint.materials.find(({ id }) => id === 8)!;
    const cell = packPortraitCell(material.id, 255);
    const first = portraitRuntimeAppearance(
      cell,
      material,
      42,
      1350,
      0.5,
      0.3,
      10,
      true,
    );
    const second = portraitRuntimeAppearance(
      cell,
      material,
      42,
      1350,
      0.5,
      0.3,
      10,
      true,
    );
    expect(second).toEqual(first);
    expect(Array.from(material.glyphs)).toContain(first.glyph);
  });
});
