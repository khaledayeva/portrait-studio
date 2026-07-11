import { describe, expect, it } from "vitest";
import {
  assertValidPortraitBlueprint,
  BLUEPRINT_VERSION,
  clonePortraitBlueprint,
  compositePortraitBlueprint,
  createPortraitBlueprint,
  createPortraitLayer,
  CUTOUT_CELL,
  DEFAULT_PORTRAIT_MATERIALS,
  isPortraitCellValid,
  packPortraitCell,
  PORTRAIT_CELL_COUNT,
  PORTRAIT_GRID_HEIGHT,
  PORTRAIT_GRID_WIDTH,
  portraitCellIntensity,
  portraitCellMaterialId,
  TRANSPARENT_CELL,
  validatePortraitBlueprint,
} from "./portrait-blueprint";

describe("portrait blueprint cells", () => {
  it("packs a material id and byte intensity without losing either", () => {
    const cell = packPortraitCell(7, 219);
    expect(cell).toBe(0x07db);
    expect(portraitCellMaterialId(cell)).toBe(7);
    expect(portraitCellIntensity(cell)).toBe(219);
    expect(isPortraitCellValid(cell)).toBe(true);
  });

  it("reserves zero for transparency and 0xffff for cutout", () => {
    expect(TRANSPARENT_CELL).toBe(0);
    expect(CUTOUT_CELL).toBe(0xffff);
    expect(portraitCellMaterialId(CUTOUT_CELL)).toBe(0);
    expect(portraitCellIntensity(CUTOUT_CELL)).toBe(0);
    expect(isPortraitCellValid(0x0100)).toBe(false);
  });

  it("rejects identifiers and intensities that collide with reserved values", () => {
    expect(() => packPortraitCell(0, 200)).toThrow(RangeError);
    expect(() => packPortraitCell(255, 200)).toThrow(RangeError);
    expect(() => packPortraitCell(1, 0)).toThrow(RangeError);
    expect(() => packPortraitCell(1, 256)).toThrow(RangeError);
  });
});

describe("portrait blueprint documents", () => {
  it("creates the fixed 2:3 document with all semantic materials embedded", () => {
    const blueprint = createPortraitBlueprint();
    expect(blueprint.version).toBe(BLUEPRINT_VERSION);
    expect(blueprint.width).toBe(PORTRAIT_GRID_WIDTH);
    expect(blueprint.height).toBe(PORTRAIT_GRID_HEIGHT);
    expect(blueprint.width / blueprint.height).toBe(2 / 3);
    expect(blueprint.layers.every((layer) => layer.cells.length === PORTRAIT_CELL_COUNT)).toBe(
      true,
    );
    expect(DEFAULT_PORTRAIT_MATERIALS.map((material) => material.name)).toEqual([
      "Skin Light",
      "Skin Mid",
      "Skin Shadow",
      "Hair",
      "Beard",
      "Shirt",
      "Neck Highlight",
      "Censor",
      "Outline",
    ]);
    expect(validatePortraitBlueprint(blueprint)).toEqual({ valid: true, errors: [] });
  });

  it("creates independent layer and material storage for every document", () => {
    const first = createPortraitBlueprint();
    const second = createPortraitBlueprint();
    first.layers[0].cells[10] = packPortraitCell(1, 200);
    first.materials[0].glyphs = "X";
    expect(second.layers[0].cells[10]).toBe(0);
    expect(second.materials[0].glyphs).not.toBe("X");
  });

  it("deep-clones cells, layers, materials, and metadata", () => {
    const original = createPortraitBlueprint("Original");
    original.layers[0].cells[4] = packPortraitCell(2, 99);
    const clone = clonePortraitBlueprint(original);
    clone.metadata.name = "Clone";
    clone.layers[0].cells[4] = packPortraitCell(3, 88);
    clone.materials[0].name = "Changed";
    expect(original.metadata.name).toBe("Original");
    expect(original.layers[0].cells[4]).toBe(packPortraitCell(2, 99));
    expect(original.materials[0].name).toBe("Skin Light");
  });

  it("strictly rejects unknown properties, wrong grid sizes, and missing materials", () => {
    const blueprint = createPortraitBlueprint();
    const unknown = { ...blueprint, surprise: true };
    expect(validatePortraitBlueprint(unknown).valid).toBe(false);

    const wrongWidth = { ...blueprint, width: 193 };
    expect(validatePortraitBlueprint(wrongWidth).valid).toBe(false);

    blueprint.layers[0].cells[0] = packPortraitCell(42, 100);
    const result = validatePortraitBlueprint(blueprint);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toContain("missing material 42");
    expect(() => assertValidPortraitBlueprint(blueprint)).toThrow(TypeError);
  });

  it("rejects duplicate material and layer identities", () => {
    const blueprint = createPortraitBlueprint();
    blueprint.materials.push({ ...blueprint.materials[0] });
    blueprint.layers.push(createPortraitLayer("portrait", "Duplicate"));
    const result = validatePortraitBlueprint(blueprint);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("materials[9].id"))).toBe(true);
      expect(result.errors.some((error) => error.includes("layers[2].id"))).toBe(true);
    }
  });
});

describe("portrait compositing", () => {
  it("uses the topmost visible painted cell", () => {
    const blueprint = createPortraitBlueprint();
    const bottom = packPortraitCell(1, 180);
    const top = packPortraitCell(4, 220);
    blueprint.layers[0].cells[7] = bottom;
    blueprint.layers[1].cells[7] = top;
    expect(compositePortraitBlueprint(blueprint)[7]).toBe(top);

    blueprint.layers[1].visible = false;
    expect(compositePortraitBlueprint(blueprint)[7]).toBe(bottom);
  });

  it("lets transparency reveal below and cutout erase below", () => {
    const blueprint = createPortraitBlueprint();
    const bottom = packPortraitCell(6, 72);
    blueprint.layers[0].cells[3] = bottom;
    expect(compositePortraitBlueprint(blueprint)[3]).toBe(bottom);

    blueprint.layers[1].cells[3] = CUTOUT_CELL;
    expect(compositePortraitBlueprint(blueprint)[3]).toBe(TRANSPARENT_CELL);

    blueprint.layers[1].visible = false;
    expect(compositePortraitBlueprint(blueprint)[3]).toBe(bottom);
  });
});
