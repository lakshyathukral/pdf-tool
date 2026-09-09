# PDF Tool

A browser-based PDF editor. Everything runs locally in the browser — no server,
no uploads. PDFs are read from disk by JavaScript in the page, edited in memory,
and saved back out. There is no backend.

## Running it

```
npm install
npm run dev
```

Then open the URL it prints (normally http://localhost:5173/).

## Building

```
npm run build     # writes dist/
npm run preview   # serves dist/ the way a real host would
```

`dist/` is a plain static site — it can be dropped on any static host.

## What it does

A landing page offers single-purpose tools (merge, reorder, rotate, extract,
split, watermark, page numbering, labels, redact) plus a full editor that does
everything at once. Every tool is the same editor with parts hidden; the tool is
chosen by the URL hash, e.g. `#watermark`.

## How the code is arranged

| File | Job |
| --- | --- |
| `src/model.js` | The document: pages, sources, selection, undo. No DOM, no PDF libraries. |
| `src/render.js` | Everything touching pdf.js — thumbnails, large previews, flattening. |
| `src/export.js` | Everything touching pdf-lib — assembling the saved file. |
| `src/presets.js` | Saved settings, in browser storage. |
| `src/tools.js` | The tool catalogue and URL routing. |
| `src/ui/*` | Screen only. Reads the model, never touches pdf.js or pdf-lib. |
| `src/main.js` | Wiring: controls to the model, redraw on change. |

The rule that keeps it manageable: **the model is the truth, the screen is a
picture of it.** Page order lives in an array, not in the DOM.

## Two things that look odd but are deliberate

**The pdf.js worker import in `src/render.js`:**

```js
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
```

pdf.js parses PDFs on a second thread, loaded from a separate file at runtime,
so it must be told that file's address. The `?url` suffix tells Vite to emit it
as a standalone asset and hand back the correct path — which works in both
development and production. Hardcoding a path, or pointing at a CDN, breaks one
or the other.

**Cloning bytes before handing them to pdf.js:**

```js
await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise
```

pdf.js *transfers* the bytes it is given to its worker thread and leaves the
original empty. pdf-lib needs those same bytes later at export time, so pdf.js
gets a copy.

## Known limitations

- Bookmarks, outlines and form fields are lost on export.
- Password-protected PDFs cannot be opened (deliberate — no restriction bypass).
- Drag-to-reorder and redaction are mouse-only; touch devices are unsupported.
- No keyboard path for reordering.
- Everything is held in memory; very large files will exhaust the tab.
- Redaction works by rasterising the page, which destroys the underlying text
  but also makes that page unsearchable.
