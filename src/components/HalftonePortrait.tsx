"use client";

import { useEffect, useRef } from "react";
import {
  breathingOffset,
  buildCellGrid,
  fillHoles,
  fillLowerBody,
  hash01,
  REFERENCE_HEIGHT,
  shimmer,
  type Cell,
} from "@/lib/halftone";
import {
  parsePortraitBlueprint,
} from "@/lib/portrait-blueprint-codec";
import type {
  PortraitBlueprint,
  PortraitMaterial,
} from "@/lib/portrait-blueprint";
import {
  applyPortraitBlueprintToCells,
  portraitRuntimeAppearance,
  portraitRuntimeGlyph,
  portraitRuntimeGlyphs,
  portraitRuntimeLayout,
} from "@/lib/portrait-runtime";

interface HalftonePortraitProps {
  src: string;
  alt: string;
  className?: string;
  /** Optional in-memory semantic portrait document. */
  blueprint?: PortraitBlueprint;
  /** Optional exported .portrait JSON document loaded by the live renderer. */
  blueprintSrc?: string;
}

declare global {
  interface Window {
    /** Dev-only snapshot of the final cell grid, for visual debugging. */
    __halftone?: { cells: Cell[]; cols: number; rows: number; spacing: number };
  }
}

/**
 * Glyphs ordered light -> dense (ASCII-art tone ramp). A cell's brightness
 * picks its character, so the image reads through glyph density as well as
 * opacity — this is what keeps the portrait recognizable.
 */
const GLYPH_RAMP = ".,':;~-_+=<>iltxz*rcvsjfune?oaw$08%#&@";
/** Field cells draw only from this many glyphs at the light end of the ramp. */
const FIELD_RAMP_SPAN = 6;
/** Censor-bar cells draw only from this many glyphs at the dense end. */
const CENSOR_RAMP_SPAN = 2;
/**
 * Censor glyphs stamp oversized so neighbours overlap and fuse into a
 * near-solid strip — the bar contrasts with the face through texture, not a
 * gap.
 */
const CENSOR_GLYPH_SCALE = 1.45;
/** Figure glyph flicker stays within this many ramp steps of the cell's tone. */
const RAMP_JITTER = 2;
/**
 * Minimum ramp index for figure cells: even the dimmest body cells draw
 * visible marks, keeping the silhouette readable while dark features (shirt,
 * beard) stay texturally lighter than the highlights.
 */
const FIGURE_RAMP_FLOOR = 3;

/** Distance between cell centers in CSS px (glyphs need room to be legible). */
const BASE_SPACING = 10;
// The source portrait's fine halftone texture averages down to very low
// luminance when sampled (sweater cells land around 0.002-0.01, background is
// true black), so the threshold sits just above zero and the curve lifts
// shadows hard.
const MIN_LUMINANCE = 0.0004;
const ALPHA_GAMMA = 0.55;
const LUMINANCE_BOOST = 3.5;
/**
 * Post-lift contrast S-curve: the shadow lift keeps the figure visible but
 * compresses tones toward the midrange — this re-spreads them so hair,
 * beard, mustache and shirt read clearly darker than the lit face.
 */
const TONE_CONTRAST = 1.6;
/** Figure glyph opacity range; the faint full-screen field sits below it. */
const FIGURE_ALPHA_MIN = 0.32;
const FIGURE_ALPHA_MAX = 1;
const FIELD_ALPHA = 0.14;
/** Seconds between glyph mutations for a single cell (min + random spread). */
const MUTATE_MIN_S = 0.4;
const MUTATE_SPREAD_S = 2.6;
/** Censor cells flicker this much faster than everything else. */
const CENSOR_MUTATE_FACTOR = 0.35;

/**
 * Neck shortening: the source photo's neck reads slightly too long, so the
 * head slice (everything above `headBottomNy`, source-normalized) is redrawn
 * `amountNy` lower during sampling. The chin then overlaps the top of the
 * neck — about 20% of its visible length — while the body stays anchored,
 * and the strip revealed above the crown samples as plain background. Every
 * face-feature region below is written as source ny + `amountNy` so the
 * constants keep their measured provenance.
 */
const HEAD_DROP = { headBottomNy: 0.46, amountNy: 0.018 };
/**
 * Final head alignment pass. One grid column is deliberately used instead of
 * a normalized offset so the adjustment stays equally subtle at every
 * viewport density. The upper jaw and the neck receive the same one-column
 * alignment through separate, non-overlapping passes below.
 */
const HEAD_REPOSITION = {
  shiftColumns: 1,
  ny1: HEAD_DROP.headBottomNy + HEAD_DROP.amountNy,
};
/**
 * Continue the head's one-column alignment through the central neck, then
 * stop before the collar row so the approved shirt geometry stays anchored.
 * The left boundary follows the actual neck rather than the trapezius mass.
 */
const NECK_REPOSITION = {
  shiftColumns: 1,
  ny0: HEAD_REPOSITION.ny1,
  ny1: 0.558,
  leftAnchors: [
    [0.478, 0.37],
    [0.49, 0.37],
    [0.51, 0.36],
    [0.53, 0.345],
    [0.55, 0.33],
  ] as const,
  vacatedToneMin: 0.24,
  vacatedToneMax: 0.28,
};
/**
 * Identity-censor bar over the eyes, in normalized portrait coords (measured
 * from the source image's glitch band; tracks the dropped head).
 */
const CENSOR_BAND = {
  nx0: 0.24,
  nx1: 0.78,
  // Trim ten percent of the original height from each vertical edge while
  // keeping the band centered over the same eye line.
  ny0: 0.2575 + HEAD_DROP.amountNy,
  ny1: 0.3175 + HEAD_DROP.amountNy,
  alphaFloor: 1,
  margin: 0,
};
/**
 * The shorter censor exposes one final forehead row that previously sat
 * beneath the band. Lift only the source-backed cells in that narrow strip
 * so it joins the existing forehead without seeding outside the head.
 */
const FOREHEAD_REVEAL_LIFT = {
  nx0: 0.34,
  nx1: 0.68,
  ny0: 0.25 + HEAD_DROP.amountNy,
  ny1: CENSOR_BAND.ny0,
  amount: 0.75,
};
/**
 * Forehead treatment: the visible skin band under the hairline. A narrow,
 * feathered lift keeps this band readable without rebuilding the upper rim.
 */
const FOREHEAD_BAND_LIFT = {
  nx0: 0.32,
  nx1: 0.68,
  ny0: 0.205 + HEAD_DROP.amountNy,
  ny1: 0.245 + HEAD_DROP.amountNy,
  amount: 0.18,
  feather: 0.018,
};
/**
 * Shadow valley between the frontal dome and the viewer-right temple rim.
 * Lifted hard so the right forehead reads as one uniform skin mass instead
 * of a dark notch with a floating rim beyond it.
 */
const FOREHEAD_VALLEY_LIFT = {
  nx0: 0.565,
  nx1: 0.665,
  ny0: 0.195 + HEAD_DROP.amountNy,
  ny1: 0.25 + HEAD_DROP.amountNy,
  // Keep the source's soft rightward gradient while lifting the dark notch
  // enough to stay within one visible tone step of the lit center.
  amount: 0.3,
  feather: 0.02,
};
/**
 * The neck's lit core: a solid column here is what makes the neck read as
 * skin at every viewport density (at narrow windows the downsample averages
 * the thin lit strip against surrounding shadow and the column goes faint).
 * A firm lift on existing cells keeps it reading solid; the flanks around
 * it are shaded down separately by NECK_SHADE.
 */
const NECK_CORE_LIFT = {
  nx0: 0.382,
  nx1: 0.452,
  ny0: 0.47,
  ny1: 0.545,
  amount: 0.06,
  feather: 0.012,
};
/**
 * Viewer-left trapezius/collar sheen: the source photo carries a soft
 * gradient here (mean tone ~0.28) that sampled slightly dark.
 */
const LEFT_TRAP_LIFT = {
  nx0: 0.24,
  nx1: 0.4,
  ny0: 0.495,
  ny1: 0.585,
  amount: 0.12,
  feather: 0.02,
};
const FACE_TONE_LIFTS = [
  FOREHEAD_REVEAL_LIFT,
  FOREHEAD_BAND_LIFT,
  FOREHEAD_VALLEY_LIFT,
  NECK_CORE_LIFT,
  LEFT_TRAP_LIFT,
];
/**
 * The lower face is sourced directly from the reference after the generic
 * hole-filling passes. This keeps the original nose, mouth, beard, and jaw
 * geometry intact while leaving the accepted forehead and hair treatment in
 * place above the censor band.
 */
const SOURCE_FACE_RESTORE = {
  nx0: 0.29,
  nx1: 0.72,
  ny0: CENSOR_BAND.ny1,
  ny1: 0.465,
};
/**
 * The right forehead contains an interior source-halftone gap that tone
 * lifts cannot close. Keep this seed narrowly inside the sampled head
 * silhouette so it repairs the shadow valley without painting a box across
 * the temples or outside the skull.
 */
const FOREHEAD_SEAM_FILL = {
  nx0: 0.54,
  nx1: 0.64,
  ny0: 0.2 + HEAD_DROP.amountNy,
  ny1: 0.25 + HEAD_DROP.amountNy,
  edgeFeather: 0.01,
  density: 1,
  // Seeded cells skip the build-time lift, so their tone is set here to the
  // source-calibrated gradient level of the right forehead (~0.45-0.62).
  toneMin: 0.48,
  toneMax: 0.64,
};
/**
 * Region-scoped hole-fills for the forehead treatment: a conservative pass
 * over the skin band, and a more permissive one over the lifted valley so
 * the repaired patch closes into solid skin.
 */
const FOREHEAD_FILLS = [
  { region: FOREHEAD_BAND_LIFT, minFigureNeighbors: 5, passes: 1, toneScale: 0.65 },
  { region: FOREHEAD_VALLEY_LIFT, minFigureNeighbors: 4, passes: 2, toneScale: 0.7 },
];
/**
 * Source-measured hair/forehead boundary. Existing bright cells above this
 * curve are capped to scalp tone, never removed or created. The anchors keep
 * the broad center arc and the stronger viewer-right descent present in the
 * supplied portrait, while the horizontal feather prevents an overlay edge.
 */
const HAIR_CAP = {
  nx0: 0.44,
  nx1: 0.67,
  leftNxFeather: 0.04,
  rightNxFeather: 0.012,
  anchors: [
    // The viewer-left fade is already faithful to the source. This first
    // anchor only begins a soft handoff into the measured inner hair edge.
    [0.44, 0.2 + HEAD_DROP.amountNy],
    [0.48, 0.191 + HEAD_DROP.amountNy],
    [0.515, 0.188 + HEAD_DROP.amountNy],
    [0.54, 0.189 + HEAD_DROP.amountNy],
    [0.58, 0.198 + HEAD_DROP.amountNy],
    [0.6, 0.203 + HEAD_DROP.amountNy],
    [0.62, 0.211 + HEAD_DROP.amountNy],
    [0.64, 0.227 + HEAD_DROP.amountNy],
    [0.655, 0.247 + HEAD_DROP.amountNy],
  ] as const,
  /** Cap fades in over this distance above the line. */
  lineFeatherNy: 0.01,
  /** Nothing above the zone top is touched. */
  ny0: 0.1,
  toneCap: 0.22,
};
/**
 * Fine-grained repair for the dark forehead patch. This is an elliptical
 * tone lift on existing figure cells only, so it cannot seed a rectangular
 * overlay or spill beyond the sampled head silhouette.
 */
const FOREHEAD_SPOT_LIFT = {
  cx: 0.61,
  cy: 0.224 + HEAD_DROP.amountNy,
  rx: 0.055,
  ry: 0.04,
  targetTone: 0.98,
};
/**
 * Guard zone beside and below the viewer-right side of the neck: any bright
 * figure cluster here that is not physically connected (8-neighbour) to the
 * figure outside the zone is debris — it reads as specs floating off an
 * "open" neck — and demotes to the faint field. The neck's own right edge,
 * the trapezius chain, and the collar all connect to the body and pass
 * through untouched.
 */
const NECK_SPEC_CLEANUP = {
  nx0: 0.42,
  nx1: 0.75,
  ny0: 0.415,
  ny1: 0.61,
};
/**
 * Quiet triangle beside the viewer-right side of the neck: the uncapped
 * mirror otherwise clones the bright left collar into a dense wedge that
 * juts out at neck height. Above the collar's diagonal boundary (rising
 * from (nx0, boundaryNy0) toward the shoulder), mirror-created cells mostly
 * stay field and the few kept ones stay dim, so the region reads as the
 * approved reference: a thin natural neck chain over quiet darkness, with
 * the real collar mass entering only below the boundary. The figure's own
 * sampled cells pass through untouched.
 */
/**
 * Neck shading: between the chin and the collar, the neck must read as a
 * single human-width lit column (the source's lit band) with soft shadow on
 * both sides. The head drop lowers the jaw's wide corner and the source's
 * rim streak into former neck rows, which otherwise read as extra width and
 * a bright stump beside the neck. Outside the lit band, tone rolls off
 * smoothly toward `shadowToneCap` — a pure, feathered dimming that NEVER
 * removes cells, so the treatment degrades gracefully at every viewport
 * cell density (a hash-demotion version of this destroyed the neck at
 * narrower windows). The right side starts at the jawline; the left/inside
 * boundary sits lower so the chin/beard mass above is untouched.
 */
const NECK_SHADE = {
  ny0: 0.468,
  rightNy0: 0.452,
  /** Preserve the jaw-to-neck transition before the flank roll-off begins. */
  leftNy0: 0.452,
  ny1: 0.548,
  nyFeather: 0.015,
  /** Keep the neck slightly slimmer than the source without ghosting away
   * the shadow flank that makes it read as continuous human anatomy. */
  litNx0: 0.37,
  litNx1: 0.455,
  nxFeather: 0.02,
  leftNxFeather: 0.016,
  shadowToneCap: 0.3,
  leftToneCap: 0.14,
  /**
   * The source has a genuinely bright sternocleido rim right of the shadow
   * channel (source mean tone ~0.47) flowing into the collarbone — a higher
   * cap there keeps it reading as one continuous lit form instead of being
   * crushed into darkness.
   */
  rimNx0: 0.53,
  rimNx1: 0.615,
  rimToneCap: 0.6,
};
/**
 * The source rim can produce a few nearly saturated glyphs on the
 * viewer-right neck edge. At glyph scale those peaks read as a separate
 * white strand, so blend only that band into the surrounding neck shadow.
 */
const RIGHT_NECK_RIM_BLEND = {
  nx0: 0.605,
  nx1: 0.665,
  ny0: 0.475,
  ny1: 0.535,
  toneCap: 0.34,
};
const RIGHT_TRAP_QUIET = {
  nx0: 0.59,
  nx1: 0.86,
  nxFeather: 0.015,
  nyFeather: 0.012,
  // Mirror-created cells above the shirt edge are kept but capped to
  // skin-sheen tone, so the opening reads as dim skin, not cloned fabric.
  keepChance: 1,
  toneCap: 0.25,
};
/**
 * Neck-opening dressing, based on the annotated source study and the source
 * photo: the shadow channel in the middle of the neck carries dim skin
 * texture (not an empty hole); skin shows in the shirt's opening between
 * the neck and the right trap; and the sweater's bright collar border runs
 * as a continuous line from the right shoulder up to the trap. Runs after
 * the detached-spec cleanup because it deliberately lays contiguous
 * texture.
 */
const NECK_CHANNEL_FILL = {
  nx0Top: 0.465,
  nx0Bottom: 0.47,
  nx1Top: 0.545,
  nx1Bottom: 0.54,
  ny0: 0.455,
  ny1: 0.548,
  nxFeather: 0.01,
  nyFeather: 0.012,
  toneMin: 0.12,
  toneMax: 0.24,
};
/**
 * Existing cells in the deep central neck channel were structurally present
 * but rendered as sparse punctuation. This post-reposition floor strengthens
 * those same cells without widening either neck contour or seeding new cells.
 */
const NECK_CHANNEL_STRENGTH = {
  ny0: HEAD_REPOSITION.ny1,
  ny1: NECK_CHANNEL_FILL.ny1,
  nxFeather: 0.012,
  nyFeather: 0.012,
  edgeToneFloor: 0.24,
  coreToneFloor: 0.34,
};
/**
 * The anatomical viewer-right neck edge, traced from the supplied source.
 * Above the shirt edge, cells beyond this curve are background. This gives
 * every cell a single role: neck, shirt, or field, with no low-tone overflow
 * plane between them.
 */
const RIGHT_NECK_CONTOUR = {
  anchors: [
    [0.46, 0.6],
    [0.47, 0.597],
    [0.478, 0.603],
    [0.48, 0.604],
    [0.49, 0.615],
    [0.5, 0.607],
    [0.51, 0.6],
    [0.52, 0.589],
    [0.53, 0.577],
    [0.54, 0.566],
    [0.55, 0.55],
    [0.558, 0.55],
  ] as const,
  contourToneFloor: 0.28,
  classificationNx0: 0.55,
  classificationNx1: 0.86,
  classificationNy1: 0.61,
};
/** Conservative interior repair that keeps the previously approved neck
 * cavity closed. The explicit bright edge below owns all new white mass. */
const NECK_INTERIOR_FILL = {
  ny0: 0.45,
  ny1: 0.55,
  centerGapNx0: 0.46,
  centerGapNx1: 0.49,
  centerGapNy0: 0.505,
  centerGapNy1: 0.538,
  centerGapMinFigureNeighbors: 6,
  toneFloor: 0.24,
};

/**
 * Dense viewer-right neck edge derived from the shared source-traced contour.
 * The narrow inset converts the annotated dark gap into the same full-size
 * dense glyphs as the bright neck immediately above without creating a second
 * independent strand or restoring the former broad collar strip.
 */
const RIGHT_NECK_EDGE = {
  ny0: 0.46,
  ny1: 0.556,
  outerInsetNx: 0,
  coreInsetMaxNx: 0.02,
  innerInsetMaxNx: 0.034,
  coreTone: 1,
  edgeTone: 0.68,
};
const SHIRT_OUTLINE = {
  /**
   * The clean viewer-left shirt edge is the silhouette reference. The
   * viewer-right anchors mirror it exactly so the bright edge stays on the
   * shirt mass instead of floating above the shoulder.
   */
  nx0: 0.15,
  leftCollarNx: 0.35,
  centerNx: 0.5,
  rightCollarNx: 0.65,
  nx1: 0.85,
  leftShoulderNy: 0.61,
  leftCollarNy: 0.52,
  centerNy: 0.575,
  rightCollarNy: 0.52,
  rightShoulderNy: 0.61,
  borderHalfWidth: 0.014,
  borderFeather: 0.006,
  borderDensity: 1,
  // The glyph ramp is visually nonlinear, so the approved outer shoulder
  // borders stay near white. The central collar is owned by SHIRT_TRANSITION.
  borderToneMin: 0.92,
  borderToneMax: 1,
  outerLeftNx1: 0.33,
  outerRightNx0: 0.7,
};

/**
 * One source-traced shirt-top curve shared by mirroring, classification,
 * dark-shirt reconstruction, and the outer shoulder edge. The sharp rise
 * from the neck base to nx 0.63 is the real viewer-right shoulder root that
 * the previous low collar curve accidentally deleted.
 */
const SHIRT_TRANSITION = {
  anchors: [
    [0.3, 0.565],
    [0.34, 0.542],
    [0.4, 0.552],
    [0.48, 0.566],
    [0.54, 0.562],
    [0.57, 0.545],
    [0.6, 0.5],
    [0.615, 0.488],
    [0.63, 0.491],
    [0.65, 0.497],
    [0.68, 0.508],
    [0.7, 0.516],
    [0.75, 0.533],
    [0.8, 0.549],
    [0.85, 0.565],
    [0.86, 0.57],
  ] as const,
  nx0: 0.3,
  nx1: 0.86,
  ny1: 0.68,
  forcedFillNx0: 0.54,
  toneMin: 0.08,
  toneMax: 0.14,
  topToneFloor: 0.1,
  topToneCeiling: 0.18,
  topToneDepthNy: 0.045,
  boundaryNx0: 0.34,
  boundaryNx1: 0.57,
  boundaryHalfWidthNy: 0.0055,
  boundaryTone: 1,
};

const MIDDLE_RIGHT_TORSO_DRIPS = [
  { nx: 0.48, ny0: 0.64, ny1: 0.96, width: 0.014, density: 0.88, lean: -0.016 },
  { nx: 0.55, ny0: 0.63, ny1: 0.98, width: 0.017, density: 0.94, lean: -0.01 },
  { nx: 0.62, ny0: 0.66, ny1: 0.95, width: 0.016, density: 0.9, lean: 0.004 },
  { nx: 0.69, ny0: 0.7, ny1: 0.9, width: 0.013, density: 0.78, lean: 0.008 },
];
/**
 * Viewer-right side symmetry: within the ny band, cells right of the
 * portrait's center line consult their row-mirrored left-half counterpart.
 * Figure cells with no mirrored support demote to the faint field, keeping
 * the gaps beside the face/neck and above the shoulder free of floating
 * specs. Inside the shared source-traced shirt mask, mirrored figure tone can
 * fill missing fabric cells. Above that curve the pass never adds or removes
 * mass, so asymmetric face and neck structure remains source-owned.
 */
const RIGHT_SIDE_MIRROR = {
  ny0: 0.34 + HEAD_DROP.amountNy,
  ny1: 0.92,
};
const RIGHT_CENSOR_END_ROUNDING = {
  nx0: CENSOR_BAND.nx1 - 0.085,
  cx: CENSOR_BAND.nx1 - 0.07,
  cy: (CENSOR_BAND.ny0 + CENSOR_BAND.ny1) / 2,
  rx: 0.03,
  ry: (CENSOR_BAND.ny1 - CENSOR_BAND.ny0) / 2 + 0.012,
};
/** Stable viewer-left endpoint, one glyph beyond the ear after head shift. */
const LEFT_CENSOR_END_NX = 0.29;

/** Horizontal glitch tear: rows re-roll a new offset at this rate (Hz). */
const CENSOR_TEAR_HZ = 1.4;
/** Max tear offset as a fraction of spacing. */
const CENSOR_TEAR_SPAN = 0.8;

/**
 * Hole-fill: interior cells surrounded by this many figure neighbours get
 * promoted, closing forehead speckle and torso gaps. Filled tone is scaled
 * down so repairs stay a touch darker than their surroundings. Running the
 * pass twice closes clusters up to ~2 cells deep from their edges inward —
 * organic repairs, never painted rectangles.
 */
const FILL_MIN_NEIGHBORS = 5;
const FILL_TONE_SCALE = 0.65;
const FILL_PASSES = 2;

/**
 * Geometric lower-body fill: from the chest down, interior gaps (figure
 * support in >= 3 of 4 directions) become dim clothing texture, and columns
 * whose figure bottom is deep enough drip a continuous seeded-length run off
 * the torso bottom — vertical streaks, never horizontal holes, and no fills
 * in the open pockets beside the neck/shoulders.
 */
const LOWER_BODY_FILL = {
  startNy: 0.5,
  reach: 3,
  minSupport: 3,
  dripAnchorNy: 0.72,
  dripMinNy: 0.03,
  dripMaxNy: 0.15,
  endNy: 0.98,
  toneMin: 0.05,
  toneMax: 0.12,
};

/**
 * Speakeasy-style paint trail: color deposits wherever the cursor passes,
 * diffuses, and fades over ~3s; the deposit hue cycles slowly through the
 * spectrum so a moving cursor lays down multi-hue gradients. Calibrated
 * against frame captures of the reference renderer.
 */
/** Trail buffer resolution as a fraction of the viewport. */
const TRAIL_SCALE = 0.25;
/** Splat radius in CSS px. */
const TRAIL_RADIUS = 96;
/** Per-splat opacity. */
const TRAIL_DEPOSIT_ALPHA = 0.22;
/** CSS px between interpolated splats along fast pointer segments. */
const TRAIL_SEGMENT_STEP = 40;
/** Per-frame retention at 60fps (0.985 ~= 3s to fade fully). */
const TRAIL_FADE_KEEP = 0.985;
/** Per-frame diffusion blur on the quarter-res buffer, in buffer px. */
const TRAIL_BLUR_PX = 1.2;
/** Deposit hue cycles the full spectrum every ~14s. */
const TRAIL_HUE_DEG_PER_S = 25;
/** Brightness lift of figure glyphs under the trail. */
const TRAIL_LIGHT = 0.35;
/** The trail is considered gone this long after the last deposit. */
const TRAIL_LINGER_S = 4;

interface EffectState {
  cells: Cell[];
  glyphIndex: Uint16Array;
  nextMutation: Float64Array;
  cssWidth: number;
  cssHeight: number;
  spacing: number;
  portraitHeight: number;
  /** Latest pointer position in CSS px, and the previous deposit point. */
  pointerX: number;
  pointerY: number;
  prevPointerX: number;
  prevPointerY: number;
  pointerInside: boolean;
  /** Seconds timestamp of the last trail deposit; -Infinity = no trail. */
  lastDepositAt: number;
  /** Trail buffer dimensions and pixel snapshot for the brightness lift. */
  trailW: number;
  trailH: number;
  trailData: ImageData | null;
  lastTime: number;
  running: boolean;
  visible: boolean;
  rafId: number;
}

function buildGlyphAtlas(
  atlas: HTMLCanvasElement,
  spacing: number,
  dpr: number,
  glyphs: readonly string[],
): number {
  const cellPx = Math.ceil(spacing * dpr);
  atlas.width = cellPx * glyphs.length;
  atlas.height = cellPx;
  const ctx = atlas.getContext("2d");
  if (!ctx) return cellPx;
  ctx.fillStyle = "#e8e8e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Slightly oversized glyphs boost ink coverage, which reads better.
  ctx.font = `${Math.round(spacing * 1.1 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (let i = 0; i < glyphs.length; i++) {
    ctx.fillText(glyphs[i], i * cellPx + cellPx / 2, cellPx / 2 + cellPx * 0.04);
  }
  return cellPx;
}

/**
 * Glyph index for a cell: censor cells stay at the dense end, figure cells
 * sit within RAMP_JITTER steps of their tone's position on the ramp, and
 * field cells stay at the light end.
 * `rand` is a 0..1 draw (deterministic seed at init, Math.random on
 * mutation).
 */
function pickGlyph(cell: Cell, rand: number): number {
  if (cell.censor) {
    return GLYPH_RAMP.length - 1 - Math.floor(rand * CENSOR_RAMP_SPAN);
  }
  if (cell.figure) {
    const band = Math.max(
      FIGURE_RAMP_FLOOR,
      Math.round(cell.tone * (GLYPH_RAMP.length - 1)),
    );
    const jitter = Math.floor(rand * (RAMP_JITTER * 2 + 1)) - RAMP_JITTER;
    return Math.min(GLYPH_RAMP.length - 1, Math.max(0, band + jitter));
  }
  return Math.floor(rand * FIELD_RAMP_SPAN);
}

function promoteArtistCell(
  cell: Cell,
  i: number,
  toneMin: number,
  toneMax: number,
  fade = 1,
): Cell {
  const tone = Math.min(
    1,
    (toneMin + hash01(i * 37 + 19) * (toneMax - toneMin)) * fade,
  );
  const alpha = FIGURE_ALPHA_MIN + tone * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
  return {
    ...cell,
    figure: true,
    halo: false,
    censor: false,
    tone: Math.max(cell.tone, tone),
    alpha: Math.max(cell.alpha, alpha),
  };
}

function demoteToField(cell: Cell): Cell {
  return { ...cell, figure: false, halo: false, censor: false, tone: 0, alpha: FIELD_ALPHA };
}

function copyCellAppearance(target: Cell, source: Cell): Cell {
  return {
    ...target,
    alpha: source.alpha,
    tone: source.tone,
    figure: source.figure,
    halo: source.halo,
    censor: source.censor,
  };
}

function repositionHead(cells: Cell[], cols: number): Cell[] {
  const p = HEAD_REPOSITION;
  return cells.map((cell, i) => {
    if (cell.ny <= 0 || cell.ny > p.ny1) return cell;

    const col = i % cols;
    const sourceCol = col - p.shiftColumns;
    if (sourceCol < 0) return demoteToField(cell);
    return copyCellAppearance(cell, cells[i - p.shiftColumns]);
  });
}

function portraitColumnStepNx(cells: Cell[], cols: number): number {
  for (let rowStart = 0; rowStart < cells.length; rowStart += cols) {
    const rowEnd = Math.min(rowStart + cols, cells.length);
    let previousNx: number | null = null;
    for (let i = rowStart; i < rowEnd; i++) {
      const nx = cells[i].nx;
      if (nx <= 0) continue;
      if (previousNx !== null && nx > previousNx) return nx - previousNx;
      previousNx = nx;
    }
  }
  return 0;
}

function repositionNeck(cells: Cell[], cols: number): Cell[] {
  const p = NECK_REPOSITION;
  return cells.map((cell, i) => {
    if (cell.ny <= p.ny0 || cell.ny > p.ny1) return cell;

    const leftNx = leftNeckContourNx(cell.ny);
    const rightNx = rightNeckContourNx(cell.ny);
    const currentInside = cell.nx >= leftNx && cell.nx <= rightNx;
    const col = i % cols;
    const sourceCol = col - p.shiftColumns;
    if (sourceCol >= 0) {
      const source = cells[i - p.shiftColumns];
      const sourceInside =
        source.nx > 0 && source.nx >= leftNx && source.nx <= rightNx;
      if (sourceInside) return copyCellAppearance(cell, source);
    }

    // Keep the vacated left strand as a dim shadow instead of opening a
    // one-cell bite between the shifted neck and the stationary trapezius.
    if (!currentInside || !cell.figure) return cell;
    const tone = Math.min(
      p.vacatedToneMax,
      Math.max(p.vacatedToneMin, cell.tone),
    );
    const alpha = FIGURE_ALPHA_MIN + tone * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
    return { ...cell, tone, alpha };
  });
}

function strengthenNeckChannel(cells: Cell[], cols: number): Cell[] {
  const channel = NECK_CHANNEL_FILL;
  const strength = NECK_CHANNEL_STRENGTH;
  const shiftNx = portraitColumnStepNx(cells, cols) * NECK_REPOSITION.shiftColumns;

  return cells.map((cell) => {
    if (
      !cell.figure ||
      cell.censor ||
      cell.ny < strength.ny0 ||
      cell.ny > strength.ny1
    ) {
      return cell;
    }

    const t = (cell.ny - channel.ny0) / (channel.ny1 - channel.ny0);
    const nx0 =
      channel.nx0Top + (channel.nx0Bottom - channel.nx0Top) * t + shiftNx;
    const nx1 =
      channel.nx1Top + (channel.nx1Bottom - channel.nx1Top) * t + shiftNx;
    if (cell.nx < nx0 || cell.nx > nx1) return cell;

    const feather = Math.max(
      0,
      Math.min(
        1,
        (cell.nx - nx0) / strength.nxFeather,
        (nx1 - cell.nx) / strength.nxFeather,
        (cell.ny - strength.ny0) / strength.nyFeather,
        (strength.ny1 - cell.ny) / strength.nyFeather,
      ),
    );
    const toneFloor =
      strength.edgeToneFloor +
      (strength.coreToneFloor - strength.edgeToneFloor) * feather;
    if (cell.tone >= toneFloor) return cell;
    const alpha =
      FIGURE_ALPHA_MIN + toneFloor * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
    return { ...cell, tone: toneFloor, alpha: Math.max(cell.alpha, alpha) };
  });
}

function findMirroredSource(cells: Cell[], cols: number, index: number): Cell | null {
  const cell = cells[index];
  const rowStart = Math.floor(index / cols) * cols;
  const mirrorNx = 1 - cell.nx;
  let best: Cell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let col = 0; col < cols; col++) {
    const candidate = cells[rowStart + col];
    if (candidate.nx <= 0 || candidate.nx >= 0.5) continue;
    const distance = Math.abs(candidate.nx - mirrorNx);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function outsideRightCensorEnd(nx: number, ny: number): boolean {
  if (nx < RIGHT_CENSOR_END_ROUNDING.nx0) return false;
  const dx = (nx - RIGHT_CENSOR_END_ROUNDING.cx) / RIGHT_CENSOR_END_ROUNDING.rx;
  const dy = (ny - RIGHT_CENSOR_END_ROUNDING.cy) / RIGHT_CENSOR_END_ROUNDING.ry;
  return dx * dx + dy * dy > 1;
}

function rightTrapQuietFade(nx: number, ny: number): number {
  const q = RIGHT_TRAP_QUIET;
  if (nx < q.nx0 || nx > q.nx1) return 0;
  const boundary = shirtTransitionNy(nx);
  if (boundary === null) return 0;
  if (ny > boundary) return 0;
  return Math.min(
    1,
    (nx - q.nx0) / q.nxFeather,
    (q.nx1 - nx) / q.nxFeather,
    (boundary - ny) / q.nyFeather,
  );
}

function mirrorViewerRightSide(cells: Cell[], cols: number): Cell[] {
  return cells.map((cell, i) => {
    const { nx, ny } = cell;
    if (nx <= 0 || ny <= 0) return cell;

    if (cell.censor) {
      return nx < LEFT_CENSOR_END_NX || outsideRightCensorEnd(nx, ny)
        ? demoteToField(cell)
        : cell;
    }

    if (nx <= 0.5 || ny < RIGHT_SIDE_MIRROR.ny0 || ny > RIGHT_SIDE_MIRROR.ny1) {
      return cell;
    }

    const shirtTopNy = shirtTransitionNy(nx);
    const inKnownShirt = shirtTopNy !== null && ny >= shirtTopNy;
    if (!inKnownShirt) return cell;

    const mirrored = findMirroredSource(cells, cols, i);
    if (!mirrored?.figure) {
      // The source shoulder root is asymmetric. Missing mirrored support is
      // never evidence that a real viewer-right shirt cell should be erased.
      return cell;
    }

    const quiet = rightTrapQuietFade(nx, ny);
    if (quiet > 0) {
      // Own texture passes through unbrightened; mirror-created cells are
      // mostly skipped, and the kept ones stay dim.
      if (cell.figure) return cell;
      const keep = 1 - quiet * (1 - RIGHT_TRAP_QUIET.keepChance);
      if (hash01(i * 67 + 41) >= keep) return cell;
    }
    const quietToneCap =
      quiet > 0 ? 1 - quiet * (1 - RIGHT_TRAP_QUIET.toneCap) : 1;
    const tone = Math.min(
      quietToneCap,
      Math.max(cell.figure ? cell.tone : 0, mirrored.tone),
    );
    const alpha = Math.max(
      cell.alpha,
      FIGURE_ALPHA_MIN + tone * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN),
    );
    return { ...cell, figure: true, halo: false, censor: false, tone, alpha };
  });
}

function boxFeather(
  nx: number,
  ny: number,
  region: { nx0: number; nx1: number; ny0: number; ny1: number },
  feather: number,
): number {
  if (nx < region.nx0 || nx > region.nx1 || ny < region.ny0 || ny > region.ny1) {
    return 0;
  }
  return Math.min(
    1,
    (nx - region.nx0) / feather,
    (region.nx1 - nx) / feather,
    (ny - region.ny0) / feather,
    (region.ny1 - ny) / feather,
  );
}

function hairlineNy(nx: number): number {
  const anchors = HAIR_CAP.anchors;
  if (nx <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [nx1, ny1] = anchors[i];
    const [nx0, ny0] = anchors[i - 1];
    if (nx <= nx1) {
      const t = (nx - nx0) / (nx1 - nx0);
      const smoothT = t * t * (3 - 2 * t);
      return ny0 + (ny1 - ny0) * smoothT;
    }
  }
  return anchors[anchors.length - 1][1];
}

function capHairZone(cells: Cell[]): Cell[] {
  return cells.map((cell) => {
    if (!cell.figure || cell.censor) return cell;
    const { nx, ny } = cell;
    const lineNy = hairlineNy(nx);
    if (
      nx < HAIR_CAP.nx0 ||
      nx > HAIR_CAP.nx1 ||
      ny < HAIR_CAP.ny0 ||
      ny > lineNy
    ) {
      return cell;
    }
    const strength = Math.min(
      1,
      (nx - HAIR_CAP.nx0) / HAIR_CAP.leftNxFeather,
      (HAIR_CAP.nx1 - nx) / HAIR_CAP.rightNxFeather,
      (lineNy - ny) / HAIR_CAP.lineFeatherNy,
    );
    if (strength <= 0) return cell;
    const cap = HAIR_CAP.toneCap + (1 - strength) * (1 - HAIR_CAP.toneCap);
    if (cell.tone <= cap) return cell;
    const alpha = FIGURE_ALPHA_MIN + cap * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
    return { ...cell, tone: cap, alpha: Math.min(cell.alpha, alpha) };
  });
}

function liftForeheadSpot(cells: Cell[]): Cell[] {
  const spot = FOREHEAD_SPOT_LIFT;
  return cells.map((cell) => {
    if (!cell.figure || cell.censor || cell.ny <= hairlineNy(cell.nx) + 0.002) {
      return cell;
    }
    const dx = (cell.nx - spot.cx) / spot.rx;
    const dy = (cell.ny - spot.cy) / spot.ry;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius >= 1 || cell.tone >= spot.targetTone) return cell;

    const strength = Math.pow(1 - radius, 0.35);
    const tone = cell.tone + (spot.targetTone - cell.tone) * strength;
    const alpha = FIGURE_ALPHA_MIN + tone * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
    return { ...cell, tone, alpha: Math.max(cell.alpha, alpha) };
  });
}

function restoreSourceFace(cells: Cell[], sourceCells: Cell[]): Cell[] {
  const region = SOURCE_FACE_RESTORE;
  return cells.map((cell, index) => {
    if (
      cell.nx < region.nx0 ||
      cell.nx > region.nx1 ||
      cell.ny < region.ny0 ||
      cell.ny > region.ny1
    ) {
      return cell;
    }
    return sourceCells[index] ?? cell;
  });
}

function setFigureTone(cell: Cell, tone: number): Cell {
  return {
    ...cell,
    figure: true,
    halo: false,
    censor: false,
    tone,
    alpha: FIGURE_ALPHA_MIN + tone * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN),
  };
}

function figureNeighborStats(
  cells: Cell[],
  cols: number,
  rows: number,
  i: number,
): { count: number; toneTotal: number } {
  const col = i % cols;
  const row = (i / cols) | 0;
  if (col === 0 || col === cols - 1 || row === 0 || row === rows - 1) {
    return { count: 0, toneTotal: 0 };
  }
  let count = 0;
  let toneTotal = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const neighbor = cells[(row + dr) * cols + col + dc];
      if (!neighbor.figure) continue;
      count++;
      toneTotal += neighbor.tone;
    }
  }
  return { count, toneTotal };
}

type ToneCurve = readonly (readonly [number, number])[];

function curveNyAtNx(anchors: ToneCurve, nx: number): number | null {
  if (nx < anchors[0][0] || nx > anchors[anchors.length - 1][0]) return null;
  for (let i = 1; i < anchors.length; i++) {
    const [nx1, ny1] = anchors[i];
    const [nx0, ny0] = anchors[i - 1];
    if (nx <= nx1) {
      const t = (nx - nx0) / (nx1 - nx0);
      return ny0 + (ny1 - ny0) * t;
    }
  }
  return null;
}

function selectCurveIndices(
  cells: Cell[],
  cols: number,
  anchors: ToneCurve,
): Set<number> {
  const selected = new Set<number>();
  for (let col = 0; col < cols; col++) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = col; i < cells.length; i += cols) {
      const candidate = cells[i];
      if (candidate.censor || candidate.nx <= 0 || candidate.ny <= 0) continue;
      const curveNy = curveNyAtNx(anchors, candidate.nx);
      if (curveNy === null) continue;
      const distance = Math.abs(candidate.ny - curveNy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }
    if (nearestIndex >= 0) selected.add(nearestIndex);
  }
  return selected;
}

interface SeedFillRegion {
  nx0: number;
  nx1: number;
  ny0: number;
  ny1: number;
  edgeFeather: number;
  density: number;
  toneMin: number;
  toneMax: number;
}

/**
 * Seed non-figure cells inside a region with hash-scattered figure texture,
 * feathered at every edge. Used where the source is too dark to sample any
 * cells at all (right beard, forehead/temple seam).
 */
function seedFill(cells: Cell[], region: SeedFillRegion): Cell[] {
  return cells.map((cell, i) => {
    if (cell.figure || cell.censor) return cell;
    const fade = boxFeather(cell.nx, cell.ny, region, region.edgeFeather);
    if (fade === 0) return cell;
    if (hash01(i * 37 + 3) >= region.density * fade) return cell;
    return promoteArtistCell(
      cell,
      i,
      region.toneMin,
      region.toneMax,
      0.6 + 0.4 * fade,
    );
  });
}

function shadeNeck(cells: Cell[]): Cell[] {
  const n = NECK_SHADE;
  return cells.map((cell) => {
    if (!cell.figure || cell.censor) return cell;
    const { nx, ny } = cell;
    const ny0 =
      nx > n.litNx1 ? n.rightNy0 : nx < n.litNx0 ? n.leftNy0 : n.ny0;
    if (ny < ny0 || ny > n.ny1 || cell.tone <= n.leftToneCap) return cell;
    const nyFade = Math.min(
      1,
      (ny - ny0) / n.nyFeather,
      (n.ny1 - ny) / n.nyFeather,
    );
    const outside =
      nx < n.litNx0
        ? (n.litNx0 - nx) / n.leftNxFeather
        : nx > n.litNx1
          ? (nx - n.litNx1) / n.nxFeather
          : 0;
    const strength = Math.min(1, outside) * nyFade;
    if (strength <= 0) return cell;
    const baseCap =
      nx >= n.rimNx0 && nx <= n.rimNx1
        ? n.rimToneCap
        : nx < n.litNx0
          ? n.leftToneCap
          : n.shadowToneCap;
    const cap = baseCap + (1 - strength) * (1 - baseCap);
    if (cell.tone <= cap) return cell;
    const alpha = FIGURE_ALPHA_MIN + cap * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN);
    return { ...cell, tone: cap, alpha: Math.min(cell.alpha, alpha) };
  });
}

function shirtOutlineNy(nx: number): number | null {
  const o = SHIRT_OUTLINE;
  if (nx < o.nx0 || nx > o.nx1) return null;
  if (nx >= o.outerRightNx0) return shirtTransitionNy(nx);

  if (nx <= o.leftCollarNx) {
    const t = (nx - o.nx0) / (o.leftCollarNx - o.nx0);
    return o.leftShoulderNy + (o.leftCollarNy - o.leftShoulderNy) * t;
  }
  if (nx <= o.centerNx) {
    const t = (nx - o.leftCollarNx) / (o.centerNx - o.leftCollarNx);
    const eased = 1 - (1 - t) * (1 - t);
    return o.leftCollarNy + (o.centerNy - o.leftCollarNy) * eased;
  }
  if (nx <= o.rightCollarNx) {
    const t = (nx - o.centerNx) / (o.rightCollarNx - o.centerNx);
    return o.centerNy + (o.rightCollarNy - o.centerNy) * t * t;
  }

  const t = (nx - o.rightCollarNx) / (o.nx1 - o.rightCollarNx);
  return o.rightCollarNy + (o.rightShoulderNy - o.rightCollarNy) * t;
}

function shirtTransitionNy(nx: number): number | null {
  const anchors = SHIRT_TRANSITION.anchors;
  if (nx < anchors[0][0] || nx > anchors[anchors.length - 1][0]) return null;
  for (let i = 1; i < anchors.length; i++) {
    const [nx1, ny1] = anchors[i];
    const [nx0, ny0] = anchors[i - 1];
    if (nx <= nx1) {
      const t = (nx - nx0) / (nx1 - nx0);
      return ny0 + (ny1 - ny0) * t;
    }
  }
  return null;
}

function selectBottomNeckBoundaryIndices(
  cells: Cell[],
  cols: number,
): Set<number> {
  const transition = SHIRT_TRANSITION;
  const shiftNx = portraitColumnStepNx(cells, cols) * NECK_REPOSITION.shiftColumns;
  const selected = new Set<number>();

  // Choose exactly one sampled row per portrait column. A normalized-width
  // band can straddle two rows when the viewport changes, which makes this
  // anatomical edge look like a bright collar instead of the end of skin.
  for (let col = 0; col < cols; col++) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = col; i < cells.length; i += cols) {
      const candidate = cells[i];
      if (candidate.censor || candidate.nx <= 0 || candidate.ny <= 0) continue;
      if (
        candidate.nx < transition.boundaryNx0 ||
        candidate.nx > transition.boundaryNx1
      ) {
        continue;
      }

      const boundaryNy = shirtTransitionNy(candidate.nx);
      if (boundaryNy === null) continue;
      const leftNx = leftNeckContourNx(boundaryNy) + shiftNx;
      const rightNx = rightNeckContourNx(boundaryNy) + shiftNx;
      if (candidate.nx < leftNx || candidate.nx > rightNx) continue;

      const distance = Math.abs(candidate.ny - boundaryNy);
      if (distance > transition.boundaryHalfWidthNy) continue;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }
    if (nearestIndex >= 0) selected.add(nearestIndex);
  }

  return selected;
}

function rightNeckContourNx(ny: number): number {
  const anchors = RIGHT_NECK_CONTOUR.anchors;
  if (ny <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [ny1, nx1] = anchors[i];
    const [ny0, nx0] = anchors[i - 1];
    if (ny <= ny1) {
      const t = (ny - ny0) / (ny1 - ny0);
      return nx0 + (nx1 - nx0) * t;
    }
  }
  return anchors[anchors.length - 1][1];
}

function leftNeckContourNx(ny: number): number {
  const anchors = NECK_REPOSITION.leftAnchors;
  if (ny <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [ny1, nx1] = anchors[i];
    const [ny0, nx0] = anchors[i - 1];
    if (ny <= ny1) {
      const t = (ny - ny0) / (ny1 - ny0);
      return nx0 + (nx1 - nx0) * t;
    }
  }
  return anchors[anchors.length - 1][1];
}

function rebuildNeckShirtJoin(cells: Cell[], cols: number): Cell[] {
  const transition = SHIRT_TRANSITION;
  const shiftNx = portraitColumnStepNx(cells, cols) * NECK_REPOSITION.shiftColumns;
  const bottomBoundaryIndices = selectBottomNeckBoundaryIndices(cells, cols);
  const contourNy0 = RIGHT_NECK_CONTOUR.anchors[0][0];
  const contourNy1 =
    RIGHT_NECK_CONTOUR.anchors[RIGHT_NECK_CONTOUR.anchors.length - 1][0];

  const classified = cells.map((cell, i) => {
    if (
      cell.censor ||
      cell.nx <= 0 ||
      cell.ny < contourNy0 ||
      cell.ny > transition.ny1 ||
      cell.nx < transition.forcedFillNx0 ||
      cell.nx > transition.nx1
    ) {
      return cell;
    }

    const shirtTopNy = shirtTransitionNy(cell.nx);
    if (shirtTopNy === null) return cell;
    const insideNeck =
      cell.ny <= contourNy1 &&
      cell.nx >= leftNeckContourNx(cell.ny) + shiftNx &&
      cell.nx <= rightNeckContourNx(cell.ny) + shiftNx;
    if (insideNeck) return cell;

    if (cell.ny < shirtTopNy) {
      return cell.figure ? demoteToField(cell) : cell;
    }

    const depth = Math.max(0, cell.ny - shirtTopNy);
    const topStrength = Math.max(
      0,
      1 - depth / transition.topToneDepthNy,
    );
    const toneFloor =
      transition.toneMin +
      (transition.topToneFloor - transition.toneMin) * topStrength;
    const toneCeiling =
      transition.toneMax +
      (transition.topToneCeiling - transition.toneMax) * topStrength;
    if (cell.figure) {
      return setFigureTone(
        cell,
        Math.min(toneCeiling, Math.max(toneFloor, cell.tone)),
      );
    }
    const tone =
      toneFloor + hash01(i * 97 + 11) * (toneCeiling - toneFloor);
    return setFigureTone(cell, tone);
  });

  return classified.map((cell, i) => {
    if (cell.censor || cell.nx <= 0 || cell.ny <= 0) return cell;
    if (bottomBoundaryIndices.has(i)) {
      return setFigureTone(cell, transition.boundaryTone);
    }

    const shiftedRightContour = rightNeckContourNx(cell.ny) + shiftNx;
    const edgeInset = shiftedRightContour - cell.nx;
    const inRightEdge =
      cell.ny >= RIGHT_NECK_EDGE.ny0 &&
      cell.ny <= RIGHT_NECK_EDGE.ny1 &&
      edgeInset >= RIGHT_NECK_EDGE.outerInsetNx &&
      edgeInset <= RIGHT_NECK_EDGE.innerInsetMaxNx;
    if (inRightEdge) {
      const featherRange =
        RIGHT_NECK_EDGE.innerInsetMaxNx - RIGHT_NECK_EDGE.coreInsetMaxNx;
      const feather = Math.min(
        1,
        Math.max(
          0,
          (edgeInset - RIGHT_NECK_EDGE.coreInsetMaxNx) / featherRange,
        ),
      );
      const tone =
        RIGHT_NECK_EDGE.coreTone +
        (RIGHT_NECK_EDGE.edgeTone - RIGHT_NECK_EDGE.coreTone) * feather;
      return setFigureTone(cell, Math.max(cell.tone, tone));
    }

    const rim = RIGHT_NECK_RIM_BLEND;
    if (
      cell.figure &&
      cell.nx >= rim.nx0 &&
      cell.nx <= rim.nx1 &&
      cell.ny >= rim.ny0 &&
      cell.ny <= rim.ny1 &&
      cell.tone > rim.toneCap
    ) {
      return setFigureTone(cell, rim.toneCap);
    }
    return cell;
  });
}

function fillEnclosedNeckHoles(cells: Cell[], cols: number, rows: number): Cell[] {
  const fill = NECK_INTERIOR_FILL;
  const stepNx = portraitColumnStepNx(cells, cols);
  const shiftedRightNx = stepNx * NECK_REPOSITION.shiftColumns;

  return cells.map((cell, i) => {
    if (cell.figure || cell.censor || cell.nx <= 0 || cell.ny <= 0) return cell;
    if (
      cell.ny < fill.ny0 ||
      cell.ny > fill.ny1 ||
      cell.nx < leftNeckContourNx(cell.ny) + stepNx ||
      cell.nx > rightNeckContourNx(cell.ny) + shiftedRightNx - stepNx * 0.5
    ) {
      return cell;
    }

    const neighbors = figureNeighborStats(cells, cols, rows, i);

    const inCenterGap =
      cell.nx >= fill.centerGapNx0 &&
      cell.nx <= fill.centerGapNx1 &&
      cell.ny >= fill.centerGapNy0 &&
      cell.ny <= fill.centerGapNy1;
    if (
      neighbors.count !== 8 &&
      (!inCenterGap ||
        neighbors.count < fill.centerGapMinFigureNeighbors)
    ) {
      return cell;
    }

    const tone = Math.max(
      fill.toneFloor,
      neighbors.toneTotal / neighbors.count,
    );
    return setFigureTone(cell, tone);
  });
}

function fillNeckChannel(cells: Cell[]): Cell[] {
  const channel = NECK_CHANNEL_FILL;
  return cells.map((cell, i) => {
    if (
      cell.figure ||
      cell.censor ||
      cell.ny < channel.ny0 ||
      cell.ny > channel.ny1
    ) {
      return cell;
    }
    const t = (cell.ny - channel.ny0) / (channel.ny1 - channel.ny0);
    const nx0 = channel.nx0Top + (channel.nx0Bottom - channel.nx0Top) * t;
    const nx1 = channel.nx1Top + (channel.nx1Bottom - channel.nx1Top) * t;
    if (cell.nx < nx0 || cell.nx > nx1) return cell;

    const fade = Math.min(
      1,
      (cell.nx - nx0) / channel.nxFeather,
      (nx1 - cell.nx) / channel.nxFeather,
      (cell.ny - channel.ny0) / channel.nyFeather,
      (channel.ny1 - cell.ny) / channel.nyFeather,
    );
    if (fade <= 0) return cell;
    return promoteArtistCell(
      cell,
      i,
      channel.toneMin,
      channel.toneMax,
      0.55 + 0.45 * fade,
    );
  });
}

function dressShirtOutline(cells: Cell[], cols: number): Cell[] {
  const o = SHIRT_OUTLINE;
  const rightOutlineIndices = selectCurveIndices(
    cells,
    cols,
    SHIRT_TRANSITION.anchors,
  );
  return cells.map((cell, i) => {
    const { nx, ny } = cell;
    if (cell.censor || nx < o.nx0 - 0.02 || nx > o.nx1 + 0.02) return cell;
    if (nx > o.outerLeftNx1 && nx < o.outerRightNx0) return cell;

    // The viewer-right outline is exactly one sampled row on the same shared
    // curve as the shirt mask. A fixed-width band created the former bright
    // shoulder block at dense viewports.
    if (nx >= o.outerRightNx0) {
      if (!rightOutlineIndices.has(i)) return cell;
      const tone =
        o.borderToneMin +
        hash01(i * 83 + 7) * (o.borderToneMax - o.borderToneMin);
      return setFigureTone(cell, tone);
    }

    // Preserve the approved viewer-left outer shoulder edge.
    const outlineNy = shirtOutlineNy(nx);
    const outlineFade =
      outlineNy === null
        ? 0
        : Math.min(
            1,
            Math.max(0, (o.borderHalfWidth - Math.abs(ny - outlineNy)) / o.borderFeather),
          );
    if (outlineFade > 0) {
      if (cell.figure) {
        const target =
          (o.borderToneMin +
            hash01(i * 83 + 7) * (o.borderToneMax - o.borderToneMin)) *
          outlineFade;
        if (target <= cell.tone) return cell;
        const alpha = Math.max(
          cell.alpha,
          FIGURE_ALPHA_MIN + target * (FIGURE_ALPHA_MAX - FIGURE_ALPHA_MIN),
        );
        return { ...cell, tone: target, alpha };
      }
      if (hash01(i * 89 + 3) < o.borderDensity * outlineFade) {
        return promoteArtistCell(
          cell,
          i,
          o.borderToneMin,
          o.borderToneMax,
          outlineFade,
        );
      }
      return cell;
    }

    return cell;
  });
}

function cleanDetachedRightNeckSpecs(
  cells: Cell[],
  cols: number,
  rows: number,
): Cell[] {
  const zone = NECK_SPEC_CLEANUP;
  const inZone = (c: Cell): boolean =>
    c.nx >= zone.nx0 && c.nx <= zone.nx1 && c.ny >= zone.ny0 && c.ny <= zone.ny1;

  // Multi-source BFS over figure cells, seeded from every figure cell
  // OUTSIDE the zone (the body "mainland"). Figure cells inside the zone
  // that the flood never reaches are detached islands.
  const reachable = new Uint8Array(cells.length);
  let frontier: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].figure && !inZone(cells[i])) {
      reachable[i] = 1;
      frontier.push(i);
    }
  }
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      const col = i % cols;
      const row = (i / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (reachable[ni] || !cells[ni].figure) continue;
          reachable[ni] = 1;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }

  return cells.map((cell, i) => {
    if (!cell.figure || cell.censor || reachable[i] || !inZone(cell)) {
      return cell;
    }
    return demoteToField(cell);
  });
}

function addMiddleRightTorsoDrips(cells: Cell[]): Cell[] {
  return cells.map((cell, i) => {
    const { nx, ny } = cell;
    if (nx <= 0 || ny <= 0) return cell;

    for (let drip = 0; drip < MIDDLE_RIGHT_TORSO_DRIPS.length; drip++) {
      const stem = MIDDLE_RIGHT_TORSO_DRIPS[drip];
      if (ny < stem.ny0 || ny > stem.ny1) continue;

      const t = (ny - stem.ny0) / (stem.ny1 - stem.ny0);
      const row = Math.floor(ny * 140);
      const wobble = (hash01(row * 17 + drip * 131) - 0.5) * 0.01;
      const center = stem.nx + stem.lean * t + wobble;
      const width = stem.width * (1 - 0.28 * t);
      if (Math.abs(nx - center) > width) continue;

      const brokenRun = hash01(row * 43 + drip * 89) < stem.density;
      const fleck = hash01(i * 53 + drip * 97) < 0.88;
      if (!brokenRun || !fleck) continue;

      const tipFade = 1 - 0.36 * t;
      return promoteArtistCell(cell, i, 0.085, 0.19, tipFade);
    }

    return cell;
  });
}

/**
 * Full-viewport character-art rendering of the portrait: the image is drawn
 * as a grid of flickering code glyphs (bright glyphs form the figure, a faint
 * glyph field fills the rest of the screen), with a breathing idle motion and
 * a diffuse color trail that the cursor paints across the figure.
 */
export default function HalftonePortrait({
  src,
  alt,
  className,
  blueprint,
  blueprintSrc,
}: HalftonePortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Ping-pong pair of low-res trail buffers (fade+blur copies A->B each frame).
    const trailCanvases = [document.createElement("canvas"), document.createElement("canvas")];
    let trailFront = 0; // index of the buffer holding the latest trail
    const supportsCanvasFilter =
      typeof CanvasRenderingContext2D !== "undefined" &&
      "filter" in CanvasRenderingContext2D.prototype;
    const glyphAtlas = document.createElement("canvas");
    let atlasCellPx = 0;
    let activeBlueprint = blueprint ?? null;
    let blueprintMaterials = new Map<number, PortraitMaterial>(
      activeBlueprint?.materials.map((material) => [material.id, material]) ?? [],
    );
    let atlasGlyphs = Array.from(GLYPH_RAMP);
    let atlasGlyphIndex = new Map(
      atlasGlyphs.map((glyph, index) => [glyph, index]),
    );

    const state: EffectState = {
      cells: [],
      glyphIndex: new Uint16Array(0),
      nextMutation: new Float64Array(0),
      cssWidth: 0,
      cssHeight: 0,
      spacing: BASE_SPACING,
      portraitHeight: 0,
      pointerX: 0,
      pointerY: 0,
      prevPointerX: 0,
      prevPointerY: 0,
      pointerInside: false,
      lastDepositAt: Number.NEGATIVE_INFINITY,
      trailW: 0,
      trailH: 0,
      trailData: null,
      lastTime: performance.now(),
      running: false,
      visible: true,
      rafId: 0,
    };

    const trailActive = (nowS: number): boolean =>
      nowS - state.lastDepositAt < TRAIL_LINGER_S;

    let disposed = false;
    const image = new Image();
    image.src = src;

    const resample = (): void => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0 || !image.complete) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);

      const layout = portraitRuntimeLayout(
        cssWidth,
        cssHeight,
        image.naturalWidth,
        image.naturalHeight,
      );
      const spacing = layout.spacing;
      const cols = layout.columns;
      const rows = layout.rows;
      const rect = layout.portraitRect;
      const portraitCol0 = layout.portraitColumn;
      const portraitRow0 = layout.portraitRow;
      const portraitCols = layout.portraitColumns;
      const portraitRows = layout.portraitRows;

      // Downsample so each pixel of the offscreen canvas is one grid cell —
      // the browser's scaler does the per-cell averaging for us.
      const off = document.createElement("canvas");
      off.width = portraitCols;
      off.height = portraitRows;
      const offCtx = off.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.drawImage(image, 0, 0, portraitCols, portraitRows);
      // Head drop: erase the head at its source position and redraw it lower;
      // the chin overlaps the top of the neck, shortening it (see HEAD_DROP).
      const headRows = HEAD_DROP.headBottomNy * portraitRows;
      offCtx.fillStyle = "#000";
      offCtx.fillRect(0, 0, portraitCols, Math.ceil(headRows));
      offCtx.drawImage(
        image,
        0,
        0,
        image.naturalWidth,
        image.naturalHeight * HEAD_DROP.headBottomNy,
        0,
        HEAD_DROP.amountNy * portraitRows,
        portraitCols,
        headRows,
      );
      const { data } = offCtx.getImageData(0, 0, portraitCols, portraitRows);

      let grid = buildCellGrid(data, {
        cols,
        rows,
        spacing,
        portraitCol0,
        portraitRow0,
        portraitCols,
        portraitRows,
        minLuminance: MIN_LUMINANCE,
        boost: LUMINANCE_BOOST,
        gamma: ALPHA_GAMMA,
        contrast: TONE_CONTRAST,
        toneLift: FACE_TONE_LIFTS,
        figureAlphaMin: FIGURE_ALPHA_MIN,
        figureAlphaMax: FIGURE_ALPHA_MAX,
        fieldAlpha: FIELD_ALPHA,
        censorBand: CENSOR_BAND,
      });
      if (activeBlueprint) {
        grid = applyPortraitBlueprintToCells(
          grid,
          activeBlueprint,
          layout,
          FIELD_ALPHA,
        );
      } else {
        const sourceFaceGrid = grid;
        for (let pass = 0; pass < FILL_PASSES; pass++) {
          grid = fillHoles(grid, {
            cols,
            rows,
            minFigureNeighbors: FILL_MIN_NEIGHBORS,
            toneScale: FILL_TONE_SCALE,
            figureAlphaMin: FIGURE_ALPHA_MIN,
            figureAlphaMax: FIGURE_ALPHA_MAX,
          });
        }
        // Seed the empty forehead/temple seam before the regional fills so
        // they can knit the seeded cells into the surrounding skin.
        grid = seedFill(grid, FOREHEAD_SEAM_FILL);
        // Extra region-scoped fill passes for the forehead treatment.
        for (const fill of FOREHEAD_FILLS) {
          for (let pass = 0; pass < fill.passes; pass++) {
            grid = fillHoles(grid, {
              cols,
              rows,
              minFigureNeighbors: fill.minFigureNeighbors,
              toneScale: fill.toneScale,
              figureAlphaMin: FIGURE_ALPHA_MIN,
              figureAlphaMax: FIGURE_ALPHA_MAX,
              region: fill.region,
            });
          }
        }
        // Keep the accepted hair and forehead treatment source-relative, then
        // preserve the photographed nose, mouth, beard, and jaw without any
        // synthetic feature reconstruction. The editor owns future art edits.
        grid = capHairZone(grid);
        grid = liftForeheadSpot(grid);
        grid = restoreSourceFace(grid, sourceFaceGrid);
        grid = repositionHead(grid, cols);
        grid = fillLowerBody(grid, {
          cols,
          rows,
          ...LOWER_BODY_FILL,
          figureAlphaMin: FIGURE_ALPHA_MIN,
          figureAlphaMax: FIGURE_ALPHA_MAX,
        });
        grid = mirrorViewerRightSide(grid, cols);
        grid = fillNeckChannel(grid);
        grid = shadeNeck(grid);
        grid = repositionNeck(grid, cols);
        grid = strengthenNeckChannel(grid, cols);
        for (let pass = 0; pass < 2; pass++) {
          grid = fillEnclosedNeckHoles(grid, cols, rows);
        }
        grid = rebuildNeckShirtJoin(grid, cols);
        grid = dressShirtOutline(grid, cols);
        grid = addMiddleRightTorsoDrips(grid);
        // Cleanup runs once, after the complete semantic join exists, so it
        // cannot erase a shoulder root that a later pass needs to regrow.
        grid = cleanDetachedRightNeckSpecs(grid, cols, rows);
      }
      if (process.env.NODE_ENV !== "production") {
        window.__halftone = { cells: grid, cols, rows, spacing };
      }
      state.cells = grid;
      state.cssWidth = cssWidth;
      state.cssHeight = cssHeight;
      state.spacing = spacing;
      state.portraitHeight = rect.height;

      // Low-res trail buffers (resizing clears any existing trail).
      state.trailW = Math.max(2, Math.round(cssWidth * TRAIL_SCALE));
      state.trailH = Math.max(2, Math.round(cssHeight * TRAIL_SCALE));
      for (const buffer of trailCanvases) {
        buffer.width = state.trailW;
        buffer.height = state.trailH;
      }
      state.trailData = null;

      atlasGlyphs = activeBlueprint
        ? portraitRuntimeGlyphs(activeBlueprint.materials, GLYPH_RAMP)
        : Array.from(GLYPH_RAMP);
      atlasGlyphIndex = new Map(
        atlasGlyphs.map((glyph, index) => [glyph, index]),
      );
      atlasCellPx = buildGlyphAtlas(glyphAtlas, spacing, dpr, atlasGlyphs);
      const count = state.cells.length;
      state.glyphIndex = new Uint16Array(count);
      state.nextMutation = new Float64Array(count);
      const now = performance.now() / 1000;
      for (let i = 0; i < count; i++) {
        const cell = state.cells[i];
        const material =
          cell.portraitMaterialId === undefined
            ? undefined
            : blueprintMaterials.get(cell.portraitMaterialId);
        const packedCell = cell.portraitCellValue;
        if (material && packedCell !== undefined) {
          const glyph = portraitRuntimeGlyph(
            packedCell,
            material,
            i,
            now * 1000,
            !reducedMotion,
          );
          state.glyphIndex[i] = atlasGlyphIndex.get(glyph) ?? 0;
        } else {
          state.glyphIndex[i] = pickGlyph(cell, cell.seed);
        }
        state.nextMutation[i] = now + cell.seed * (MUTATE_MIN_S + MUTATE_SPREAD_S);
      }
    };

    const mutateGlyphs = (t: number): void => {
      const { nextMutation, glyphIndex, cells } = state;
      for (let i = 0; i < nextMutation.length; i++) {
        const cell = cells[i];
        const material =
          cell.portraitMaterialId === undefined
            ? undefined
            : blueprintMaterials.get(cell.portraitMaterialId);
        const packedCell = cell.portraitCellValue;
        if (material && packedCell !== undefined) {
          const glyph = portraitRuntimeGlyph(
            packedCell,
            material,
            i,
            t * 1000,
            true,
          );
          glyphIndex[i] = atlasGlyphIndex.get(glyph) ?? 0;
          continue;
        }
        if (t >= nextMutation[i]) {
          glyphIndex[i] = pickGlyph(cell, Math.random());
          const factor = cell.censor ? CENSOR_MUTATE_FACTOR : 1;
          nextMutation[i] =
            t + (MUTATE_MIN_S + Math.random() * MUTATE_SPREAD_S) * factor;
        }
      }
    };

    const drawFrame = (timeMs: number): void => {
      const { cells, glyphIndex, cssWidth, cssHeight, spacing } = state;
      if (cssWidth === 0) return;
      const dpr = canvas.width / cssWidth;
      const t = timeMs / 1000;
      const motionScale = state.portraitHeight / REFERENCE_HEIGHT;
      const half = spacing / 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const nowS = timeMs / 1000;
      const lightOn = trailActive(nowS) && state.trailData !== null;
      const trailData = state.trailData;
      const trailScaleX = state.trailW / cssWidth;
      const trailScaleY = state.trailH / cssHeight;
      const tearStep = Math.floor(t * CENSOR_TEAR_HZ);

      // Figure glyphs first: per-cell alpha, breathing, shimmer, and — while
      // the trail is alive — a subtle brightness lift where paint sits.
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell.figure) continue;
        let x = cell.x;
        let y = cell.y;
        let alpha = cell.alpha;
        let drawScale = cell.censor ? CENSOR_GLYPH_SCALE : 1;
        const material =
          cell.portraitMaterialId === undefined
            ? undefined
            : blueprintMaterials.get(cell.portraitMaterialId);
        const packedCell = cell.portraitCellValue;
        if (material && packedCell !== undefined) {
          const appearance = portraitRuntimeAppearance(
            packedCell,
            material,
            i,
            timeMs,
            cell.nx,
            cell.ny,
            spacing,
            !reducedMotion,
          );
          x += appearance.offsetX;
          y += appearance.offsetY;
          alpha = appearance.alpha;
          drawScale = appearance.scale;
        } else if (!reducedMotion) {
          const { dx, dy } = breathingOffset(t, cell.nx, cell.ny);
          x += dx * motionScale;
          y += dy * motionScale;
          alpha = Math.min(1, alpha * shimmer(t, cell.phase));
          if (cell.censor) {
            // Time-quantized horizontal tear so the bar glitches sideways.
            const rowKey = Math.round(cell.y / spacing);
            x +=
              (hash01(tearStep * 31 + rowKey) - 0.5) *
              2 *
              CENSOR_TEAR_SPAN *
              spacing;
          }
        }
        if (lightOn && trailData) {
          const bx = Math.min(
            state.trailW - 1,
            Math.max(0, Math.round(x * trailScaleX)),
          );
          const by = Math.min(
            state.trailH - 1,
            Math.max(0, Math.round(y * trailScaleY)),
          );
          const paint = trailData.data[(by * state.trailW + bx) * 4 + 3] / 255;
          if (paint > 0.02) {
            alpha = Math.min(1, alpha + paint * TRAIL_LIGHT);
          }
        }
        ctx.globalAlpha = alpha;
        const drawSize = spacing * drawScale;
        const drawHalf = drawSize / 2;
        ctx.drawImage(
          glyphAtlas,
          glyphIndex[i] * atlasCellPx,
          0,
          atlasCellPx,
          atlasCellPx,
          x - drawHalf,
          y - drawHalf,
          drawSize,
          drawSize,
        );
      }
      ctx.globalAlpha = 1;

      // Tint before anything else draws: source-atop can only land on the
      // figure glyphs above, so the color never touches the field.
      // The low-res trail buffer upscales smoothly — diffuse, boundless color.
      if (lightOn) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.drawImage(trailCanvases[trailFront], 0, 0, cssWidth, cssHeight);
        ctx.globalCompositeOperation = "source-over";
      }

      // Base field glyphs, batched under a single alpha.
      ctx.globalAlpha = FIELD_ALPHA;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.figure) continue;
        ctx.drawImage(
          glyphAtlas,
          glyphIndex[i] * atlasCellPx,
          0,
          atlasCellPx,
          atlasCellPx,
          cell.x - half,
          cell.y - half,
          spacing,
          spacing,
        );
      }
      ctx.globalAlpha = 1;
    };

    /**
     * Advance the paint trail one frame: copy the previous buffer with a
     * fade (and a slight blur when supported) for diffusion + dissipation,
     * then deposit fresh color along the pointer's path.
     */
    const updateTrail = (dt: number, nowS: number): void => {
      const { trailW, trailH, cssWidth } = state;
      if (trailW === 0 || cssWidth === 0 || !trailActive(nowS)) return;
      const src = trailCanvases[trailFront];
      const dst = trailCanvases[1 - trailFront];
      const dstCtx = dst.getContext("2d", { willReadFrequently: true });
      if (!dstCtx) return;

      dstCtx.clearRect(0, 0, trailW, trailH);
      dstCtx.globalAlpha = Math.pow(TRAIL_FADE_KEEP, dt * 60);
      if (supportsCanvasFilter) dstCtx.filter = `blur(${TRAIL_BLUR_PX}px)`;
      dstCtx.drawImage(src, 0, 0);
      if (supportsCanvasFilter) dstCtx.filter = "none";
      dstCtx.globalAlpha = 1;

      if (state.pointerInside) {
        const scale = trailW / cssWidth;
        const fromX = state.prevPointerX;
        const fromY = state.prevPointerY;
        const dx = state.pointerX - fromX;
        const dy = state.pointerY - fromY;
        const distance = Math.hypot(dx, dy);
        const steps = Math.min(8, Math.max(1, Math.round(distance / TRAIL_SEGMENT_STEP)));
        const hue = (nowS * TRAIL_HUE_DEG_PER_S) % 360;
        const r = TRAIL_RADIUS * scale;
        for (let s = 1; s <= steps; s++) {
          const px = (fromX + (dx * s) / steps) * scale;
          const py = (fromY + (dy * s) / steps) * scale;
          const splat = dstCtx.createRadialGradient(px, py, 0, px, py, r);
          splat.addColorStop(0, `hsl(${hue} 95% 60% / ${TRAIL_DEPOSIT_ALPHA})`);
          splat.addColorStop(1, `hsl(${hue} 95% 60% / 0)`);
          dstCtx.fillStyle = splat;
          dstCtx.fillRect(px - r, py - r, r * 2, r * 2);
        }
        state.prevPointerX = state.pointerX;
        state.prevPointerY = state.pointerY;
        state.lastDepositAt = nowS;
      }

      trailFront = 1 - trailFront;
      // Snapshot for the per-cell brightness lift (small buffer — cheap).
      state.trailData = dstCtx.getImageData(0, 0, trailW, trailH);
    };

    const step = (now: number): void => {
      if (!state.running) return;
      const dt = Math.min((now - state.lastTime) / 1000, 0.1);
      state.lastTime = now;
      const nowS = now / 1000;

      updateTrail(dt, nowS);
      if (!reducedMotion) mutateGlyphs(nowS);
      drawFrame(now);
      state.rafId = requestAnimationFrame(step);
    };

    const syncLoop = (): void => {
      const shouldRun =
        !disposed &&
        state.visible &&
        document.visibilityState === "visible" &&
        // With reduced motion there is no idle animation; the loop only runs
        // while the pointer is painting or the trail is still dissipating.
        (!reducedMotion ||
          state.pointerInside ||
          trailActive(performance.now() / 1000));
      if (shouldRun && !state.running) {
        state.running = true;
        state.lastTime = performance.now();
        state.rafId = requestAnimationFrame(step);
      } else if (!shouldRun && state.running) {
        state.running = false;
        cancelAnimationFrame(state.rafId);
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!state.pointerInside) {
        // First contact: start the stroke here rather than smearing in from
        // a stale position.
        state.prevPointerX = x;
        state.prevPointerY = y;
      }
      state.pointerX = x;
      state.pointerY = y;
      state.pointerInside = true;
      state.lastDepositAt = performance.now() / 1000;
      syncLoop();
    };

    const onPointerLeave = (): void => {
      // Deposits stop; the existing trail dissipates on its own.
      state.pointerInside = false;
      syncLoop();
    };

    const onVisibilityChange = (): void => syncLoop();

    const resizeObserver = new ResizeObserver(() => {
      resample();
      if (!state.running) drawFrame(performance.now());
    });

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      state.visible = entry.isIntersecting;
      syncLoop();
    });

    const blueprintReady = blueprintSrc
      ? fetch(blueprintSrc, { cache: "no-store" })
          .then((response) => {
            if (!response.ok) {
              throw new Error(
                `Portrait blueprint request failed with ${response.status}`,
              );
            }
            return response.text();
          })
          .then((json) => {
            activeBlueprint = parsePortraitBlueprint(json);
            blueprintMaterials = new Map(
              activeBlueprint.materials.map((material) => [
                material.id,
                material,
              ]),
            );
          })
      : Promise.resolve();

    Promise.all([image.decode(), blueprintReady])
      .then(() => {
        if (disposed) return;
        resample();
        drawFrame(performance.now());
        resizeObserver.observe(canvas);
        intersectionObserver.observe(canvas);
        syncLoop();
      })
      .catch((error: unknown) => {
        // A malformed source or semantic document must never render a partial
        // portrait. Keep the canvas empty and surface the reason in devtools.
        console.error("Unable to initialize the portrait renderer", error);
      });

    // The canvas spans the viewport (partly under the nav), so the trail
    // tracks the pointer at the window level rather than on the canvas.
    window.addEventListener("pointermove", onPointerMove);
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      state.running = false;
      cancelAnimationFrame(state.rafId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [blueprint, blueprintSrc, src]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      className={className}
    />
  );
}
