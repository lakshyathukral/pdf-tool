// ---------------------------------------------------------------------------
// ui/overlays.js — the marks drawn on top of a page image: redaction boxes,
// watermark, text added to the page, and page number.
//
// Shared by the thumbnail grid and the full-size viewer so the two can never
// disagree about what a page is going to look like.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import * as signatures from '../signatures.js'
import { formatPageNumber } from '../export.js'
import { PAGE_NUMBER, anchorFractions, borderWidth, colourOf, countedPages, lastPageNumber, numberMark, resolveSpot } from '../textmarks.js'
import { cssFamily, hasItalic, registerFontFaces } from '../fonts.js'

// Text added to a page, in the same font, size, colour and box as the saved
// file. This used to be a white-on-black badge that looked nothing like what
// printed. Sizes are in container units (cqw), so one mark scales itself to
// whatever the page is shown at: a thumbnail, the viewer, or the placing view.
export function makeTextMark(mark, pointsWide, pointsHigh = pointsWide * 1.414) {
  registerFontFaces()
  mark = resolveSpot(mark, pointsWide, pointsHigh)

  const node = document.createElement('span')
  node.className = `text-mark box-${mark.box ?? 'none'}`
  node.textContent = mark.text

  const [ax, ay] = anchorFractions(mark.anchor)
  const perPoint = 100 / pointsWide

  node.style.left = `${mark.x * 100}%`
  node.style.top = `${mark.y * 100}%`
  node.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)`
  node.style.fontFamily = cssFamily(mark.font)
  node.style.fontWeight = mark.bold ? '700' : '400'
  node.style.fontStyle = mark.italic && hasItalic(mark.font) ? 'italic' : 'normal'
  node.style.fontSize = `${mark.size * perPoint}cqw`
  node.style.setProperty('--ink', colourOf(mark.colour).css)
  node.style.setProperty('--rule', `${borderWidth(mark.size) * perPoint}cqw`)
  return node
}


// Add every overlay for one page onto `frame`. `position` is where the page
// sits in the document (counting from 0), needed for the page number.
export function addOverlays(frame, page, position, { scale = 1, pointsWide = 0, pointsHigh = 0 } = {}) {
  // Redaction boxes. Stored as fractions of the page as displayed, so they map
  // straight onto the frame, which is also the page as displayed.
  page.redactions.forEach((r, index) => {
    const box = document.createElement('div')
    box.className = r.colour === 'white' ? 'redact-mark white' : 'redact-mark'
    // Lets the page viewer tell which box was tapped.
    box.dataset.index = String(index)
    box.style.left = `${r.x * 100}%`
    box.style.top = `${r.y * 100}%`
    box.style.width = `${r.w * 100}%`
    box.style.height = `${r.h * 100}%`
    frame.append(box)
  })

  // Signature placements, drawn where they will actually print.
  for (const placement of page.signatures) {
    const asset = signatures.getSignature(placement.signatureId)
    if (!asset) continue

    const mark = document.createElement('img')
    mark.className = 'sign-mark'
    mark.src = asset.url
    mark.style.left = `${placement.x * 100}%`
    mark.style.top = `${placement.y * 100}%`
    mark.style.width = `${placement.w * 100}%`
    mark.style.height = `${placement.h * 100}%`
    frame.append(mark)
  }

  // The watermark, drawn in the font, size, colour and darkness it prints in.
  // It used to be a fixed size in a bold grey that looked nothing like the
  // saved file. Sized in container units, like added text.
  const watermark = model.getWatermark()
  if (watermark.enabled && watermark.text && !page.watermarkHidden && pointsWide > 0) {
    registerFontFaces()
    const thirds = [1 / 6, 3 / 6, 5 / 6]
    const centres = watermark.tiled
      ? thirds.flatMap((y) => thirds.map((x) => [x, y]))
      : [[0.5, 0.5]]

    for (const [fx, fy] of centres) {
      const mark = document.createElement('span')
      mark.className = 'watermark-preview'
      mark.textContent = watermark.text
      mark.style.left = `${fx * 100}%`
      mark.style.top = `${fy * 100}%`
      mark.style.fontFamily = cssFamily(watermark.font ?? 'arial')
      mark.style.fontWeight = watermark.bold ? '700' : '400'
      mark.style.fontSize = `${(watermark.size * 100) / pointsWide}cqw`
      mark.style.color = colourOf(watermark.colour ?? 'grey').css
      mark.style.transform = `translate(-50%, -50%) rotate(${-watermark.angle}deg)`
      mark.style.opacity = String(watermark.opacity)
      frame.append(mark)
    }
  }

  // Until the page has rendered its size is unknown, and a guess would draw
  // the text at the wrong size. It appears a moment later with the image.
  if (pointsWide > 0) {
    for (const mark of page.stamps) {
      const node = makeTextMark(mark, pointsWide, pointsHigh)
      // Lets the page viewer tell which piece of text is being dragged.
      node.dataset.group = mark.group
      frame.append(node)
    }
  }

  // Page numbers, drawn the same way as added text, so they preview truly too.
  const numbering = model.getNumbering()
  if (numbering.enabled && pointsWide > 0) {
    const pages = model.getPages()
    const number = numbering.start + countedPages(numbering, pages.slice(0, position))
    const mark = numberMark(numbering, page, formatPageNumber(numbering, number, lastPageNumber(numbering, pages)))
    if (mark) {
      const node = makeTextMark(mark, pointsWide, pointsHigh)
      node.dataset.group = PAGE_NUMBER
      frame.append(node)
    }
  }
}
