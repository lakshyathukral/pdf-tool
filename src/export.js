// ---------------------------------------------------------------------------
// export.js — everything that touches pdf-lib. Turns the model into PDF bytes.
//
// It does not import pdf.js. Flattening a redacted page needs pdf.js, so the
// caller passes a `rasterize` function in. That keeps this file's job single:
// assemble a PDF from things it is given.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { zipSync } from 'fflate'

const MARGIN = 36  // half an inch, in PDF points (72 per inch)

// --- geometry --------------------------------------------------------------

// A page's displayed orientation comes from its /Rotate value, but drawing
// coordinates are always in the UNROTATED page space. So to place something
// where the user sees "bottom right", we work out the point in the rotated
// (visual) frame and convert it back.
//
// w,h are the unrotated page size. Rotation is clockwise, as PDF defines it.
function visualToPage(vx, vy, w, h, rotation) {
  if (rotation === 90) return [w - vy, vx]
  if (rotation === 180) return [w - vx, h - vy]
  if (rotation === 270) return [vy, h - vx]
  return [vx, vy]
}

function drawStamp(page, { text, position, size }, font, rotation) {
  const { width: w, height: h } = page.getSize()
  const [visualWidth, visualHeight] = rotation === 90 || rotation === 270 ? [h, w] : [w, h]

  const textWidth = font.widthOfTextAtSize(text, size)
  const textHeight = font.heightAtSize(size)

  const [vertical, horizontal] = position.split('-')

  const vx =
    horizontal === 'left' ? MARGIN
    : horizontal === 'center' ? (visualWidth - textWidth) / 2
    : visualWidth - MARGIN - textWidth

  const vy =
    vertical === 'bottom' ? MARGIN
    : vertical === 'middle' ? (visualHeight - textHeight) / 2
    : visualHeight - MARGIN - textHeight

  const [x, y] = visualToPage(vx, vy, w, h, rotation)

  // Rotating the text by the same amount as the page cancels the page's
  // rotation out, so the stamp reads horizontally on screen.
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0), rotate: degrees(rotation) })
}

// Where the watermark copies sit, as fractions of the visible page.
function watermarkCentres(tiled) {
  if (!tiled) return [[0.5, 0.5]]

  const thirds = [1 / 6, 3 / 6, 5 / 6]
  return thirds.flatMap((y) => thirds.map((x) => [x, y]))
}

// A watermark sits across the page at an angle, so it needs its centre worked
// out rather than a corner.
function drawWatermark(page, watermark, font, rotation) {
  const { width: w, height: h } = page.getSize()
  const [visualWidth, visualHeight] = rotation === 90 || rotation === 270 ? [h, w] : [w, h]

  const textWidth = font.widthOfTextAtSize(watermark.text, watermark.size)
  const textHeight = font.heightAtSize(watermark.size)

  // The angle the user asked for, plus the page's own rotation so it looks
  // right on rotated pages too.
  const theta = ((watermark.angle + rotation) * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  for (const [fx, fy] of watermarkCentres(watermark.tiled)) {
    const [cx, cy] = visualToPage(fx * visualWidth, fy * visualHeight, w, h, rotation)

    // drawText positions the START of the baseline. Walk back half the text's
    // width along its own direction, and half its height perpendicular to
    // that, so the middle of the text lands on the centre point.
    page.drawText(watermark.text, {
      x: cx - (textWidth / 2) * cos + (textHeight / 2) * sin,
      y: cy - (textWidth / 2) * sin - (textHeight / 2) * cos,
      size: watermark.size,
      font,
      color: rgb(0.4, 0.4, 0.4),
      opacity: watermark.opacity,
      rotate: degrees(watermark.angle + rotation),
    })
  }
}

// Assemble a PDF from page images. Used when flattening: every page has been
// rendered to pixels, so there are no text objects left for anyone to edit.
export async function buildFlattened(images, metadata = { title: '', author: '' }) {
  if (images.length === 0) throw new Error('There are no pages to flatten.')

  const output = await PDFDocument.create({ updateMetadata: false })

  output.setProducer('')
  output.setCreator('')
  output.setTitle(metadata.title ?? '')
  output.setAuthor(metadata.author ?? '')
  output.setSubject('')
  output.setKeywords([])

  for (const image of images) {
    const embedded = await output.embedPng(image.bytes)
    const page = output.addPage([image.width, image.height])
    page.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
  }

  return output.save()
}

// --- page numbering styles -------------------------------------------------

export function formatPageNumber(numbering, n, total) {
  const padded = String(n).padStart(numbering.padding, '0')
  switch (numbering.style) {
    case 'bates': return `${numbering.prefix}${padded}`
    case 'plain': return String(n)
    case 'page': return `Page ${n}`
    case 'page-of': return `Page ${n} of ${total}`
    case 'dashes': return `- ${n} -`
    default: return String(n)
  }
}

// --- building --------------------------------------------------------------

// `pages` is the slice of the document to build. firstNumber/totalPages let a
// split chunk keep counting from where the whole document was up to, rather
// than restarting at 1 in every piece.
export async function buildPdf({
  pages,
  sources,
  numbering,
  watermark,
  rasterize,
  metadata = { title: '', author: '' },
  firstNumber = numbering.start,
  totalPages = numbering.start + pages.length - 1,
}) {
  // updateMetadata:false stops pdf-lib stamping its own name into Producer and
  // Creator, and stops it writing creation/modification timestamps. Nothing
  // goes into the file's metadata that was not asked for.
  const output = await PDFDocument.create({ updateMetadata: false })
  const font = await output.embedFont(StandardFonts.Helvetica)

  // The output is a brand-new document, so the source's Title, Author, Subject
  // and Keywords are never carried over. What IS left is pdf-lib stamping its
  // own name into Producer/Creator, which tells a reader what made the file.
  // Blank those, then write whatever the user actually wants recorded.
  output.setProducer('')
  output.setCreator('')
  output.setTitle(metadata.title ?? '')
  output.setAuthor(metadata.author ?? '')
  output.setSubject('')
  output.setKeywords([])

  const plain = pages.filter((p) => p.redactions.length === 0)

  // Copy from each source in one call — pdf-lib deduplicates shared fonts and
  // images that way, instead of copying them once per page.
  const copiedBySource = new Map()
  for (const [sourceId, source] of sources) {
    const indices = plain.filter((p) => p.sourceId === sourceId).map((p) => p.pageIndex)
    if (indices.length === 0) continue

    const loaded = await PDFDocument.load(source.bytes)
    copiedBySource.set(sourceId, await output.copyPages(loaded, indices))
  }

  // Walk the model in order. Untouched pages come from their source's pile;
  // redacted ones are rebuilt from a flattened image.
  const cursors = new Map()

  for (const modelPage of pages) {
    if (modelPage.redactions.length > 0) {
      const flat = await rasterize(
        modelPage.sourceId,
        modelPage.pageIndex,
        modelPage.rotation,
        modelPage.redactions,
      )
      const image = await output.embedPng(flat.bytes)
      const page = output.addPage([flat.width, flat.height])
      page.drawImage(image, { x: 0, y: 0, width: flat.width, height: flat.height })
    } else {
      const i = cursors.get(modelPage.sourceId) ?? 0
      cursors.set(modelPage.sourceId, i + 1)
      output.addPage(copiedBySource.get(modelPage.sourceId)[i])
    }
  }

  // Now rotate, watermark and number, walking model and output side by side.
  let number = firstNumber

  output.getPages().forEach((page, i) => {
    const modelPage = pages[i]

    // A flattened page already has the rotation baked into its pixels, so it
    // must stay at 0. Everything else keeps its own rotation plus ours.
    const rotation =
      modelPage.redactions.length > 0
        ? 0
        : (((page.getRotation().angle + modelPage.rotation) % 360) + 360) % 360

    page.setRotation(degrees(rotation))

    if (watermark.enabled && watermark.text) {
      drawWatermark(page, watermark, font, rotation)
    }

    for (const stamp of modelPage.stamps) {
      drawStamp(page, stamp, font, rotation)
    }

    if (numbering.enabled) {
      drawStamp(
        page,
        {
          text: formatPageNumber(numbering, number, totalPages),
          position: numbering.position,
          size: numbering.size,
        },
        font,
        rotation,
      )
      number++
    }
  })

  return output.save()
}

// --- splitting -------------------------------------------------------------

// Where each output file should start, as indexes into the document.
//   'each'     — every page becomes its own file
//   'selected' — each selected page begins a new file
// Pure arithmetic, kept out of the UI so it can be tested on its own.
export function splitStarts(pages, mode, isSelected) {
  if (mode === 'each') return pages.map((_, i) => i)

  return pages
    .map((page, i) => (i === 0 || isSelected(page.id) ? i : -1))
    .filter((i) => i !== -1)
}

// --- naming ----------------------------------------------------------------

export function defaultOutputName(sources) {
  if (sources.size === 1) {
    const [only] = sources.values()
    return only.name.replace(/\.pdf$/i, '')
  }
  return 'combined'
}

// Strip anything the operating system would object to in a filename.
export function safeFileName(base, fallback = 'document') {
  const cleaned = base.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '').trim()
  return `${cleaned || fallback}.pdf`
}

// --- delivering to the user ------------------------------------------------

// Browsers have no "save file" function, so we mint a temporary URL pointing at
// the bytes and click a link at it. The download attribute is what makes the
// browser save rather than open.
export function downloadBytes(bytes, filename, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }))

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  // Free the memory once the download has started. Revoking immediately can
  // cancel it in some browsers, hence the delay.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Several files at once. Browsers block or prompt on repeated downloads, so a
// set of files goes out as one zip instead.
export function downloadMany(files, zipName) {
  if (files.length === 1) {
    return downloadBytes(files[0].bytes, files[0].name)
  }

  const entries = {}
  for (const file of files) entries[file.name] = file.bytes

  // level 0 = store without compressing. PDFs are already compressed, so
  // squeezing them again costs time and saves almost nothing.
  const zipped = zipSync(entries, { level: 0 })
  downloadBytes(zipped, zipName, 'application/zip')
}
