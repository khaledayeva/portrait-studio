import { describe, expect, it } from "vitest";
import {
  PORTRAIT_MAX_JSON_BYTES,
  canonicalStringify,
  decodeCellRle,
  encodeCellRle,
  hashPortraitBlueprint,
  hashPortraitComposite,
  hashPortraitLayer,
  hashPortraitLayers,
  parsePortraitBlueprint,
  portraitJsonByteLength,
  serializePortraitBlueprint,
} from "./portrait-blueprint-codec";
import {
  createPortraitBlueprint,
  createPortraitLayer,
  CUTOUT_CELL,
  packPortraitCell,
  PORTRAIT_CELL_COUNT,
  PORTRAIT_MAX_LAYERS,
} from "./portrait-blueprint";

describe("portrait cell RLE", () => {
  it("round-trips transparency, paint, and cutout cells losslessly", () => {
    const light = packPortraitCell(1, 255);
    const shirt = packPortraitCell(6, 71);
    const cells = new Uint16Array([0, 0, light, light, light, CUTOUT_CELL, shirt, 0]);
    const encoded = encodeCellRle(cells);
    expect(encoded).toEqual([2, 0, 3, light, 1, CUTOUT_CELL, 1, shirt, 1, 0]);
    expect(Array.from(decodeCellRle(encoded, cells.length))).toEqual(Array.from(cells));
  });

  it("handles an empty raster only when zero cells are expected", () => {
    expect(encodeCellRle(new Uint16Array())).toEqual([]);
    expect(decodeCellRle([], 0)).toEqual(new Uint16Array());
    expect(() => decodeCellRle([], 1)).toThrow(RangeError);
  });

  it("rejects malformed pairs, non-positive runs, invalid cells, and wrong totals", () => {
    expect(() => decodeCellRle([1], 1)).toThrow(TypeError);
    expect(() => decodeCellRle([0, 0], 1)).toThrow(TypeError);
    expect(() => decodeCellRle([1.5, 0], 1)).toThrow(TypeError);
    expect(() => decodeCellRle([1, 0x0100], 1)).toThrow(TypeError);
    expect(() => decodeCellRle([2, 0], 1)).toThrow(RangeError);
    expect(() => decodeCellRle([1, 0], 2)).toThrow(RangeError);
  });
});

describe("canonical portrait JSON", () => {
  it("sorts object keys recursively while retaining array order", () => {
    expect(canonicalStringify({ z: 1, a: { d: 4, b: 2 }, list: [3, 1] })).toBe(
      '{"a":{"b":2,"d":4},"list":[3,1],"z":1}',
    );
  });

  it("round-trips a complete blueprint and preserves ordered layers", () => {
    const blueprint = createPortraitBlueprint("Exact Portrait", "/portrait.png");
    blueprint.layers[0].cells[0] = packPortraitCell(1, 220);
    blueprint.layers[1].cells[PORTRAIT_CELL_COUNT - 1] = CUTOUT_CELL;
    const json = serializePortraitBlueprint(blueprint);
    const parsed = parsePortraitBlueprint(json);
    expect(parsed.metadata).toEqual(blueprint.metadata);
    expect(parsed.materials[0].runtime).toEqual(blueprint.materials[0].runtime);
    expect(parsed.layers.map((layer) => layer.id)).toEqual(["portrait", "details"]);
    expect(Array.from(parsed.layers[0].cells)).toEqual(
      Array.from(blueprint.layers[0].cells),
    );
    expect(serializePortraitBlueprint(parsed)).toBe(json);
  });

  it("canonicalizes material order but never layer order", () => {
    const blueprint = createPortraitBlueprint();
    const canonical = serializePortraitBlueprint(blueprint);
    blueprint.materials.reverse();
    expect(serializePortraitBlueprint(blueprint)).toBe(canonical);
    blueprint.layers.reverse();
    expect(serializePortraitBlueprint(blueprint)).not.toBe(canonical);
  });

  it("strictly rejects unknown JSON fields and malformed layer RLE", () => {
    const json = serializePortraitBlueprint(createPortraitBlueprint());
    const withUnknown = JSON.parse(json) as Record<string, unknown>;
    withUnknown.extra = true;
    expect(() => parsePortraitBlueprint(JSON.stringify(withUnknown))).toThrow(
      /unknown properties/,
    );

    const malformed = JSON.parse(json) as {
      layers: Array<{ rle: number[] }>;
    };
    malformed.layers[0].rle = [PORTRAIT_CELL_COUNT + 1, 0];
    expect(() => parsePortraitBlueprint(JSON.stringify(malformed))).toThrow(RangeError);
  });

  it("rejects syntactically invalid JSON with a useful error", () => {
    expect(() => parsePortraitBlueprint("{")) .toThrow(/not valid JSON/);
  });

  it("rejects oversized input before parsing", () => {
    const oversized = "x".repeat(PORTRAIT_MAX_JSON_BYTES + 1);
    expect(() => parsePortraitBlueprint(oversized)).toThrow(/exceeds/);
  });

  it("rejects layer, material, and glyph allocation bombs", () => {
    const canonical = serializePortraitBlueprint(createPortraitBlueprint());
    const tooManyLayers = JSON.parse(canonical) as {
      layers: Array<Record<string, unknown>>;
    };
    const layer = tooManyLayers.layers[0];
    tooManyLayers.layers = Array.from({ length: 33 }, (_, index) => ({
      ...layer,
      id: `layer-${index}`,
    }));
    expect(() => parsePortraitBlueprint(JSON.stringify(tooManyLayers))).toThrow(
      /at most 32/,
    );

    const tooManyMaterials = JSON.parse(canonical) as {
      materials: Array<Record<string, unknown>>;
    };
    const material = tooManyMaterials.materials[0];
    tooManyMaterials.materials = Array.from({ length: 33 }, (_, index) => ({
      ...material,
      id: index + 1,
      key: `material-${index}`,
    }));
    expect(() =>
      parsePortraitBlueprint(JSON.stringify(tooManyMaterials)),
    ).toThrow(/at most 32/);

    const tooManyGlyphs = JSON.parse(canonical) as {
      materials: Array<{ glyphs: string }>;
    };
    tooManyGlyphs.materials[0].glyphs = "@".repeat(65);
    expect(() => parsePortraitBlueprint(JSON.stringify(tooManyGlyphs))).toThrow(
      /too many glyphs/,
    );
  });

  it("round-trips the maximum fragmented schema document within one byte limit", () => {
    const blueprint = createPortraitBlueprint("Maximum fragmentation");
    blueprint.materials[8].id = 254;
    const first = packPortraitCell(254, 255);
    const second = packPortraitCell(254, 254);
    blueprint.layers = Array.from({ length: PORTRAIT_MAX_LAYERS }, (_, index) => {
      const layer = createPortraitLayer(`layer-${index}`, `Layer ${index + 1}`);
      for (let cellIndex = 0; cellIndex < layer.cells.length; cellIndex++) {
        layer.cells[cellIndex] = cellIndex % 2 === 0 ? first : second;
      }
      return layer;
    });

    const json = serializePortraitBlueprint(blueprint);
    expect(portraitJsonByteLength(json)).toBeLessThanOrEqual(
      PORTRAIT_MAX_JSON_BYTES,
    );
    const parsed = parsePortraitBlueprint(json);
    expect(parsed.layers).toHaveLength(PORTRAIT_MAX_LAYERS);
    expect(parsed.layers.at(-1)?.cells[PORTRAIT_CELL_COUNT - 1]).toBe(second);
    expect(serializePortraitBlueprint(parsed)).toBe(json);
  });
});

describe("portrait hashes", () => {
  it("is deterministic and changes for document-only metadata", () => {
    const first = createPortraitBlueprint("One");
    const second = createPortraitBlueprint("One");
    expect(hashPortraitBlueprint(first)).toBe(hashPortraitBlueprint(second));
    expect(hashPortraitComposite(first)).toBe(hashPortraitComposite(second));
    second.metadata.name = "Two";
    expect(hashPortraitBlueprint(first)).not.toBe(hashPortraitBlueprint(second));
    expect(hashPortraitComposite(first)).toBe(hashPortraitComposite(second));
  });

  it("changes composite and per-layer hashes for one changed cell", () => {
    const blueprint = createPortraitBlueprint();
    const beforeComposite = hashPortraitComposite(blueprint);
    const beforeLayer = hashPortraitLayer(blueprint.layers[0]);
    blueprint.layers[0].cells[99] = packPortraitCell(5, 155);
    expect(hashPortraitComposite(blueprint)).not.toBe(beforeComposite);
    expect(hashPortraitLayer(blueprint.layers[0])).not.toBe(beforeLayer);
    expect(hashPortraitLayers(blueprint)).toEqual({
      portrait: hashPortraitLayer(blueprint.layers[0]),
      details: hashPortraitLayer(blueprint.layers[1]),
    });
  });
});
