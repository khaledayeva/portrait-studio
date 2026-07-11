# Portrait Studio

Portrait Studio is a standalone editor for building semantic, animated glyph portraits. It preserves the full editor that was originally developed inside the portfolio website while giving it an independent codebase, local storage, test suite, and Git history.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3200](http://localhost:3200).

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Core features

- Brush, eraser, line, rectangle, ellipse, fill, eyedropper, selection, lasso, and hand tools
- Semantic materials and editable glyph families
- Layer controls, undo, redo, duplication, and selection transforms
- Blueprint and animated preview modes
- Exact live renderer preview
- Lossless `.portrait` import and export
- PNG preview export
- IndexedDB autosave with a localStorage fallback
- Trackpad pan and pinch gestures
- Responsive tool and layer panels

The initial reference portrait lives at `public/portrait.png`. Technical details about the document format and renderer are in `docs/portrait-editor/README.md`.

## Moving an existing browser draft

Browser drafts are scoped to their origin. A draft created at `localhost:3100` does not automatically appear at `localhost:3200`. Export the draft as a `.portrait` file from the old editor, then import that file here. New work autosaves under the standalone Studio origin.
