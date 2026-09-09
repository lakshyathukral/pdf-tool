// ---------------------------------------------------------------------------
// export.js — everything that touches pdf-lib. Turns the model into PDF bytes.
//
// It does not import pdf.js. Flattening a redacted page needs pdf.js, so the
// caller passes a `rasterize` function in. That keeps this file's job single:
// assemble a PDF from things it is given.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFHexString } from 'pdf-lib'
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
export async function buildFlattened(images, metadata = { title: '', author: '' }, bookmarks = []) {
  if (images.length === 0) throw new Error('There are no pages to flatten.')

  const output = await PDFDocument.create({ updateMetadata: false })

  output.setProducer('')
  output.setCreator('')
  output.setTitle(metadata.title ?? '')
  output.setAuthor(metadata.author ?? '')
  output.setSubject('')
  output.setKeywords([])

  for (const image of images) {
    const embedded = image.mime === 'image/jpeg'
      ? await output.embedJpg(image.bytes)
      : await output.embedPng(image.bytes)
    const page = output.addPage([image.width, image.height])
    page.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
  }

  // The flattened document is built from scratch, so its outline must be
  // rebuilt too — otherwise flattening a bundle for filing would quietly
  // strip the navigation, which is exactly when it matters most.
  buildOutline(output, bookmarks)

  return output.save()
}

// --- signatures ------------------------------------------------------------

// Draw one signature image where the user put it.
//
// Placements are fractions of the page AS DISPLAYED, measured from the
// top-left. PDF drawing coordinates run from the bottom-left of the UNROTATED
// page, so both of those have to be undone.
function drawSignature(page, placement, image, rotation) {
  const { width: w, height: h } = page.getSize()
  const [visualWidth, visualHeight] = rotation === 90 || rotation === 270 ? [h, w] : [w, h]

  const boxWidth = placement.w * visualWidth
  const boxHeight = placement.h * visualHeight

  // Fractions count down from the top; PDF counts up from the bottom.
  const vx = placement.x * visualWidth
  const vy = (1 - placement.y - placement.h) * visualHeight

  const [x, y] = visualToPage(vx, vy, w, h, rotation)

  // Rotating the image by the same amount as the page cancels the page's own
  // rotation out, so the signature sits square to what the reader sees.
  page.drawImage(image, {
    x,
    y,
    width: boxWidth,
    height: boxHeight,
    rotate: degrees(rotation),
  })
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
  signatures = new Map(),
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

  // Embed each signature image once, however many pages it appears on.
  const embedded = new Map()
  for (const modelPage of pages) {
    for (const placement of modelPage.signatures) {
      if (embedded.has(placement.signatureId)) continue

      const asset = signatures.get(placement.signatureId)
      if (!asset) continue

      embedded.set(
        placement.signatureId,
        asset.mime === 'image/jpeg'
          ? await output.embedJpg(asset.bytes)
          : await output.embedPng(asset.bytes),
      )
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

    // Signatures go on before labels and numbering, so a page number is never
    // hidden underneath a signature.
    for (const placement of modelPage.signatures) {
      const image = embedded.get(placement.signatureId)
      if (image) drawSignature(page, placement, image, rotation)
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

  // Page indexes here are positions within this document, so a split piece or
  // an extract gets exactly the bookmarks belonging to its own pages.
  buildOutline(
    output,
    pages.flatMap((page, pageIndex) => page.bookmarks.map((b) => ({ ...b, pageIndex }))),
  )

  return output.save()
}

// --- bookmarks -------------------------------------------------------------

// pdf-lib has no bookmark API, so the outline has to be built out of raw PDF
// objects. A PDF outline is a doubly-linked tree: every entry points at its
// parent, its previous and next siblings, and its first and last children.
// Every one of those has to agree, or Acrobat shows an empty panel and says
// nothing about why.

// Turn the flat list — each entry a title, a page and a level — into a tree.
// A level-2 entry becomes a child of the level-1 entry above it. An entry that
// is deeper than the one before allows is pulled up rather than dropped, so a
// stray sub-bookmark with no parent still appears.
// Deep enough for a real document's own structure once it has been pushed a
// level down to sit under its filename. Hand-made bookmarks rarely go past 2.
export const MAX_BOOKMARK_LEVEL = 5

function nestEntries(entries) {
  const root = { children: [] }
  const openAt = [root]  // openAt[n] is the node currently open at depth n

  for (const entry of entries) {
    const wanted = Math.max(1, Math.min(entry.level ?? 1, MAX_BOOKMARK_LEVEL))
    const depth = Math.min(wanted, openAt.length)

    openAt.length = depth
    const node = { title: entry.title, pageIndex: entry.pageIndex, children: [] }
    openAt[depth - 1].children.push(node)
    openAt.push(node)
  }

  return root
}

const countDescendants = (node) =>
  node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)

export function buildOutline(output, entries) {
  const context = output.context
  const pages = output.getPages()

  // Drop entries with no title, or pointing at a page that is not in this
  // document — a split piece holds only some of them. Checking the number
  // rather than calling getPage(), which throws on a bad index.
  const usable = entries.filter(
    (e) => e.title?.trim() && Number.isInteger(e.pageIndex) && e.pageIndex >= 0 && e.pageIndex < pages.length,
  )
  if (usable.length === 0) return 0
  const root = nestEntries(usable)

  // Every node needs its own reference before any of them can be written,
  // because siblings point at each other in both directions.
  const assignRefs = (node) => {
    for (const child of node.children) {
      child.ref = context.nextRef()
      assignRefs(child)
    }
  }

  const rootRef = context.nextRef()
  assignRefs(root)

  const write = (node, parentRef) => {
    node.children.forEach((child, i) => {
      const fields = {
        Title: PDFHexString.fromText(child.title),
        Parent: parentRef,
        // /Fit means "show the whole page", which behaves predictably at any
        // window size — unlike /XYZ, which pins a zoom level.
        Dest: [pages[child.pageIndex].ref, PDFName.of('Fit')],
      }

      if (i > 0) fields.Prev = node.children[i - 1].ref
      if (i < node.children.length - 1) fields.Next = node.children[i + 1].ref

      if (child.children.length > 0) {
        fields.First = child.children[0].ref
        fields.Last = child.children.at(-1).ref
        // A positive count means the entry starts expanded; negative, collapsed.
        fields.Count = countDescendants(child)
      }

      context.assign(child.ref, context.obj(fields))
      write(child, child.ref)
    })
  }

  write(root, rootRef)

  context.assign(rootRef, context.obj({
    Type: PDFName.of('Outlines'),
    First: root.children[0].ref,
    Last: root.children.at(-1).ref,
    Count: countDescendants(root),
  }))

  output.catalog.set(PDFName.of('Outlines'), rootRef)
  return usable.length
}

// --- splitting -------------------------------------------------------------

// Where each output file should start, as indexes into the document.
//   'each'      — every page becomes its own file
//   'selected'  — each selected page begins a new file
//   'bookmarks' — each top-level bookmark begins a new file
// Pure arithmetic, kept out of the UI so it can be tested on its own.
export function splitStarts(pages, mode, isSelected, topLevelPositions = []) {
  if (mode === 'each') return pages.map((_, i) => i)

  const begins =
    mode === 'bookmarks'
      ? new Set(topLevelPositions)
      : new Set(pages.map((page, i) => (isSelected(page.id) ? i : -1)))

  // The first page always begins a file, whatever else is marked.
  return [...new Set([0, ...pages.map((_, i) => i).filter((i) => begins.has(i))])]
    .sort((a, b) => a - b)
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
