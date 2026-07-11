import {
  CUTOUT_CELL,
  TRANSPARENT_CELL,
  portraitCellIntensity,
  portraitCellMaterialId,
  type PortraitBlueprint,
  type PortraitMaterial,
} from "./portrait-blueprint";
import { fitPortraitRect, type Cell, type PortraitRect } from "./halftone";
import {
  materialMap,
  portraitGlyphForCell,
  samplePortraitBlueprint,
} from "./portrait-sampling";

export const PORTRAIT_RUNTIME_VERSION = 1 as const;
export const PORTRAIT_RUNTIME_SPACING = 10;
export const PORTRAIT_RUNTIME_MAX_CELLS = 20_000;
export const PORTRAIT_RUNTIME_SCALE = 1.35;
export const PORTRAIT_RUNTIME_SOURCE_WIDTH = 1280;
export const PORTRAIT_RUNTIME_SOURCE_HEIGHT = 1920;

export interface PortraitRuntimeLayout {
  version: typeof PORTRAIT_RUNTIME_VERSION;
  spacing: number;
  columns: number;
  rows: number;
  portraitColumn: number;
  portraitRow: number;
  portraitColumns: number;
  portraitRows: number;
  portraitRect: PortraitRect;
}

export interface PortraitRuntimeAppearance {
  glyph: string;
  alpha: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Stable 0..1 value used by every portrait runtime surface. */
export function portraitRuntimeHash(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

/**
 * Compute the exact full-screen and portrait grid used by the live canvas.
 * The editor calls this helper too, so its animated preview samples the same
 * number of portrait columns and rows at every viewport.
 */
export function portraitRuntimeLayout(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth = PORTRAIT_RUNTIME_SOURCE_WIDTH,
  sourceHeight = PORTRAIT_RUNTIME_SOURCE_HEIGHT,
): PortraitRuntimeLayout {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError("viewportWidth must be a positive finite number");
  }
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError("viewportHeight must be a positive finite number");
  }
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) {
    throw new RangeError("sourceWidth must be a positive finite number");
  }
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new RangeError("sourceHeight must be a positive finite number");
  }

  const spacing = Math.max(
    PORTRAIT_RUNTIME_SPACING,
    Math.sqrt(
      (viewportWidth * viewportHeight) / PORTRAIT_RUNTIME_MAX_CELLS,
    ),
  );
  const columns = Math.max(1, Math.round(viewportWidth / spacing));
  const rows = Math.max(1, Math.round(viewportHeight / spacing));
  const portraitRect = fitPortraitRect(
    sourceWidth,
    sourceHeight,
    viewportWidth,
    viewportHeight,
    PORTRAIT_RUNTIME_SCALE,
  );
  const portraitColumn = Math.floor(portraitRect.x / spacing);
  const portraitRow = Math.floor(portraitRect.y / spacing);
  const portraitColumns = Math.max(
    1,
    Math.ceil((portraitRect.x + portraitRect.width) / spacing) - portraitColumn,
  );
  const portraitRows = Math.max(
    1,
    Math.ceil((portraitRect.y + portraitRect.height) / spacing) - portraitRow,
  );

  return {
    version: PORTRAIT_RUNTIME_VERSION,
    spacing,
    columns,
    rows,
    portraitColumn,
    portraitRow,
    portraitColumns,
    portraitRows,
    portraitRect,
  };
}

export function portraitRuntimeGlyph(
  cell: number,
  material: PortraitMaterial,
  cellIndex: number,
  timeMs: number,
  animated = true,
): string {
  if (!animated) return portraitGlyphForCell(cell, material, cellIndex, 0);
  const runtime = material.runtime;
  const interval =
    runtime.mutationMinMs +
    portraitRuntimeHash(cellIndex * 8191 + material.id * 131) *
      (runtime.mutationMaxMs - runtime.mutationMinMs);
  const phase = portraitRuntimeHash(cellIndex * 65537 + material.id * 17);
  const frame = Math.max(0, Math.floor(timeMs / interval + phase));
  return portraitGlyphForCell(cell, material, cellIndex, frame);
}

export function portraitRuntimeAppearance(
  cell: number,
  material: PortraitMaterial,
  cellIndex: number,
  timeMs: number,
  normalizedX: number,
  normalizedY: number,
  cellSize: number,
  animated = true,
): PortraitRuntimeAppearance {
  const runtime = material.runtime;
  const intensity = portraitCellIntensity(cell) / 255;
  const baseAlpha =
    runtime.alphaMin + intensity * (runtime.alphaMax - runtime.alphaMin);
  if (!animated) {
    return {
      glyph: portraitRuntimeGlyph(cell, material, cellIndex, 0, false),
      alpha: baseAlpha,
      scale: runtime.glyphScale,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const seconds = timeMs / 1000;
  const phase = portraitRuntimeHash(cellIndex * 257 + material.id * 29) * Math.PI * 2;
  const shimmer =
    1 + Math.sin(seconds * 2.15 + phase) * runtime.shimmer;
  const breatheX =
    Math.sin(seconds * 0.78 + normalizedY * 5.4 + phase) *
    cellSize *
    0.18 *
    runtime.breathe;
  const breatheY =
    Math.sin(seconds * 0.64 + normalizedX * 4.7 + phase * 0.73) *
    cellSize *
    0.14 *
    runtime.breathe;
  const tearStep = Math.floor(seconds * 1.4);
  const rowKey = Math.round(normalizedY * 10_000);
  const tearX =
    (portraitRuntimeHash(tearStep * 31 + rowKey) - 0.5) *
    2 *
    runtime.tear *
    cellSize;

  return {
    glyph: portraitRuntimeGlyph(cell, material, cellIndex, timeMs, true),
    alpha: clamp(baseAlpha * shimmer, runtime.alphaMin * 0.8, 1),
    scale: runtime.glyphScale,
    offsetX: breatheX + tearX,
    offsetY: breatheY,
  };
}

/** Build the exact portrait-only sampled grid used by both renderers. */
export function createPortraitRuntimeGrid(
  blueprint: PortraitBlueprint,
  layout: Pick<PortraitRuntimeLayout, "portraitColumns" | "portraitRows">,
): Uint16Array {
  return samplePortraitBlueprint(
    blueprint,
    layout.portraitColumns,
    layout.portraitRows,
  );
}

/**
 * Replace the source-derived figure cells with an authored semantic document.
 * Background field cells stay intact, while every cell in and around the
 * portrait is classified exclusively by the exported blueprint.
 */
export function applyPortraitBlueprintToCells(
  cells: readonly Cell[],
  blueprint: PortraitBlueprint,
  layout: PortraitRuntimeLayout,
  fieldAlpha: number,
): Cell[] {
  if (cells.length !== layout.columns * layout.rows) {
    throw new RangeError("Cell grid does not match the portrait runtime layout");
  }
  const sampled = createPortraitRuntimeGrid(blueprint, layout);
  const materials = materialMap(blueprint.materials);

  return cells.map((cell, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const portraitX = column - layout.portraitColumn;
    const portraitY = row - layout.portraitRow;
    const insidePortrait =
      portraitX >= 0 &&
      portraitX < layout.portraitColumns &&
      portraitY >= 0 &&
      portraitY < layout.portraitRows;
    const authoredCell = insidePortrait
      ? sampled[portraitY * layout.portraitColumns + portraitX]
      : TRANSPARENT_CELL;
    if (authoredCell === TRANSPARENT_CELL || authoredCell === CUTOUT_CELL) {
      return {
        ...cell,
        alpha: fieldAlpha,
        tone: 0,
        figure: false,
        halo: false,
        censor: false,
        portraitMaterialId: undefined,
        portraitCellValue: undefined,
      };
    }

    const materialId = portraitCellMaterialId(authoredCell);
    const material = materials.get(materialId);
    if (!material) return cell;
    const intensity = portraitCellIntensity(authoredCell) / 255;
    return {
      ...cell,
      alpha:
        material.runtime.alphaMin +
        intensity * (material.runtime.alphaMax - material.runtime.alphaMin),
      tone: intensity,
      figure: true,
      halo: false,
      censor: material.key === "censor",
      portraitMaterialId: materialId,
      portraitCellValue: authoredCell,
    };
  });
}

/** Unique code points needed by the source field and semantic materials. */
export function portraitRuntimeGlyphs(
  materials: readonly PortraitMaterial[],
  fallbackGlyphs: string,
): string[] {
  const glyphs = new Set(Array.from(fallbackGlyphs));
  for (const material of materials) {
    for (const glyph of Array.from(material.glyphs)) glyphs.add(glyph);
  }
  return [...glyphs];
}
