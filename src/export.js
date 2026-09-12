// ---------------------------------------------------------------------------
// export.js — everything that touches pdf-lib. Turns the model into PDF bytes.
//
// It does not import pdf.js. Flattening a redacted page needs pdf.js, so the
// caller passes a `rasterize` function in. That keeps this file's job single:
// assemble a PDF from things it is given.
// ---------------------------------------------------------------------------

import { PDFDocument, degrees, rgb, PDFName, PDFHexString } from '@cantoo/pdf-lib'
import { zipSync } from 'fflate'
import { anchorFractions, anchorPoint, boxGeometry, borderWidth, colourOf, formatCounter, numberMark } from './textmarks.js'


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

// --- text on pages ---------------------------------------------------------

// Letters that belong with the one before them — a vowel sign, a virama, a
// joiner — must stay in the same run, or the syllable falls apart.
const JOINS_PREVIOUS = /\p{M}|\u200c|\u200d/u

// Split text into runs, each drawn with the first font piece that has its
// letters. For Hindi, "अनुलग्नक पी-1" becomes the Hindi words in the
// Devanagari piece and "-1" in the Latin one. A letter no piece has is drawn
// with the first, which at least keeps its place.
function splitRuns(text, kits) {
  const runs = []
  for (const letter of text) {
    const previous = runs.at(-1)
    let face = kits.findIndex((kit) => kit.hasGlyphForCodePoint(letter.codePointAt(0)))
    if (previous && JOINS_PREVIOUS.test(letter)) face = previous.face
    if (face === -1) face = 0

    if (previous && previous.face === face) previous.text += letter
    else runs.push({ face, text: letter })
  }
  return runs
}

// Load, measure and embed everything the text on these pages needs, before
// any drawing starts. Only the font pieces actually used are embedded, and
// only the letters used from them.
//
// loadFaces(fontId, bold, italic) returns the bytes of each piece of a font,
// in the order to try them. It is passed in so this file never has to know
// where fonts are kept: a browser fetches them, a test reads them from disk.
async function prepareTextMarks(output, pages, loadFaces, extraMarks = []) {
  const layouts = new Map()
  const marks = [...pages.flatMap((page) => page.stamps), ...extraMarks]
  if (marks.length === 0) return layouts
  if (!loadFaces) throw new Error('Text on pages needs its fonts, and none were provided.')

  // Only loaded when there is text to draw: fontkit is large.
  const fontkit = await import('fontkit')
  output.registerFontkit(fontkit)

  const styles = new Map()
  for (const mark of marks) {
    const key = `${mark.font}|${Boolean(mark.bold)}|${Boolean(mark.italic)}`
    if (!styles.has(key)) {
      const bytes = await loadFaces(mark.font, Boolean(mark.bold), Boolean(mark.italic))
      styles.set(key, { bytes, kits: bytes.map((b) => fontkit.create(b)), embedded: [] })
    }
    const style = styles.get(key)

    const runs = splitRuns(mark.text, style.kits)
    for (const run of runs) {
      style.embedded[run.face] ??= await output.embedFont(style.bytes[run.face], { subset: true })
      run.font = style.embedded[run.face]
    }

    const kit = style.kits[0]
    layouts.set(mark, {
      runs,
      width: runs.reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, mark.size), 0),
      ascent: kit.ascent / kit.unitsPerEm,
      descent: kit.descent / kit.unitsPerEm,
    })
  }
  return layouts
}

function drawTextMark(page, mark, layout, rotation) {
  const { width: w, height: h } = page.getSize()
  const [visualWidth, visualHeight] = rotation === 90 || rotation === 270 ? [h, w] : [w, h]

  const box = boxGeometry(layout.width, mark.size, layout.ascent, layout.descent)
  const [ax, ay] = anchorFractions(mark.anchor)

  // No x and y means the grid spot, worked out for this page's own size.
  const spot = Number.isFinite(mark.x) && Number.isFinite(mark.y)
    ? mark
    : anchorPoint(mark.anchor, visualWidth, visualHeight)

  // The box's top-left corner on the page as displayed, measured from the top.
  const left = spot.x * visualWidth - ax * box.width
  const top = spot.y * visualHeight - ay * box.height
  const ink = rgb(...colourOf(mark.colour).rgb)

  if (mark.box === 'outline' || mark.box === 'filled') {
    const filled = mark.box === 'filled'
    // A PDF line is centred on the edge it traces. Pulling the rectangle in by
    // half the line keeps all of it inside the box, as in the preview.
    const rule = filled ? 0 : borderWidth(mark.size)
    const [x, y] = visualToPage(left + rule / 2, visualHeight - top - box.height + rule / 2, w, h, rotation)
    page.drawRectangle({
      x,
      y,
      width: box.width - rule,
      height: box.height - rule,
      rotate: degrees(rotation),
      ...(filled ? { color: ink } : { borderColor: ink, borderWidth: rule }),
    })
  }

  const colour = mark.box === 'filled' ? rgb(1, 1, 1) : ink
  const baseline = visualHeight - top - box.baseline
  let across = left + box.inset

  for (const run of layout.runs) {
    const [x, y] = visualToPage(across, baseline, w, h, rotation)
    page.drawText(run.text, { x, y, size: mark.size, font: run.font, color: colour, rotate: degrees(rotation) })
    across += run.font.widthOfTextAtSize(run.text, mark.size)
  }
}

// Where the watermark copies sit, as fractions of the visible page.
function watermarkCentres(tiled) {
  if (!tiled) return [[0.5, 0.5]]

  const thirds = [1 / 6, 3 / 6, 5 / 6]
  return thirds.flatMap((y) => thirds.map((x) => [x, y]))
}

// A watermark sits across the page at an angle, so it needs its centre worked
// out rather than a corner. It is drawn in the same fonts as added text, from
// a layout measured before drawing began (see prepareTextMarks).
function drawWatermark(page, watermark, layout, rotation) {
  const { width: w, height: h } = page.getSize()
  const [visualWidth, visualHeight] = rotation === 90 || rotation === 270 ? [h, w] : [w, h]
  const { size } = watermark

  // The angle the user asked for, plus the page's own rotation so it looks
  // right on rotated pages too.
  const theta = ((watermark.angle + rotation) * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  // From the middle of the letters down to their baseline.
  const lift = ((layout.ascent + layout.descent) / 2) * size
  const colour = rgb(...colourOf(watermark.colour ?? 'grey').rgb)

  for (const [fx, fy] of watermarkCentres(watermark.tiled)) {
    const [cx, cy] = visualToPage(fx * visualWidth, fy * visualHeight, w, h, rotation)

    // drawText positions the START of the baseline. Walk back half the text's
    // width along its own direction, and down from its middle to its
    // baseline, so the middle of the text lands on the centre point.
    let x = cx - (layout.width / 2) * cos + lift * sin
    let y = cy - (layout.width / 2) * sin - lift * cos

    for (const run of layout.runs) {
      page.drawText(run.text, {
        x,
        y,
        size,
        font: run.font,
        color: colour,
        opacity: watermark.opacity,
        rotate: degrees(watermark.angle + rotation),
      })
      const advance = run.font.widthOfTextAtSize(run.text, size)
      x += advance * cos
      y += advance * sin
    }
  }
}

// Assemble a PDF from page images. Used when flattening: every page has been
// rendered to pixels, so there are no text objects left for anyone to edit.
export async function buildFlattened(images, metadata = { title: '', author: '' }, bookmarks = [], protection = null) {
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

  if (protection?.enabled && protection.password) {
    output.encrypt({ userPassword: protection.password, ownerPassword: protection.password })
  }

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
  // In the Hindi font the words are Hindi too; a font cannot translate them.
  const hindi = numbering.font === 'hindi'
  switch (numbering.style) {
    case 'bates': return `${numbering.prefix}${padded}`
    case 'plain': return String(n)
    case 'page': return hindi ? `पृष्ठ ${n}` : `Page ${n}`
    case 'page-of': return hindi ? `पृष्ठ ${n} / ${total}` : `Page ${n} of ${total}`
    case 'dashes': return `- ${n} -`
    case 'roman-lower': return formatCounter(n, 'i')
    case 'roman-upper': return formatCounter(n, 'I')
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
  loadFaces = null,
  metadata = { title: '', author: '' },
  protection = null,
  firstNumber = numbering.start,
  totalPages = numbering.start + pages.length - 1,
}) {
  // updateMetadata:false stops pdf-lib stamping its own name into Producer and
  // Creator, and stops it writing creation/modification timestamps. Nothing
  // goes into the file's metadata that was not asked for.
  const output = await PDFDocument.create({ updateMetadata: false })

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

    // A protected source has to be decrypted before its pages can be copied,
    // using the password it was opened with.
    const loaded = await PDFDocument.load(source.bytes, { password: source.password })
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

  // Page numbers are drawn like added text. Each page's number comes from its
  // place in this document — a split piece keeps counting — and a page whose
  // number is hidden still takes its turn in the count.
  const numberMarks = new Map()
  if (numbering.enabled) {
    let next = firstNumber
    for (const modelPage of pages) {
      const mark = numberMark(numbering, modelPage, formatPageNumber(numbering, next, totalPages))
      if (mark) numberMarks.set(modelPage, mark)
      // A hidden number still uses up its turn, unless set not to.
      if (mark || numbering.countHidden !== false) next++
    }
  }

  // The watermark is laid out once and drawn on every page it is not left off.
  const watermarkMark = watermark.enabled && watermark.text
    ? { text: watermark.text, size: watermark.size, font: watermark.font ?? 'arial', bold: Boolean(watermark.bold), italic: false }
    : null

  const textLayouts = await prepareTextMarks(output, pages, loadFaces, [
    ...numberMarks.values(),
    ...(watermarkMark ? [watermarkMark] : []),
  ])

  // Now rotate, watermark and number, walking model and output side by side.

  output.getPages().forEach((page, i) => {
    const modelPage = pages[i]

    // A flattened page already has the rotation baked into its pixels, so it
    // must stay at 0. Everything else keeps its own rotation plus ours.
    const rotation =
      modelPage.redactions.length > 0
        ? 0
        : (((page.getRotation().angle + modelPage.rotation) % 360) + 360) % 360

    page.setRotation(degrees(rotation))

    if (watermarkMark && !modelPage.watermarkHidden) {
      drawWatermark(page, watermark, textLayouts.get(watermarkMark), rotation)
    }

    // Signatures go on before added text and numbering, so a page number is
    // never hidden underneath a signature.
    for (const placement of modelPage.signatures) {
      const image = embedded.get(placement.signatureId)
      if (image) drawSignature(page, placement, image, rotation)
    }

    for (const mark of modelPage.stamps) {
      drawTextMark(page, mark, textLayouts.get(mark), rotation)
    }

    const pageNumber = numberMarks.get(modelPage)
    if (pageNumber) drawTextMark(page, pageNumber, textLayouts.get(pageNumber), rotation)
  })

  // Page indexes here are positions within this document, so a split piece or
  // an extract gets exactly the bookmarks belonging to its own pages.
  buildOutline(
    output,
    pages.flatMap((page, pageIndex) => page.bookmarks.map((b) => ({ ...b, pageIndex }))),
  )

  if (protection?.enabled && protection.password) {
    // userPassword is the one needed to OPEN the file. ownerPassword is set to
    // the same thing deliberately: a different owner password would let us
    // impose restrictions the user cannot themselves lift, which is not our
    // place.
    output.encrypt({
      userPassword: protection.password,
      ownerPassword: protection.password,
    })
  }

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

// Can this device hand a file to another app — the iOS and Android share sheet?
export function canShareFiles() {
  if (!navigator.canShare) return false
  try {
    const probe = new File([new Uint8Array([1])], 'probe.pdf', { type: 'application/pdf' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

// Hand the finished PDF straight to the share sheet.
//
// Saving works by minting a blob URL — an address that exists only inside this
// tab. Sharing from the browser's own download list attaches that address,
// which is meaningless anywhere else, so the recipient gets a dead link. This
// passes the actual file instead, and says what the accompanying text should
// be rather than leaving the browser to invent one.
export async function shareBytes(bytes, filename, text) {
  const file = new File([bytes], filename, { type: 'application/pdf' })
  await navigator.share({ files: [file], title: filename, text })
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
