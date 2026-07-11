import {
  PORTRAIT_GRID_HEIGHT,
  PORTRAIT_GRID_WIDTH,
  createPortraitBlueprint,
  createPortraitLayer,
  packPortraitCell,
  type PortraitBlueprint,
  type PortraitLayer,
  type PortraitMaterial,
} from "./portrait-blueprint";

const SOURCE_LAYER_ORDER = [
  ["shirt", "Shirt"],
  ["neck", "Neck"],
  ["face", "Face"],
  ["hair", "Hair"],
  ["beard", "Beard"],
  ["censor", "Censor"],
  ["highlights", "Highlights"],
] as const;

function sourceTone(red: number, green: number, blue: number, alpha: number) {
  const luminance =
    ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) *
    (alpha / 255);
  return Math.round(Math.pow(Math.min(1, luminance * 3.5), 0.55) * 255);
}

function materialByKey(
  materials: readonly PortraitMaterial[],
  key: string,
): PortraitMaterial {
  const material = materials.find((candidate) => candidate.key === key);
  if (!material) throw new Error(`Missing portrait material: ${key}`);
  return material;
}

function layerById(layers: readonly PortraitLayer[], id: string): PortraitLayer {
  const layer = layers.find((candidate) => candidate.id === id);
  if (!layer) throw new Error(`Missing portrait layer: ${id}`);
  return layer;
}

function classifySourceCell(
  nx: number,
  ny: number,
  tone: number,
): { layerId: string; materialKey: string } {
  if (ny >= 0.252 && ny <= 0.345 && nx >= 0.205 && nx <= 0.81) {
    return { layerId: "censor", materialKey: "censor" };
  }
  if (ny < 0.255) {
    return { layerId: "hair", materialKey: "hair" };
  }
  if (ny >= 0.545) {
    return { layerId: "shirt", materialKey: "shirt" };
  }
  if (ny >= 0.438) {
    return {
      layerId: "neck",
      materialKey:
        tone >= 205
          ? "neck-highlight"
          : tone >= 114
            ? "skin-mid"
            : "skin-shadow",
    };
  }
  if (ny >= 0.367 && (tone < 172 || ny >= 0.405)) {
    return { layerId: "beard", materialKey: "beard" };
  }
  return {
    layerId: "face",
    materialKey:
      tone >= 202 ? "skin-light" : tone >= 122 ? "skin-mid" : "skin-shadow",
  };
}

/**
 * Convert the supplied source portrait into the semantic document that opens
 * in the editor. This is only the editable starting point. Every later edit
 * is stored directly as a lossless material id and intensity on the master
 * grid, so exports never depend on this classifier.
 */
export function createBlueprintFromSourcePixels(
  pixels: Uint8ClampedArray,
  name = "Portrait",
  sourceImage = "/portrait.png",
): PortraitBlueprint {
  const expectedLength = PORTRAIT_GRID_WIDTH * PORTRAIT_GRID_HEIGHT * 4;
  if (pixels.length !== expectedLength) {
    throw new RangeError(`Source pixels must contain exactly ${expectedLength} values`);
  }

  const blueprint = createPortraitBlueprint(name, sourceImage);
  blueprint.layers = SOURCE_LAYER_ORDER.map(([id, label]) =>
    createPortraitLayer(id, label),
  );

  for (let row = 0; row < PORTRAIT_GRID_HEIGHT; row++) {
    for (let column = 0; column < PORTRAIT_GRID_WIDTH; column++) {
      const cellIndex = row * PORTRAIT_GRID_WIDTH + column;
      const pixelIndex = cellIndex * 4;
      const tone = sourceTone(
        pixels[pixelIndex],
        pixels[pixelIndex + 1],
        pixels[pixelIndex + 2],
        pixels[pixelIndex + 3],
      );
      if (tone < 10) continue;

      const nx = (column + 0.5) / PORTRAIT_GRID_WIDTH;
      const ny = (row + 0.5) / PORTRAIT_GRID_HEIGHT;
      const classification = classifySourceCell(nx, ny, tone);
      const layer = layerById(blueprint.layers, classification.layerId);
      const material = materialByKey(
        blueprint.materials,
        classification.materialKey,
      );
      layer.cells[cellIndex] = packPortraitCell(
        material.id,
        Math.max(1, Math.min(255, tone)),
      );
    }
  }

  return blueprint;
}

/** Load and downsample a same-origin reference image into the master grid. */
export async function createBlueprintFromSourceImage(
  sourceImage = "/portrait.png",
): Promise<PortraitBlueprint> {
  if (typeof document === "undefined") {
    throw new Error("Source image conversion is only available in the browser");
  }
  const image = new Image();
  image.decoding = "async";
  image.src = sourceImage;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_GRID_WIDTH;
  canvas.height = PORTRAIT_GRID_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return createBlueprintFromSourcePixels(imageData.data, "Portrait", sourceImage);
}
