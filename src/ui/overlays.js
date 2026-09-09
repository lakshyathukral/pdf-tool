// ---------------------------------------------------------------------------
// ui/overlays.js — the marks drawn on top of a page image: redaction boxes,
// watermark, label and page number.
//
// Shared by the thumbnail grid and the full-size viewer so the two can never
// disagree about what a page is going to look like.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import * as signatures from '../signatures.js'
import { formatPageNumber } from '../export.js'

// A preview of a stamp, placed in the corner it will actually print in.
export function makeBadge(text, position, kind) {
  const badge = document.createElement('span')
  badge.className = `badge ${kind} at-${position}`
  badge.textContent = text
  return badge
}

// Add every overlay for one page onto `frame`. `position` is where the page
// sits in the document (counting from 0), needed for the page number.
export function addOverlays(frame, page, position, { scale = 1 } = {}) {
  // Redaction boxes. Stored as fractions of the page as displayed, so they map
  // straight onto the frame, which is also the page as displayed.
  for (const r of page.redactions) {
    const box = document.createElement('div')
    box.className = 'redact-mark'
    box.style.left = `${r.x * 100}%`
    box.style.top = `${r.y * 100}%`
    box.style.width = `${r.w * 100}%`
    box.style.height = `${r.h * 100}%`
    frame.append(box)
  }

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

  const watermark = model.getWatermark()
  if (watermark.enabled && watermark.text) {
    // Same positions the exporter uses, so the preview does not lie.
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
      mark.style.fontSize = `${(watermark.tiled ? 0.45 : 0.9) * scale}rem`
      mark.style.transform = `translate(-50%, -50%) rotate(${-watermark.angle}deg)`
      mark.style.opacity = Math.min(1, watermark.opacity * 3)
      frame.append(mark)
    }
  }

  for (const stamp of page.stamps) {
    frame.append(makeBadge(stamp.text, stamp.position, 'label'))
  }

  const numbering = model.getNumbering()
  if (numbering.enabled) {
    const total = numbering.start + model.getPages().length - 1
    const text = formatPageNumber(numbering, numbering.start + position, total)
    frame.append(makeBadge(text, numbering.position, 'numbering'))
  }
}
