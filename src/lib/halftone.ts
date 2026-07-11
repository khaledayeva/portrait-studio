/**
 * Pure helpers for the character-portrait art: fitting the portrait into the
 * viewport, building the full-screen cell grid, and the idle "breathing"
 * displacement field. Kept free of DOM/canvas state so they can be
 * unit-tested.
 */

export const TWO_PI = Math.PI * 2;

/** Rec. 709 relative luminance in 0..1, scaled by alpha. */
export function luminance(r: number, g: number, b: number, a: number): number {
  return ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * (a / 255);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic pseudo-random 0..1 from an integer index. */
export function hash01(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface PortraitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Contain-fit the portrait image into the viewport (proportions preserved),
 * scaled by `scale` (< 1 leaves margin), centered both ways.
 */
export function fitPortraitRect(
  imageW: number,
  imageH: number,
  viewW: number,
  viewH: number,
  scale: number,
): PortraitRect {
  const fit = Math.min(viewW / imageW, viewH / imageH) * scale;
  const width = imageW * fit;
  const height = imageH * fit;
  return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height };
}

/** One glyph cell of the full-screen grid. */
export interface Cell {
  /** Center position in render-space CSS pixels. */
  x: number;
  y: number;
  /** Base opacity of the glyph. */
  alpha: number;
  /**
   * Shaped brightness 0..1 (post boost/gamma). Drives which glyph the cell
   * draws (thin marks when dim, dense marks when bright). 0 for field cells.
   */
  tone: number;
  /** True when the cell is part of the portrait figure (bright enough). */
  figure: boolean;
  /** True for scattered spec cells in the halo ring around the figure. */
  halo: boolean;
  /** True for figure cells inside the censor bar over the eyes. */
  censor: boolean;
  /** Position normalized to 0..1 across the portrait rect (figure cells). */
  nx: number;
  ny: number;
  /** Deterministic per-cell phase for the shimmer, in radians. */
  phase: number;
  /** Deterministic per-cell 0..1 seed (initial glyph, mutation stagger). */
  seed: number;
  /** Optional semantic material written by an imported portrait blueprint. */
  portraitMaterialId?: number;
  /** Original packed semantic cell used by the shared animated runtime. */
  portraitCellValue?: number;
}

export interface ToneLiftRegion {
  nx0: number;
  nx1: number;
  ny0: number;
  ny1: number;
  amount: number;
  feather?: number;
}

export interface CellGridOptions {
  /** Full grid dimensions, in cells. */
  cols: number;
  rows: number;
  /** Distance between cell centers in CSS pixels. */
  spacing: number;
  /** Portrait placement within the grid, in cell units. */
  portraitCol0: number;
  portraitRow0: number;
  portraitCols: number;
  portraitRows: number;
  /** Luminance (0..1) at or above which a portrait cell is a figure cell. */
  minLuminance: number;
  /** Pre-gamma luminance multiplier (clamped to 1). */
  boost: number;
  /** Exponent shaping boosted luminance -> alpha. */
  gamma: number;
  /**
   * Optional post-shaping contrast (bias/gain S-curve exponent, pivot 0.5).
   * > 1 pushes dark features darker and lit areas brighter without clipping;
   * 1 or omitted = no-op.
   */
  contrast?: number;
  /**
   * Optional region(s) (normalized portrait coords) whose EXISTING figure
   * cells get lifted toward the light end: tone += (1 - tone) * amount. Dark
   * cells rise the most, already-bright cells barely move; empty cells are
   * never created — the region's own texture just reads lighter. `feather`
   * (normalized units) fades the lift to zero at the region's edges so no
   * rectangle boundary is ever visible. Overlapping regions don't stack; the
   * strongest applies.
   */
  toneLift?: ToneLiftRegion | ToneLiftRegion[];
  /** Figure glyph opacity range. */
  figureAlphaMin: number;
  figureAlphaMax: number;
  /** Constant faint opacity for the background field glyphs. */
  fieldAlpha: number;
  /**
   * Region (normalized portrait coords) treated as the identity-censor bar.
   * Figure cells inside it get `censor: true` and at least `alphaFloor`
   * opacity so the bar reads as a near-solid redaction element. Figure cells
   * within `margin` outside the band are demoted to field cells, carving a
   * dark seam that separates the bar from the face.
   */
  censorBand?: {
    nx0: number;
    nx1: number;
    ny0: number;
    ny1: number;
    alphaFloor: number;
    margin: number;
  };
}

/**
 * Build the full-screen cell grid. `portraitData` is an RGBA buffer of the
 * portrait downsampled to exactly portraitCols x portraitRows (one pixel per
 * cell). Cells outside the portrait rect — or inside it but darker than the
 * threshold — become faint "field" cells; the rest are figure cells whose
 * alpha encodes the image.
 */
export function buildCellGrid(
  portraitData: Uint8ClampedArray,
  opts: CellGridOptions,
): Cell[] {
  const cells: Cell[] = [];
  const {
    cols,
    rows,
    spacing,
    portraitCol0,
    portraitRow0,
    portraitCols,
    portraitRows,
  } = opts;
  const lifts: ToneLiftRegion[] =
    opts.toneLift === undefined
      ? []
      : Array.isArray(opts.toneLift)
        ? opts.toneLift
        : [opts.toneLift];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const pCol = col - portraitCol0;
      const pRow = row - portraitRow0;
      const inPortrait =
        pCol >= 0 && pCol < portraitCols && pRow >= 0 && pRow < portraitRows;

      let lum = 0;
      if (inPortrait) {
        const i = (pRow * portraitCols + pCol) * 4;
        lum = luminance(
          portraitData[i],
          portraitData[i + 1],
          portraitData[i + 2],
          portraitData[i + 3],
        );
      }

      let figure = inPortrait && lum >= opts.minLuminance;
      const index = row * cols + col;
      const nx = inPortrait ? (pCol + 0.5) / portraitCols : 0;
      const ny = inPortrait ? (pRow + 0.5) / portraitRows : 0;

      // Strongest applicable lift wins (regions never stack).
      let liftAmount = 0;
      if (inPortrait) {
        for (const lift of lifts) {
          if (
            nx < lift.nx0 ||
            nx > lift.nx1 ||
            ny < lift.ny0 ||
            ny > lift.ny1
          ) {
            continue;
          }
          let amount = lift.amount;
          const feather = lift.feather ?? 0;
          if (feather > 0) {
            const edgeDist = Math.min(
              nx - lift.nx0,
              lift.nx1 - nx,
              ny - lift.ny0,
              lift.ny1 - ny,
            );
            amount *= smoothstep(0, feather, edgeDist);
          }
          if (amount > liftAmount) liftAmount = amount;
        }
      }

      let censor = false;
      const band = opts.censorBand;
      if (figure && band) {
        const inBand =
          nx >= band.nx0 && nx <= band.nx1 && ny >= band.ny0 && ny <= band.ny1;
        const m = band.margin;
        const inMargin =
          !inBand &&
          nx >= band.nx0 - m &&
          nx <= band.nx1 + m &&
          ny >= band.ny0 - m &&
          ny <= band.ny1 + m;
        if (inBand) {
          censor = true;
        } else if (inMargin) {
          // Dark seam: bright cells hugging the bar drop to field level so
          // the bar reads as a separate layer sitting on the face.
          figure = false;
        }
      }

      let alpha = opts.fieldAlpha;
      let tone = 0;
      if (figure) {
        tone = Math.pow(Math.min(1, lum * opts.boost), opts.gamma);
        const c = opts.contrast ?? 1;
        if (c !== 1) {
          // Bias/gain S-curve: darks down, lights up, pivot anchored at 0.5.
          const gained = Math.pow(tone, c);
          tone = gained / (gained + Math.pow(1 - tone, c));
        }
        if (liftAmount > 0) {
          tone = Math.min(1, tone + (1 - tone) * liftAmount);
        }
        alpha =
          opts.figureAlphaMin +
          tone * (opts.figureAlphaMax - opts.figureAlphaMin);
        if (censor && band) {
          alpha = Math.max(alpha, band.alphaFloor);
        }
      }

      cells.push({
        x: (col + 0.5) * spacing,
        y: (row + 0.5) * spacing,
        alpha,
        tone,
        figure,
        halo: false,
        censor,
        nx,
        ny,
        phase: hash01(index) * TWO_PI,
        seed: hash01(index * 7 + 13),
      });
    }
  }
  return cells;
}

export interface FillHolesOptions {
  /** Grid dimensions the cells were built with. */
  cols: number;
  rows: number;
  /** Non-figure cells with at least this many figure neighbours are filled. */
  minFigureNeighbors: number;
  /**
   * Filled tone = mean neighbour tone x this. Slightly below 1 keeps fills a
   * touch darker than their surroundings so the repair looks organic and dark
   * regions stay dark.
   */
  toneScale: number;
  /** Same alpha mapping used by buildCellGrid. */
  figureAlphaMin: number;
  figureAlphaMax: number;
  /**
   * Optional region (normalized portrait coords) restricting which holes are
   * eligible — lets a specific area (e.g. the forehead) run extra, more
   * permissive passes without affecting silhouette edges elsewhere.
   */
  region?: { nx0: number; nx1: number; ny0: number; ny1: number };
}

/**
 * Close pepper-noise holes inside the figure: non-figure cells surrounded by
 * mostly figure neighbours become figure cells with an interpolated tone.
 * Fixes both forehead speckle and torso sparseness without touching the
 * background field. Single pass against a snapshot of the original flags —
 * fills never cascade.
 */
export function fillHoles(cells: Cell[], opts: FillHolesOptions): Cell[] {
  const { cols, rows, region } = opts;
  return cells.map((cell, i) => {
    if (cell.figure) return cell;
    if (
      region &&
      !(
        cell.nx >= region.nx0 &&
        cell.nx <= region.nx1 &&
        cell.ny >= region.ny0 &&
        cell.ny <= region.ny1
      )
    ) {
      return cell;
    }
    const col = i % cols;
    const row = (i / cols) | 0;
    let neighbors = 0;
    let toneSum = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const neighbor = cells[nr * cols + nc];
        if (neighbor.figure) {
          neighbors++;
          toneSum += neighbor.tone;
        }
      }
    }
    if (neighbors < opts.minFigureNeighbors) return cell;
    const tone = Math.min(1, (toneSum / neighbors) * opts.toneScale);
    const alpha =
      opts.figureAlphaMin + tone * (opts.figureAlphaMax - opts.figureAlphaMin);
    return { ...cell, figure: true, halo: false, tone, alpha };
  });
}

/**
 * Per-row silhouette hull: everything between a row's leftmost and rightmost
 * figure cell counts as inside the figure.
 */
export function computeRowHull(
  cells: Cell[],
  cols: number,
  rows: number,
): Uint8Array {
  const inHull = new Uint8Array(cells.length);
  for (let row = 0; row < rows; row++) {
    let min = -1;
    let max = -1;
    for (let col = 0; col < cols; col++) {
      if (cells[row * cols + col].figure) {
        if (min < 0) min = col;
        max = col;
      }
    }
    for (let col = min; min >= 0 && col <= max; col++) {
      inHull[row * cols + col] = 1;
    }
  }
  return inHull;
}

export interface LowerBodyFillOptions {
  /** Grid dimensions the cells were built with. */
  cols: number;
  rows: number;
  /** Portrait-normalized ny at which the fill begins. */
  startNy: number;
  /** How far (in cells) to look for figure support in each direction. */
  reach: number;
  /** Directions (of 4) that must have figure support for an interior fill. */
  minSupport: number;
  /** Columns whose figure bottom is at least this deep may drip. */
  dripAnchorNy: number;
  /**
   * Each eligible column's drip extends this far (min + seeded spread) below
   * the column's figure bottom, in ny units.
   */
  dripMinNy: number;
  dripMaxNy: number;
  /** Hard cap: nothing fills below this ny. */
  endNy: number;
  /** Seeded tone range for filled cells (dark clothing texture). */
  toneMin: number;
  toneMax: number;
  /** Same alpha mapping used by buildCellGrid. */
  figureAlphaMin: number;
  figureAlphaMax: number;
}

const TORSO_COLUMN_FILL_RATE = 0.28;

/**
 * Geometric fill for the lower body: the source clothing fades to true black
 * there, so luminance-based passes can't reach the gaps.
 *
 * Two mechanisms:
 * - Interior fill: a non-figure cell fills only when figure cells exist within
 *   `reach` in at least `minSupport` of the 4 directions. True interior gaps
 *   and edge notches close, while open pockets have too little support and
 *   stay empty. A seeded vertical bridge also fills a small share of cells
 *   caught between figure cells in the same column, keeping torso texture
 *   while making it modestly less sparse.
 * - Drips: columns whose figure bottom is deeper than `dripAnchorNy` extend
 *   a CONTINUOUS run of cells below that bottom, with a per-column seeded
 *   length and tone thinning toward the tip — vertical streaks off the torso
 *   bottom only, never stubs off shoulders or arms.
 */
export function fillLowerBody(
  cells: Cell[],
  opts: LowerBodyFillOptions,
): Cell[] {
  const { cols, rows } = opts;
  const n = cells.length;
  const INF = 32767;

  // Distance (in cells) to the nearest figure cell in each direction,
  // via four O(n) sweeps.
  const dLeft = new Int16Array(n).fill(INF);
  const dRight = new Int16Array(n).fill(INF);
  const dUp = new Int16Array(n).fill(INF);
  const dDown = new Int16Array(n).fill(INF);
  for (let row = 0; row < rows; row++) {
    let last = -1;
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (cells[i].figure) last = col;
      else if (last >= 0) dLeft[i] = col - last;
    }
    last = -1;
    for (let col = cols - 1; col >= 0; col--) {
      const i = row * cols + col;
      if (cells[i].figure) last = col;
      else if (last >= 0) dRight[i] = last - col;
    }
  }
  for (let col = 0; col < cols; col++) {
    let last = -1;
    for (let row = 0; row < rows; row++) {
      const i = row * cols + col;
      if (cells[i].figure) last = row;
      else if (last >= 0) dUp[i] = row - last;
    }
    last = -1;
    for (let row = rows - 1; row >= 0; row--) {
      const i = row * cols + col;
      if (cells[i].figure) last = row;
      else if (last >= 0) dDown[i] = last - row;
    }
  }

  const fillCell = (cell: Cell, i: number, tipFade = 1): Cell => {
    const tone =
      (opts.toneMin + hash01(i * 19 + 3) * (opts.toneMax - opts.toneMin)) *
      tipFade;
    const alpha =
      opts.figureAlphaMin + tone * (opts.figureAlphaMax - opts.figureAlphaMin);
    return { ...cell, figure: true, halo: false, tone, alpha };
  };

  // Original lower-body columns decide drip eligibility, so isolated helper
  // fills cannot create new drip sources outside the actual body.
  const sourceColBottomNy = new Float64Array(cols).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!cells[i].figure) continue;
    const col = i % cols;
    if (cells[i].ny > sourceColBottomNy[col]) {
      sourceColBottomNy[col] = cells[i].ny;
    }
  }

  const torsoFilled = cells.map((cell, i) => {
    if (cell.figure || cell.ny < opts.startNy || cell.ny > opts.endNy) {
      return cell;
    }
    const support =
      (dLeft[i] <= opts.reach ? 1 : 0) +
      (dRight[i] <= opts.reach ? 1 : 0) +
      (dUp[i] <= opts.reach ? 1 : 0) +
      (dDown[i] <= opts.reach ? 1 : 0);

    const verticalBridge =
      dUp[i] <= opts.reach &&
      dDown[i] <= opts.reach &&
      support >= Math.max(2, opts.minSupport - 1) &&
      hash01(i * 23 + 7) < TORSO_COLUMN_FILL_RATE;

    if (support < opts.minSupport && !verticalBridge) {
      return cell;
    }

    return fillCell(cell, i);
  });

  // Drips start after the torso support pass, letting repaired clothing carry
  // into the existing vertical streak treatment.
  const filledColBottomNy = new Float64Array(cols).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!torsoFilled[i].figure) continue;
    const col = i % cols;
    if (torsoFilled[i].ny > filledColBottomNy[col]) {
      filledColBottomNy[col] = torsoFilled[i].ny;
    }
  }

  return torsoFilled.map((cell, i) => {
    if (cell.figure || cell.ny < opts.startNy || cell.ny > opts.endNy) {
      return cell;
    }
    const col = i % cols;
    if (sourceColBottomNy[col] < opts.dripAnchorNy) return cell;
    const bottom = filledColBottomNy[col];
    if (cell.ny <= bottom) return cell;
    const dripEnd = Math.min(
      opts.endNy,
      bottom +
        opts.dripMinNy +
        hash01(col * 29 + 11) * (opts.dripMaxNy - opts.dripMinNy),
    );
    if (cell.ny > dripEnd) return cell;
    const tipFade =
      1 - 0.45 * ((cell.ny - bottom) / Math.max(1e-6, dripEnd - bottom));
    return fillCell(cell, i, tipFade);
  });
}

export interface HaloOptions {
  /** Grid dimensions the cells were built with. */
  cols: number;
  rows: number;
  /** Cell spacing in CSS px (jitter is expressed relative to it). */
  spacing: number;
  /** How many cells outward from the figure the halo extends. */
  rings: number;
  /** Upgrade probability at ring 1; decays linearly to 0 at `rings`. */
  probability: number;
  /** Spec opacity range (should sit above the base field alpha). */
  alphaMin: number;
  alphaMax: number;
  /** Max position jitter as a fraction of spacing (scatters the specs). */
  jitter: number;
}

/**
 * Upgrade a deterministic scattering of field cells around the figure into
 * brighter, position-jittered "spec" cells (`halo: true`), densest right at
 * the silhouette's edge and thinning out over `rings` cells. Figure cells,
 * field cells inside the silhouette (dark interior like beard/shirt shadows),
 * and field cells beyond the halo pass through unchanged.
 */
export function applyHalo(cells: Cell[], opts: HaloOptions): Cell[] {
  const { cols, rows, rings } = opts;

  // Seeding the BFS from the hull (not raw figure cells) keeps the halo's
  // ring width symmetric on both sides even where the figure's shadow-side
  // edge is sparse, and interior gaps never receive specs.
  const inHull = computeRowHull(cells, cols, rows);

  // Multi-source BFS (8-neighbour) from every hull cell: ring[i] = distance
  // in cells from the silhouette, capped at rings + 1.
  const ring = new Int16Array(cells.length).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (inHull[i]) {
      ring[i] = 0;
      frontier.push(i);
    }
  }
  for (let depth = 1; depth <= rings && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const i of frontier) {
      const col = i % cols;
      const row = (i / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (ring[ni] !== -1) continue;
          ring[ni] = depth;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }

  return cells.map((cell, i) => {
    if (cell.figure || inHull[i] || ring[i] <= 0) return cell;
    const p = opts.probability * (1 - (ring[i] - 1) / rings);
    if (hash01(i * 3 + 1) >= p) return cell;
    const alpha =
      opts.alphaMin + hash01(i * 5 + 2) * (opts.alphaMax - opts.alphaMin);
    const jx = (hash01(i * 11 + 3) - 0.5) * 2 * opts.jitter * opts.spacing;
    const jy = (hash01(i * 17 + 5) - 0.5) * 2 * opts.jitter * opts.spacing;
    return { ...cell, halo: true, alpha, x: cell.x + jx, y: cell.y + jy };
  });
}

/** One full breath cycle, in seconds. */
export const BREATH_PERIOD_S = 4.6;
/** Slow whole-body sway period, in seconds. */
export const SWAY_PERIOD_S = 7.9;

/**
 * Reference render height the offset amplitudes are tuned for; callers scale
 * the returned offsets by (actual render height / this).
 */
export const REFERENCE_HEIGHT = 720;

export interface Offset {
  dx: number;
  dy: number;
}

/**
 * Idle "standing and breathing" displacement for a cell at normalized
 * position (nx, ny) — ny = 0 at the top of the head — at time t (seconds).
 * Offsets are in CSS pixels at REFERENCE_HEIGHT. Shoulders and chest rise on
 * the inhale, the head bobs slightly a beat behind, and the whole figure
 * sways gently.
 */
export function breathingOffset(t: number, nx: number, ny: number): Offset {
  const breath = Math.sin((TWO_PI / BREATH_PERIOD_S) * t);
  const breathLate = Math.sin((TWO_PI / BREATH_PERIOD_S) * t - 0.7);
  const sway = Math.sin((TWO_PI / SWAY_PERIOD_S) * t);

  const torso = smoothstep(0.36, 0.72, ny);
  const head = 1 - smoothstep(0.12, 0.42, ny);

  const dy = -(breath * 2.3 * torso + breathLate * 0.8 * head);
  const dx =
    breath * 1.1 * (nx - 0.5) * torso + // chest expands out from the center line
    sway * 0.9 * (1 - 0.5 * ny); // sway pivots around the base

  return { dx, dy };
}

/** Upper bounds (reference px) on breathingOffset, used by tests and sizing. */
export const MAX_BREATHING_DX = 0.55 * 1.1 + 0.9;
export const MAX_BREATHING_DY = 2.3 + 0.8;

/**
 * Per-cell opacity multiplier producing a faint shimmer. Always within
 * [1 - SHIMMER_DEPTH, 1 + SHIMMER_DEPTH].
 */
export const SHIMMER_DEPTH = 0.1;

export function shimmer(t: number, phase: number): number {
  return 1 + SHIMMER_DEPTH * Math.sin(t * 1.7 + phase);
}
