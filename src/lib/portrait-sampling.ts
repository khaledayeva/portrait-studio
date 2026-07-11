import {
  CUTOUT_CELL,
  TRANSPARENT_CELL,
  compositePortraitBlueprint,
  packPortraitCell,
  portraitCellIntensity,
  portraitCellMaterialId,
  type PortraitBlueprint,
  type PortraitMaterial,
} from "./portrait-blueprint";

const MATERIAL_SLOT_COUNT = 255;
const SCORE_EPSILON = 1e-12;

function hash32(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Area-sample the fixed authoring grid into any runtime glyph grid. Source
 * cells contribute only their exact geometric overlap with an output
 * footprint. A material must cover its declared minimum fraction of that
 * footprint before its sampling priority can affect the result. This lets a
 * deliberate one-cell contour survive downsampling without allowing a tiny
 * corner overlap to grow into an extra runtime glyph.
 */
export function samplePortraitBlueprint(
  blueprint: PortraitBlueprint,
  targetWidth: number,
  targetHeight: number,
): Uint16Array {
  if (!Number.isInteger(targetWidth) || targetWidth < 1) {
    throw new RangeError("targetWidth must be a positive integer");
  }
  if (!Number.isInteger(targetHeight) || targetHeight < 1) {
    throw new RangeError("targetHeight must be a positive integer");
  }

  const source = compositePortraitBlueprint(blueprint);
  const result = new Uint16Array(targetWidth * targetHeight);
  const materialById: Array<PortraitMaterial | undefined> = new Array(
    MATERIAL_SLOT_COUNT,
  );
  for (const material of blueprint.materials) {
    materialById[material.id] = material;
  }

  // Reused for every target cell so the sampler does not allocate maps inside
  // its hot loop. Only ids touched by the current footprint are reset.
  const coverageByMaterial = new Float64Array(MATERIAL_SLOT_COUNT);
  const intensityByMaterial = new Float64Array(MATERIAL_SLOT_COUNT);
  const touchedMaterialIds: number[] = [];

  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const footprintY0 = (targetY * blueprint.height) / targetHeight;
    const footprintY1 = ((targetY + 1) * blueprint.height) / targetHeight;
    const sourceY0 = Math.max(0, Math.floor(footprintY0));
    const sourceY1 = Math.min(blueprint.height, Math.ceil(footprintY1));
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const footprintX0 = (targetX * blueprint.width) / targetWidth;
      const footprintX1 = ((targetX + 1) * blueprint.width) / targetWidth;
      const sourceX0 = Math.max(0, Math.floor(footprintX0));
      const sourceX1 = Math.min(blueprint.width, Math.ceil(footprintX1));
      const footprintArea =
        (footprintX1 - footprintX0) * (footprintY1 - footprintY0);

      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY++) {
        const overlapY = Math.max(
          0,
          Math.min(footprintY1, sourceY + 1) -
            Math.max(footprintY0, sourceY),
        );
        if (overlapY <= 0) continue;
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX++) {
          const overlapX = Math.max(
            0,
            Math.min(footprintX1, sourceX + 1) -
              Math.max(footprintX0, sourceX),
          );
          if (overlapX <= 0) continue;
          const cell = source[sourceY * blueprint.width + sourceX];
          if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) continue;
          const materialId = portraitCellMaterialId(cell);
          if (materialById[materialId] === undefined) continue;
          const overlapArea = overlapX * overlapY;
          if (coverageByMaterial[materialId] === 0) {
            touchedMaterialIds.push(materialId);
          }
          coverageByMaterial[materialId] += overlapArea;
          intensityByMaterial[materialId] +=
            portraitCellIntensity(cell) * overlapArea;
        }
      }

      let winningMaterialId = 0;
      let winningScore = 0;
      let winningCoverage = 0;
      for (const materialId of touchedMaterialIds) {
        const material = materialById[materialId];
        if (!material) continue;
        const coverage = coverageByMaterial[materialId] / footprintArea;
        if (coverage + SCORE_EPSILON < material.runtime.minCoverage) continue;
        const score = coverage * material.runtime.samplingPriority;
        const scoreWins = score > winningScore + SCORE_EPSILON;
        const equalScore = Math.abs(score - winningScore) <= SCORE_EPSILON;
        const coverageWins = coverage > winningCoverage + SCORE_EPSILON;
        const stableIdWins =
          Math.abs(coverage - winningCoverage) <= SCORE_EPSILON &&
          (winningMaterialId === 0 || materialId < winningMaterialId);
        if (scoreWins || (equalScore && (coverageWins || stableIdWins))) {
          winningScore = score;
          winningCoverage = coverage;
          winningMaterialId = materialId;
        }
      }
      if (winningMaterialId !== 0) {
        const winningArea = coverageByMaterial[winningMaterialId];
        const averageIntensity = Math.max(
          1,
          Math.min(
            255,
            Math.round(intensityByMaterial[winningMaterialId] / winningArea),
          ),
        );
        result[targetY * targetWidth + targetX] = packPortraitCell(
          winningMaterialId,
          averageIntensity,
        );
      }

      for (const materialId of touchedMaterialIds) {
        coverageByMaterial[materialId] = 0;
        intensityByMaterial[materialId] = 0;
      }
      touchedMaterialIds.length = 0;
    }
  }
  return result;
}

/** Choose an animated glyph without ever changing the authored cell shape. */
export function portraitGlyphForCell(
  cell: number,
  material: PortraitMaterial,
  cellIndex: number,
  frame = 0,
): string {
  if (cell === TRANSPARENT_CELL || cell === CUTOUT_CELL) return "";
  const glyphs = Array.from(material.glyphs);
  if (glyphs.length === 0) return "";
  const intensity = portraitCellIntensity(cell) / 255;
  const baseIndex = Math.min(
    glyphs.length - 1,
    Math.floor(intensity * glyphs.length),
  );
  const mutationSpan = Math.max(0, Math.round(material.flicker * glyphs.length));
  if (mutationSpan === 0 || frame === 0) return glyphs[baseIndex];
  const offset = (hash32(cellIndex * 65537 + frame * 131) % (mutationSpan * 2 + 1)) - mutationSpan;
  return glyphs[Math.max(0, Math.min(glyphs.length - 1, baseIndex + offset))];
}

export function materialMap(
  materials: readonly PortraitMaterial[],
): ReadonlyMap<number, PortraitMaterial> {
  return new Map(materials.map((material) => [material.id, material]));
}
