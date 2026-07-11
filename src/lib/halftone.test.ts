import { describe, expect, it } from "vitest";
import {
  applyHalo,
  BREATH_PERIOD_S,
  breathingOffset,
  buildCellGrid,
  fillHoles,
  fillLowerBody,
  fitPortraitRect,
  hash01,
  luminance,
  MAX_BREATHING_DX,
  MAX_BREATHING_DY,
  SHIMMER_DEPTH,
  shimmer,
  smoothstep,
  type CellGridOptions,
  type FillHolesOptions,
  type HaloOptions,
  type LowerBodyFillOptions,
} from "./halftone";

describe("luminance", () => {
  it("is 1 for opaque white and 0 for black or transparent", () => {
    expect(luminance(255, 255, 255, 255)).toBeCloseTo(1);
    expect(luminance(0, 0, 0, 255)).toBe(0);
    expect(luminance(255, 255, 255, 0)).toBe(0);
  });

  it("scales with alpha", () => {
    expect(luminance(255, 255, 255, 128)).toBeCloseTo(128 / 255, 5);
  });

  it("weights green heaviest per Rec. 709", () => {
    expect(luminance(0, 255, 0, 255)).toBeGreaterThan(luminance(255, 0, 0, 255));
    expect(luminance(255, 0, 0, 255)).toBeGreaterThan(luminance(0, 0, 255, 255));
  });
});

describe("fitPortraitRect", () => {
  it("preserves the image's proportions", () => {
    const rect = fitPortraitRect(1280, 1920, 1440, 900, 0.95);
    expect(rect.width / rect.height).toBeCloseTo(1280 / 1920, 5);
  });

  it("is height-limited in a landscape viewport and scaled down", () => {
    const rect = fitPortraitRect(1280, 1920, 1440, 900, 0.95);
    expect(rect.height).toBeCloseTo(900 * 0.95);
    expect(rect.width).toBeLessThan(1440);
  });

  it("is width-limited in a narrow viewport", () => {
    const rect = fitPortraitRect(1280, 1920, 375, 812, 0.95);
    expect(rect.width).toBeCloseTo(375 * 0.95);
    expect(rect.height).toBeLessThan(812);
  });

  it("centers the rect both ways", () => {
    const rect = fitPortraitRect(1280, 1920, 1440, 900, 0.95);
    expect(rect.x + rect.width / 2).toBeCloseTo(1440 / 2);
    expect(rect.y + rect.height / 2).toBeCloseTo(900 / 2);
  });

  it("supports zooming past the viewport (scale > 1) while staying centered", () => {
    const rect = fitPortraitRect(1280, 1920, 1440, 900, 1.35);
    expect(rect.height).toBeCloseTo(900 * 1.35);
    expect(rect.width / rect.height).toBeCloseTo(1280 / 1920, 5);
    expect(rect.y).toBeLessThan(0); // crop extends above the viewport
    expect(rect.x + rect.width / 2).toBeCloseTo(1440 / 2);
    expect(rect.y + rect.height / 2).toBeCloseTo(900 / 2);
  });
});

describe("buildCellGrid", () => {
  const baseOpts: CellGridOptions = {
    cols: 4,
    rows: 4,
    spacing: 10,
    portraitCol0: 1,
    portraitRow0: 1,
    portraitCols: 2,
    portraitRows: 2,
    minLuminance: 0.01,
    boost: 1,
    gamma: 1,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
    fieldAlpha: 0.07,
  };

  // 2x2 portrait: white, black, mid-grey, transparent.
  const portrait = new Uint8ClampedArray([
    255, 255, 255, 255, /* */ 0, 0, 0, 255,
    128, 128, 128, 255, /* */ 255, 255, 255, 0,
  ]);

  it("produces one cell per grid position", () => {
    expect(buildCellGrid(portrait, baseOpts)).toHaveLength(16);
  });

  it("classifies bright portrait cells as figure, everything else as field", () => {
    const cells = buildCellGrid(portrait, baseOpts);
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 1).figure).toBe(true); // white
    expect(at(2, 1).figure).toBe(false); // black -> field
    expect(at(1, 2).figure).toBe(true); // mid grey
    expect(at(2, 2).figure).toBe(false); // transparent -> field
    expect(at(0, 0).figure).toBe(false); // outside portrait
  });

  it("gives field cells the constant field alpha and figure cells the mapped range", () => {
    const cells = buildCellGrid(portrait, baseOpts);
    for (const cell of cells) {
      if (cell.figure) {
        expect(cell.alpha).toBeGreaterThanOrEqual(baseOpts.figureAlphaMin);
        expect(cell.alpha).toBeLessThanOrEqual(baseOpts.figureAlphaMax);
      } else {
        expect(cell.alpha).toBe(baseOpts.fieldAlpha);
      }
    }
    const white = cells[1 * 4 + 1];
    expect(white.alpha).toBeCloseTo(1);
  });

  it("encodes shaped brightness as tone: 1 for white figure cells, 0 for field", () => {
    const cells = buildCellGrid(portrait, baseOpts);
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 1).tone).toBeCloseTo(1); // white, boost 1 / gamma 1
    expect(at(1, 2).tone).toBeGreaterThan(0); // mid grey
    expect(at(1, 2).tone).toBeLessThan(1);
    expect(at(2, 1).tone).toBe(0); // black -> field
    expect(at(0, 0).tone).toBe(0); // outside portrait
    for (const cell of cells) {
      expect(cell.tone).toBeGreaterThanOrEqual(0);
      expect(cell.tone).toBeLessThanOrEqual(1);
    }
  });

  it("positions cells at their grid centers and normalizes portrait coords", () => {
    const cells = buildCellGrid(portrait, baseOpts);
    const white = cells[1 * 4 + 1];
    expect(white.x).toBe(15); // (col 1 + 0.5) * spacing 10
    expect(white.y).toBe(15);
    expect(white.nx).toBeCloseTo(0.25); // first of 2 portrait columns
    expect(white.ny).toBeCloseTo(0.25);
  });

  it("is deterministic (same input -> same phases and seeds)", () => {
    const a = buildCellGrid(portrait, baseOpts);
    const b = buildCellGrid(portrait, baseOpts);
    expect(a).toEqual(b);
  });

  it("applies the contrast S-curve: darks down, lights up, pivot anchored", () => {
    // Two-cell buffer: dark grey and bright grey.
    const data = new Uint8ClampedArray([50, 50, 50, 255, 220, 220, 220, 255]);
    const opts = {
      ...baseOpts,
      cols: 2,
      rows: 1,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 2,
      portraitRows: 1,
    };
    const flat = buildCellGrid(data, { ...opts, contrast: 1 });
    const omitted = buildCellGrid(data, opts);
    const curved = buildCellGrid(data, { ...opts, contrast: 1.6 });
    expect(omitted).toEqual(flat); // omitted contrast == 1 == no-op
    expect(curved[0].tone).toBeLessThan(flat[0].tone); // dark pushed darker
    expect(curved[1].tone).toBeGreaterThan(flat[1].tone); // light pushed lighter
    for (const cell of curved) {
      expect(cell.tone).toBeGreaterThanOrEqual(0);
      expect(cell.tone).toBeLessThanOrEqual(1);
    }
  });

  it("lifts figure tones inside the toneLift region only", () => {
    // Two mid-grey cells side by side; the lift region covers only the left.
    const data = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
    const opts = {
      ...baseOpts,
      cols: 2,
      rows: 1,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 2,
      portraitRows: 1,
    };
    const plain = buildCellGrid(data, opts);
    const lifted = buildCellGrid(data, {
      ...opts,
      // left cell nx = 0.25, right cell nx = 0.75
      toneLift: { nx0: 0, nx1: 0.5, ny0: 0, ny1: 1, amount: 0.45 },
    });
    expect(lifted[0].tone).toBeGreaterThan(plain[0].tone); // inside: lifted
    expect(lifted[0].tone).toBeLessThanOrEqual(1);
    expect(lifted[0].alpha).toBeGreaterThan(plain[0].alpha);
    expect(lifted[1]).toEqual(plain[1]); // outside: untouched
  });

  it("feathers the lift toward the region edges", () => {
    // Three mid-grey cells in a row; region spans the full row with a feather
    // wide enough that only the center cell gets the full lift.
    const data = new Uint8ClampedArray(3 * 4).fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const opts = {
      ...baseOpts,
      cols: 3,
      rows: 1,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 3,
      portraitRows: 1,
    };
    const plain = buildCellGrid(data, opts);
    const hard = buildCellGrid(data, {
      ...opts,
      toneLift: { nx0: 0, nx1: 1, ny0: 0, ny1: 1, amount: 0.45 },
    });
    const feathered = buildCellGrid(data, {
      ...opts,
      toneLift: { nx0: 0, nx1: 1, ny0: 0, ny1: 1, amount: 0.45, feather: 0.3 },
    });
    // feather 0 / omitted behaves identically to the hard edge
    expect(
      buildCellGrid(data, {
        ...opts,
        toneLift: { nx0: 0, nx1: 1, ny0: 0, ny1: 1, amount: 0.45, feather: 0 },
      }),
    ).toEqual(hard);
    // edge cell (nx 1/6, edge distance 0.166 < feather 0.3) lifted less than
    // the center cell (nx 0.5) but still more than no lift at all
    expect(feathered[1].tone).toBeGreaterThan(feathered[0].tone);
    expect(feathered[0].tone).toBeGreaterThan(plain[0].tone);
    expect(feathered[1].tone).toBeLessThanOrEqual(hard[1].tone);
  });

  it("accepts multiple toneLift regions; strongest applies, no stacking", () => {
    const data = new Uint8ClampedArray(3 * 4).fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const opts = {
      ...baseOpts,
      cols: 3,
      rows: 1,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 3,
      portraitRows: 1,
    };
    const plain = buildCellGrid(data, opts);
    const single = buildCellGrid(data, {
      ...opts,
      toneLift: { nx0: 0, nx1: 1, ny0: 0, ny1: 1, amount: 0.5 },
    });
    const cells = buildCellGrid(data, {
      ...opts,
      toneLift: [
        { nx0: 0, nx1: 0.4, ny0: 0, ny1: 1, amount: 0.5 }, // left cell only
        { nx0: 0, nx1: 1, ny0: 0, ny1: 1, amount: 0.2 }, // everywhere, weaker
      ],
    });
    expect(cells[0].tone).toBeCloseTo(single[0].tone); // max(0.5, 0.2), not stacked
    expect(cells[1].tone).toBeGreaterThan(plain[1].tone); // weak lift applies
    expect(cells[1].tone).toBeLessThan(cells[0].tone);
  });

  it("never creates figure cells inside the toneLift region (holes stay holes)", () => {
    // Both cells pure black; the lift region covers only the left one.
    const data = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const opts = {
      ...baseOpts,
      cols: 2,
      rows: 1,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 2,
      portraitRows: 1,
    };
    const cells = buildCellGrid(data, {
      ...opts,
      toneLift: { nx0: 0, nx1: 0.5, ny0: 0, ny1: 1, amount: 0.45 },
    });
    expect(cells[0].figure).toBe(false); // lift brightens, never paints
    expect(cells[0].alpha).toBe(baseOpts.fieldAlpha);
    expect(cells[1].figure).toBe(false);
  });

  it("marks figure cells inside the censor band and applies the alpha floor", () => {
    const cells = buildCellGrid(portrait, {
      ...baseOpts,
      censorBand: { nx0: 0, nx1: 1, ny0: 0, ny1: 1, alphaFloor: 0.85, margin: 0 },
    });
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 1).censor).toBe(true); // white figure cell in band
    expect(at(1, 1).alpha).toBeCloseTo(1); // already above the floor
    expect(at(1, 2).censor).toBe(true); // mid-grey figure cell in band
    expect(at(1, 2).alpha).toBe(0.85); // floor raised it
    expect(at(2, 1).censor).toBe(false); // black -> field, never censor
    expect(at(0, 0).censor).toBe(false); // outside portrait
  });

  it("does not mark figure cells outside the censor band", () => {
    const cells = buildCellGrid(portrait, {
      ...baseOpts,
      // band covers only the portrait's top half; grey cell sits at ny 0.75
      censorBand: { nx0: 0, nx1: 1, ny0: 0, ny1: 0.5, alphaFloor: 0.85, margin: 0 },
    });
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 1).censor).toBe(true); // white, ny 0.25
    expect(at(1, 2).censor).toBe(false); // grey, ny 0.75
    expect(at(1, 2).alpha).toBeLessThan(0.85); // no floor applied
  });

  it("demotes bright cells within the margin to field, carving a dark seam", () => {
    const seamOpts = {
      ...baseOpts,
      // band = top half; grey figure cell at ny 0.75 falls inside the margin
      censorBand: { nx0: 0, nx1: 1, ny0: 0, ny1: 0.5, alphaFloor: 1, margin: 0.3 },
    };
    const cells = buildCellGrid(portrait, seamOpts);
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 2).figure).toBe(false); // demoted: ny 0.75 <= 0.5 + 0.3
    expect(at(1, 2).censor).toBe(false);
    expect(at(1, 2).alpha).toBe(baseOpts.fieldAlpha);
    expect(at(1, 1).censor).toBe(true); // in-band cell untouched by the seam
    expect(at(1, 1).alpha).toBeCloseTo(1);

    // Smaller margin: the same grey cell stays a figure cell.
    const cellsSmallMargin = buildCellGrid(portrait, {
      ...seamOpts,
      censorBand: { ...seamOpts.censorBand, margin: 0.1 },
    });
    expect(cellsSmallMargin[2 * 4 + 1].figure).toBe(true);
  });
});

describe("applyHalo", () => {
  const gridOpts: CellGridOptions = {
    cols: 4,
    rows: 4,
    spacing: 10,
    portraitCol0: 1,
    portraitRow0: 1,
    portraitCols: 2,
    portraitRows: 2,
    minLuminance: 0.01,
    boost: 1,
    gamma: 1,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
    fieldAlpha: 0.07,
  };
  // Figure cells land at grid (1,1) and (1,2).
  const portrait = new Uint8ClampedArray([
    255, 255, 255, 255, /* */ 0, 0, 0, 255,
    128, 128, 128, 255, /* */ 255, 255, 255, 0,
  ]);
  const haloOpts: HaloOptions = {
    cols: 4,
    rows: 4,
    spacing: 10,
    rings: 1,
    probability: 1,
    alphaMin: 0.2,
    alphaMax: 0.34,
    jitter: 0.4,
  };
  const base = () => buildCellGrid(portrait, gridOpts);

  it("upgrades every adjacent field cell at probability 1 / rings 1", () => {
    const cells = applyHalo(base(), haloOpts);
    const at = (col: number, row: number) => cells[row * 4 + col];
    // 8-neighbours of the figure cells (1,1) and (1,2)
    for (const [col, row] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [1, 3], [2, 3]]) {
      expect(at(col, row).halo).toBe(true);
    }
    // Chebyshev distance 2 from any figure cell -> untouched
    expect(at(3, 0).halo).toBe(false);
  });

  it("never modifies figure cells and leaves far field cells identical", () => {
    const original = base();
    const cells = applyHalo(original, haloOpts);
    expect(cells[1 * 4 + 1]).toBe(original[1 * 4 + 1]); // same reference
    expect(cells[0 * 4 + 3]).toBe(original[0 * 4 + 3]); // far field cell
  });

  it("gives specs alpha within range and bounded position jitter", () => {
    const original = base();
    const cells = applyHalo(original, haloOpts);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i].halo) continue;
      expect(cells[i].alpha).toBeGreaterThanOrEqual(haloOpts.alphaMin);
      expect(cells[i].alpha).toBeLessThanOrEqual(haloOpts.alphaMax);
      const maxJitter = haloOpts.jitter * haloOpts.spacing;
      expect(Math.abs(cells[i].x - original[i].x)).toBeLessThanOrEqual(maxJitter);
      expect(Math.abs(cells[i].y - original[i].y)).toBeLessThanOrEqual(maxJitter);
    }
  });

  it("respects the ring limit", () => {
    // rings 2 on a wider grid: ring-1 cells all upgrade (p = 1), cells beyond
    // ring 2 never do
    const wide: CellGridOptions = { ...gridOpts, cols: 8, rows: 4 };
    const cells = applyHalo(buildCellGrid(portrait, wide), {
      ...haloOpts,
      cols: 8,
      rows: 4,
      rings: 2,
      probability: 1,
    });
    const at = (col: number, row: number) => cells[row * 8 + col];
    expect(at(2, 1).halo).toBe(true); // ring 1: p = 1, always upgrades
    for (let col = 4; col < 8; col++) {
      for (let row = 0; row < 4; row++) {
        expect(at(col, row).halo).toBe(false); // ring >= 3: beyond the halo
      }
    }
  });

  it("is deterministic", () => {
    expect(applyHalo(base(), haloOpts)).toEqual(applyHalo(base(), haloOpts));
  });

  it("keeps cells inside the silhouette hull spec-free", () => {
    // 4x4 grid fully covered by the portrait; figure cells at both ends of
    // row 1 -> the gap between them is interior hull, not halo territory.
    const hullOpts: CellGridOptions = {
      ...gridOpts,
      portraitCol0: 0,
      portraitRow0: 0,
      portraitCols: 4,
      portraitRows: 4,
    };
    const data = new Uint8ClampedArray(4 * 4 * 4); // all transparent
    const setWhite = (col: number, row: number) => {
      const i = (row * 4 + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    setWhite(0, 1);
    setWhite(3, 1);
    const cells = applyHalo(buildCellGrid(data, hullOpts), {
      ...haloOpts,
      rings: 1,
      probability: 1,
    });
    const at = (col: number, row: number) => cells[row * 4 + col];
    expect(at(1, 1).halo).toBe(false); // interior gap between the figure ends
    expect(at(2, 1).halo).toBe(false);
    expect(at(1, 1).alpha).toBe(hullOpts.fieldAlpha); // untouched field cell
    expect(at(1, 0).halo).toBe(true); // exterior neighbour above the hull
    expect(at(2, 2).halo).toBe(true); // exterior neighbour below the hull
  });
});

describe("fillHoles", () => {
  // 3x3 grid fully covered by the portrait: all white except a black center.
  const gridOpts: CellGridOptions = {
    cols: 3,
    rows: 3,
    spacing: 10,
    portraitCol0: 0,
    portraitRow0: 0,
    portraitCols: 3,
    portraitRows: 3,
    minLuminance: 0.01,
    boost: 1,
    gamma: 1,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
    fieldAlpha: 0.07,
  };
  const fillOpts: FillHolesOptions = {
    cols: 3,
    rows: 3,
    minFigureNeighbors: 5,
    toneScale: 0.65,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
  };
  const holeData = (): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    const center = (1 * 3 + 1) * 4;
    data[center] = data[center + 1] = data[center + 2] = 0; // black, opaque
    return data;
  };

  it("promotes a hole surrounded by figure cells with interpolated tone", () => {
    const cells = fillHoles(buildCellGrid(holeData(), gridOpts), fillOpts);
    const center = cells[1 * 3 + 1];
    expect(center.figure).toBe(true);
    expect(center.tone).toBeCloseTo(0.65); // 8 white neighbours (tone 1) x 0.65
    expect(center.alpha).toBeCloseTo(0.35 + 0.65 * 0.65);
    expect(center.halo).toBe(false);
  });

  it("leaves cells with too few figure neighbours untouched", () => {
    // Only the top row is figure: mid-row cells have 3 figure neighbours.
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let col = 0; col < 3; col++) {
      const i = col * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    }
    const original = buildCellGrid(data, gridOpts);
    const cells = fillHoles(original, fillOpts);
    expect(cells[1 * 3 + 1].figure).toBe(false);
    expect(cells[1 * 3 + 1]).toBe(original[1 * 3 + 1]); // same reference
  });

  it("passes figure cells through by reference and is deterministic", () => {
    const original = buildCellGrid(holeData(), gridOpts);
    const cells = fillHoles(original, fillOpts);
    expect(cells[0]).toBe(original[0]); // corner figure cell untouched
    expect(fillHoles(original, fillOpts)).toEqual(cells);
  });

  it("only fills holes inside the optional region", () => {
    const original = buildCellGrid(holeData(), gridOpts);
    // Center hole sits at nx = ny = 0.5; a region excluding it -> untouched.
    const outside = fillHoles(original, {
      ...fillOpts,
      region: { nx0: 0, nx1: 0.3, ny0: 0, ny1: 0.3 },
    });
    expect(outside[1 * 3 + 1]).toBe(original[1 * 3 + 1]);
    // A region containing it -> filled as usual.
    const inside = fillHoles(original, {
      ...fillOpts,
      region: { nx0: 0.3, nx1: 0.7, ny0: 0.3, ny1: 0.7 },
    });
    expect(inside[1 * 3 + 1].figure).toBe(true);
  });
});

describe("fillLowerBody", () => {
  // 6x8 grid fully covered by the portrait. Row ny values: (r + 0.5) / 8 =
  // 0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375.
  // Figure: solid block cols 1-3 rows 4-6 with an interior notch at (2,5);
  // col 4 has figure at rows 4 and 6 only (edge notch at (4,5));
  // col 5 has a single shallow figure cell at row 2.
  const gridOpts: CellGridOptions = {
    cols: 6,
    rows: 8,
    spacing: 10,
    portraitCol0: 0,
    portraitRow0: 0,
    portraitCols: 6,
    portraitRows: 8,
    minLuminance: 0.01,
    boost: 1,
    gamma: 1,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
    fieldAlpha: 0.07,
  };
  // dripMin == dripMax -> deterministic drip length without pinning the hash.
  const fillOpts: LowerBodyFillOptions = {
    cols: 6,
    rows: 8,
    startNy: 0.5,
    reach: 3,
    minSupport: 3,
    dripAnchorNy: 0.72,
    dripMinNy: 0.15,
    dripMaxNy: 0.15,
    endNy: 1,
    toneMin: 0.05,
    toneMax: 0.12,
    figureAlphaMin: 0.35,
    figureAlphaMax: 1,
  };
  const torsoData = (): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(6 * 8 * 4);
    const setWhite = (col: number, row: number) => {
      const i = (row * 6 + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    for (let row = 4; row <= 6; row++) {
      for (let col = 1; col <= 3; col++) setWhite(col, row);
    }
    const notch = (5 * 6 + 2) * 4; // (col 2, row 5) back to black
    data[notch] = data[notch + 1] = data[notch + 2] = 0;
    setWhite(4, 4);
    setWhite(4, 6);
    setWhite(5, 2);
    return data;
  };
  const run = (opts: LowerBodyFillOptions = fillOpts) =>
    fillLowerBody(buildCellGrid(torsoData(), gridOpts), opts);
  const at = (cells: ReturnType<typeof run>, col: number, row: number) =>
    cells[row * 6 + col];

  it("fills interior and edge notches (support >= 3 of 4 directions)", () => {
    const cells = run();
    const interior = at(cells, 2, 5); // figure on all four sides
    expect(interior.figure).toBe(true);
    expect(interior.halo).toBe(false);
    expect(interior.tone).toBeGreaterThanOrEqual(fillOpts.toneMin);
    expect(interior.tone).toBeLessThanOrEqual(fillOpts.toneMax);
    const edgeNotch = at(cells, 4, 5); // left/up/down support, open right
    expect(edgeNotch.figure).toBe(true);
  });

  it("keeps wide open lower torso bands as field instead of painting a block", () => {
    const wideGridOpts: CellGridOptions = {
      ...gridOpts,
      cols: 10,
      portraitCols: 10,
    };
    const wideFillOpts: LowerBodyFillOptions = {
      ...fillOpts,
      cols: 10,
      reach: 2,
    };
    const data = new Uint8ClampedArray(10 * 8 * 4);
    const setWhite = (col: number, row: number) => {
      const i = (row * 10 + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    for (let row = 4; row <= 6; row++) {
      setWhite(1, row);
      setWhite(8, row);
    }

    const cells = fillLowerBody(buildCellGrid(data, wideGridOpts), wideFillOpts);
    const wideAt = (col: number, row: number) => cells[row * 10 + col];

    expect(wideAt(1, 5).figure).toBe(true);
    expect(wideAt(8, 5).figure).toBe(true);
    expect(wideAt(0, 5).figure).toBe(false);
    for (let col = 2; col <= 7; col++) {
      expect(wideAt(col, 5).figure).toBe(false);
    }
    expect(wideAt(9, 5).figure).toBe(false);

    expect(wideAt(1, 7).figure).toBe(true);
    expect(wideAt(8, 7).figure).toBe(true);
    for (let col = 2; col <= 7; col++) {
      expect(wideAt(col, 7).figure).toBe(false);
    }
  });

  it("adds a modest seeded share of vertical torso bridge cells", () => {
    const cols = 40;
    const rows = 5;
    const bridgeGridOpts: CellGridOptions = {
      ...gridOpts,
      cols,
      rows,
      portraitCols: cols,
      portraitRows: rows,
    };
    const bridgeFillOpts: LowerBodyFillOptions = {
      ...fillOpts,
      cols,
      rows,
      startNy: 0.4,
      reach: 1,
      dripAnchorNy: 1,
      dripMinNy: 0,
      dripMaxNy: 0,
      endNy: 0.75,
    };
    const data = new Uint8ClampedArray(cols * rows * 4);
    const setWhite = (col: number, row: number) => {
      const i = (row * cols + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    for (let col = 0; col < cols; col++) {
      setWhite(col, 1);
      setWhite(col, 3);
    }

    const cells = fillLowerBody(buildCellGrid(data, bridgeGridOpts), bridgeFillOpts);
    let bridged = 0;
    for (let col = 0; col < cols; col++) {
      if (cells[2 * cols + col].figure) bridged++;
    }

    expect(bridged).toBeGreaterThanOrEqual(cols * 0.2);
    expect(bridged).toBeLessThanOrEqual(cols * 0.3);
    expect(bridged).toBeLessThan(cols);
  });

  it("carries support-filled torso bottoms into the drip pass", () => {
    const cols = 5;
    const rows = 6;
    const carryGridOpts: CellGridOptions = {
      ...gridOpts,
      cols,
      rows,
      portraitCols: cols,
      portraitRows: rows,
    };
    const carryFillOpts: LowerBodyFillOptions = {
      ...fillOpts,
      cols,
      rows,
      startNy: 0.5,
      reach: 1,
      dripAnchorNy: 0.5,
      dripMinNy: 0.17,
      dripMaxNy: 0.17,
      endNy: 1,
    };
    const data = new Uint8ClampedArray(cols * rows * 4);
    const setWhite = (col: number, row: number) => {
      const i = (row * cols + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    setWhite(2, 3);
    setWhite(1, 4);
    setWhite(3, 4);

    const cells = fillLowerBody(buildCellGrid(data, carryGridOpts), carryFillOpts);

    expect(cells[4 * cols + 2].figure).toBe(true);
    expect(cells[5 * cols + 2].figure).toBe(true);
  });

  it("keeps drip eligibility tied to source lower-body columns", () => {
    const cols = 5;
    const rows = 6;
    const gatedGridOpts: CellGridOptions = {
      ...gridOpts,
      cols,
      rows,
      portraitCols: cols,
      portraitRows: rows,
    };
    const gatedFillOpts: LowerBodyFillOptions = {
      ...fillOpts,
      cols,
      rows,
      startNy: 0.5,
      reach: 1,
      dripAnchorNy: 0.7,
      dripMinNy: 0.17,
      dripMaxNy: 0.17,
      endNy: 1,
    };
    const data = new Uint8ClampedArray(cols * rows * 4);
    const setWhite = (col: number, row: number) => {
      const i = (row * cols + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    };
    setWhite(2, 3);
    setWhite(1, 4);
    setWhite(3, 4);

    const cells = fillLowerBody(buildCellGrid(data, gatedGridOpts), gatedFillOpts);

    expect(cells[4 * cols + 2].figure).toBe(true);
    expect(cells[5 * cols + 2].figure).toBe(false);
  });

  it("leaves open pockets (support <= 2) untouched", () => {
    const original = buildCellGrid(torsoData(), gridOpts);
    const cells = fillLowerBody(original, fillOpts);
    expect(cells[5 * 6 + 0]).toBe(original[5 * 6 + 0]); // (0,5): right-only support
    expect(cells[4 * 6 + 5]).toBe(original[4 * 6 + 5]); // (5,4): left+up support
    expect(cells[5 * 6 + 5]).toBe(original[5 * 6 + 5]); // (5,5): left+up support
  });

  it("drips continuously off deep column bottoms, never off shallow ones", () => {
    const cells = run();
    // cols 1-4 bottom at ny 0.8125 >= anchor 0.72; drip end 0.9625 -> row 7
    for (const col of [1, 2, 3, 4]) {
      expect(at(cells, col, 7).figure).toBe(true);
    }
    // col 5 bottoms out at ny 0.3125 < anchor -> nothing below fills
    for (let row = 3; row < 8; row++) {
      expect(at(cells, 5, row).figure).toBe(false);
    }
  });

  it("caps drips at endNy", () => {
    const cells = run({ ...fillOpts, endNy: 0.9 });
    expect(at(cells, 2, 7).figure).toBe(false); // ny 0.9375 > 0.9
    expect(at(cells, 2, 6).figure).toBe(true); // block cell unaffected
  });

  it("leaves no vertical hole inside any column's filled run", () => {
    const cells = run();
    for (let col = 0; col < 6; col++) {
      let deepest = -1;
      for (let row = 0; row < 8; row++) {
        if (at(cells, col, row).figure) deepest = row;
      }
      let started = false;
      for (let row = 0; row <= deepest; row++) {
        const isFigure = at(cells, col, row).figure;
        if (isFigure) started = true;
        else if (started && at(cells, col, row).ny >= fillOpts.startNy) {
          throw new Error(`hole at col ${col} row ${row}`);
        }
      }
    }
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });
});

describe("breathingOffset", () => {
  it("stays within its documented amplitude bounds", () => {
    for (let t = 0; t < 60; t += 0.37) {
      for (const nx of [0, 0.25, 0.5, 0.75, 1]) {
        for (const ny of [0, 0.25, 0.5, 0.75, 1]) {
          const { dx, dy } = breathingOffset(t, nx, ny);
          expect(Math.abs(dx)).toBeLessThanOrEqual(MAX_BREATHING_DX);
          expect(Math.abs(dy)).toBeLessThanOrEqual(MAX_BREATHING_DY);
        }
      }
    }
  });

  it("moves the torso vertically more than the top of the head", () => {
    // Peak inhale for the primary breath component.
    const t = BREATH_PERIOD_S / 4;
    const head = breathingOffset(t, 0.5, 0.05);
    const torso = breathingOffset(t, 0.5, 0.9);
    expect(Math.abs(torso.dy)).toBeGreaterThan(Math.abs(head.dy));
  });

  it("is deterministic", () => {
    expect(breathingOffset(1.234, 0.4, 0.6)).toEqual(breathingOffset(1.234, 0.4, 0.6));
  });
});

describe("shimmer", () => {
  it("stays within the shimmer depth around 1", () => {
    for (let t = 0; t < 20; t += 0.23) {
      const value = shimmer(t, hash01(42) * Math.PI * 2);
      expect(value).toBeGreaterThanOrEqual(1 - SHIMMER_DEPTH);
      expect(value).toBeLessThanOrEqual(1 + SHIMMER_DEPTH);
    }
  });
});

describe("smoothstep", () => {
  it("clamps outside the edges and interpolates smoothly inside", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe("hash01", () => {
  it("is deterministic and within [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = hash01(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(i)).toBe(v);
    }
  });
});
