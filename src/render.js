// ---------------------------------------------------------------------------
// render.js — everything that touches pdf.js. Turns source pages into images:
// small ones for thumbnails, large ones for the redaction editor, and flattened
// ones for export. Knows nothing about the model or the page layout.
// ---------------------------------------------------------------------------

// Must come first: pdf.js uses methods Safari does not have yet.
import './polyfills.js'

import * as pdfjsLib from 'pdfjs-dist'

// Our own wrapper round the pdf.js worker, so the polyfills reach that thread
// too. ?worker&url makes Vite bundle it and hand back the correct URL in both
// development and production.
import workerUrl from './pdf-worker.js?worker&url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const THUMBNAIL_WIDTH = 150

// Dots per inch used when flattening a redacted page to an image. PDF's own
// unit is 1/72 inch, so 150dpi means rendering at roughly twice page size.
const REDACT_DPI = 150

// Browsers refuse to produce an image beyond a total pixel count — Safari is
// the strictest. Staying under this keeps flattening working everywhere.
const MAX_CANVAS_PIXELS = 12_000_000

const documents = new Map()   // sourceId -> pdf.js document
const thumbnails = new Map()  // "sourceId:pageIndex" -> { url, width, height }

const key = (sourceId, pageIndex) => `${sourceId}:${pageIndex}`

// Open a PDF and report how many pages it has.
// NOTE: pdf.js takes OWNERSHIP of the bytes it is given — it transfers them to
// its worker thread and leaves ours empty. So it gets a clone, and the caller
// keeps the original for pdf-lib at export time.
export async function openSource(sourceId, bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise
  documents.set(sourceId, pdf)
  return pdf.numPages
}

// Already-rendered thumbnail, or undefined. Synchronous, for use while drawing.
export const getThumbnail = (sourceId, pageIndex) => thumbnails.get(key(sourceId, pageIndex))

// Draw a page onto a fresh canvas at the given rotation and scale.
// `rotation` is added to whatever rotation the page already carries.
async function drawPage(sourceId, pageIndex, { rotation = 0, scale = 1, width = null } = {}) {
  const page = await documents.get(sourceId).getPage(pageIndex + 1)

  // Asking for a rotated viewport makes pdf.js do the rotating for us, and
  // report the resulting (possibly landscape) size.
  const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation })
  const viewport = page.getViewport({
    scale: width ? width / base.width : scale,
    rotation: page.rotate + rotation,
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise

  return canvas
}

// Render one page to a small image, once. Returns a URL usable as an <img> src.
// We store an image rather than a live <canvas> because a canvas element can
// only exist in one place in the DOM — and a duplicated page needs two tiles.
export async function renderThumbnail(sourceId, pageIndex) {
  const cacheKey = key(sourceId, pageIndex)
  if (thumbnails.has(cacheKey)) return thumbnails.get(cacheKey)

  const canvas = await drawPage(sourceId, pageIndex, { width: THUMBNAIL_WIDTH })
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

  const entry = { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }
  thumbnails.set(cacheKey, entry)
  return entry
}

// A big version of one page, for the redaction editor. Not cached — it is only
// ever needed for the page currently being edited.
export async function renderLarge(sourceId, pageIndex, rotation, width) {
  const canvas = await drawPage(sourceId, pageIndex, { rotation, width })
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }
}

// Flatten a page to a PNG with its redaction boxes painted on permanently.
//
// This is what makes redaction real rather than cosmetic. Drawing a black
// rectangle in the PDF would leave the original text underneath, still
// selectable and copyable. Rendering the page to pixels and painting over
// those pixels destroys the text outright — there is nothing left to recover.
// The cost is that the page becomes an image: no longer searchable, and larger.
export async function rasterizeRedacted(sourceId, pageIndex, rotation, redactions) {
  const canvas = await drawPage(sourceId, pageIndex, { rotation, scale: REDACT_DPI / 72 })

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  for (const r of redactions) {
    // Rectangles are stored 0..1 from the top-left, so they survive any zoom.
    ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height)
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    // Size in PDF points, so the flattened page comes out the same size as the
    // original rather than the size of the image in pixels.
    width: (canvas.width * 72) / REDACT_DPI,
    height: (canvas.height * 72) / REDACT_DPI,
  }
}

// Render every page of a finished PDF to an image.
//
// This is how flattening works: the document is built normally first — with
// the watermark, page numbers and labels as ordinary PDF text — and then the
// whole thing is re-rendered to pixels. Nothing is left that a PDF editor can
// select and delete, because there are no text objects any more.
//
// Doing it as a second pass over the finished file, rather than drawing the
// marks onto canvases directly, means the flattened output is guaranteed to
// match the normal output. There is only one piece of positioning code.
export async function flattenDocument(bytes, { dpi = 150, onProgress } = {}) {
  // getDocument returns a LOADING TASK; awaiting its .promise gives the
  // document. Cleanup lives on the loading task, not on the document — so we
  // have to keep hold of both.
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) })

  let pdf
  try {
    pdf = await loadingTask.promise
  } catch (error) {
    await loadingTask.destroy()
    throw new Error(`Could not reopen the built file to flatten it: ${error.message}`)
  }

  const images = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)

      // Browsers cap how big a canvas may be, and the limit is on total area,
      // not width or height. Past it, drawing silently produces nothing. So
      // measure first and quietly reduce the scale rather than failing.
      let scale = dpi / 72
      const probe = page.getViewport({ scale })
      const area = probe.width * probe.height
      if (area > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / area)

      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise

      // toBlob reports failure by handing back null instead of throwing, so an
      // unchecked result turns into a baffling error on the following line.
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) {
        throw new Error(
          `The browser ran out of room turning page ${pageNumber} into an image. ` +
          `Try a lower flatten quality.`,
        )
      }

      images.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        // Back to PDF points, so the flattened page keeps its physical size
        // even if the scale above had to be reduced. canvas.width is
        // pageWidthInPoints * scale, so dividing by scale undoes it.
        width: canvas.width / scale,
        height: canvas.height / scale,
      })

      // Let the browser actually repaint, so the progress message is visible
      // instead of the tab appearing frozen for the whole job.
      onProgress?.(pageNumber, pdf.numPages)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    // Shuts down the temporary worker this document was using. Without it,
    // every flatten would leave one running for the life of the tab.
    await loadingTask.destroy()
  }

  return images
}

// Read the bookmarks a document already has, flattened to a list with levels.
//
// A PDF destination can be an array whose first element points at a page, or
// the name of a destination defined elsewhere in the file — both appear in real
// documents, so both are resolved here. Entries that point nowhere usable are
// dropped rather than becoming bookmarks that go nowhere when clicked.
export async function readOutline(sourceId) {
  const pdf = documents.get(sourceId)
  if (!pdf) return []

  let outline
  try {
    outline = await pdf.getOutline()
  } catch {
    return []  // a malformed outline should not stop the file loading
  }
  if (!outline?.length) return []

  const pageIndexOf = async (dest) => {
    try {
      const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(resolved) || !resolved[0]) return null
      return await pdf.getPageIndex(resolved[0])
    } catch {
      return null
    }
  }

  const flat = []

  const walk = async (items, level) => {
    for (const item of items) {
      const pageIndex = await pageIndexOf(item.dest)
      const title = (item.title ?? '').trim()
      if (pageIndex !== null && title) flat.push({ title, level, pageIndex })
      if (item.items?.length) await walk(item.items, level + 1)
    }
  }

  await walk(outline, 1)
  return flat
}
