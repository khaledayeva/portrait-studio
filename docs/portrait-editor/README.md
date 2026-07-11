# Portrait Studio architecture

The editor lives at `/` and authors a portrait as a semantic glyph document instead of a bitmap screenshot.

## Exact document contract

- The master document is a fixed 192 by 288 grid with a 2:3 aspect ratio.
- Each authored cell stores a stable material id and an 8-bit intensity.
- Layers store row-major `Uint16Array` cell buffers in memory.
- `.portrait` exports embed the material palette and encode every layer with lossless pair run-length encoding.
- Canonical serialization is stable. Exporting, importing, and exporting again produces byte-identical JSON.
- Animation only changes the visible glyph inside the cell's allowed material family. It never changes cell occupancy, material ownership, or silhouette.
- The editor preview and live renderer use the same overlap-weighted area sampler and versioned animation profile in `src/lib/portrait-runtime.ts`.
- Material animation profiles are embedded in the export, including opacity, glyph scale, mutation timing, shimmer, breathing, tear, sampling priority, and minimum coverage.

## Material families

The initial palette includes Skin Light, Skin Mid, Skin Shadow, Hair, Beard, Shirt, Neck Highlight, Censor, and Outline. Each family has its own glyph set, default intensity, and flicker range. The editor also lets the user change the glyph family and flicker range before exporting.

## Editing workflow

1. Open `http://localhost:3200`.
2. Choose a layer and semantic material.
3. Draw with Brush, Eraser, Line, Rectangle, Ellipse, Fill, Eyedropper, Select, Lasso, or Hand.
4. Use Blueprint mode for exact cell placement and Animated mode for a fast canvas check.
5. Use Live preview to open the current document in the exact animated renderer.
6. Export the `.portrait` document.

The editor autosaves to IndexedDB with a localStorage fallback. Import accepts only documents no larger than 16 MB that pass the versioned schema, bounded material and layer limits, and exact RLE validation, so a malformed file cannot partially replace the active portrait.

## Renderer path

The renderer uses a deterministic data path:

1. Parse with `parsePortraitBlueprint`.
2. Pass the document or its public URL to `HalftonePortrait` with `blueprint` or `blueprintSrc`.
3. Downsample with overlap-weighted material coverage at the exact live grid for 717 by 1000, 1280 by 1200, 1600 by 900, or any other viewport.
4. Resolve glyph, alpha, scale, mutation, shimmer, breathing, and censor tear from the cell's embedded material runtime.

No screenshot tracing, coordinate guessing, or manual shape reconstruction is needed during that handoff.
