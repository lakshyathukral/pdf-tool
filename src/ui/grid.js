// ---------------------------------------------------------------------------
// ui/grid.js — draws the thumbnail grid from the model.
//
// Rule for ui/ files: they read the model and call its functions, but never
// import pdf.js or pdf-lib directly. The one exception is formatPageNumber,
// which is pure text formatting shared with the exporter so the preview and
// the saved file can never disagree.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { getThumbnail } from '../render.js'
import { addOverlays } from './overlays.js'

const container = document.querySelector('#thumbnails')

function makeTile(page, position) {
  const figure = document.createElement('figure')
  figure.className = 'tile'
  figure.draggable = true
  figure.dataset.position = position
  figure.dataset.pageId = page.id
  if (model.isSelected(page.id)) figure.classList.add('selected')

  // --- the thumbnail image ---
  const frame = document.createElement('div')
  frame.className = 'frame'

  const thumb = getThumbnail(page.sourceId, page.pageIndex)
  if (thumb) {
    const sideways = page.rotation === 90 || page.rotation === 270
    // The frame takes the ROTATED dimensions so the grid lays out correctly;
    // the image keeps its natural size and is spun inside it.
    frame.style.width = `${sideways ? thumb.height : thumb.width}px`
    frame.style.height = `${sideways ? thumb.width : thumb.height}px`

    const img = document.createElement('img')
    img.src = thumb.url
    img.width = thumb.width
    img.height = thumb.height
    img.style.transform = `rotate(${page.rotation}deg)`
    img.alt = ''
    frame.append(img)
  } else {
    frame.classList.add('loading')
  }

  // --- a coloured bar showing which file this page came from ---
  const source = model.getSource(page.sourceId)
  const bar = document.createElement('span')
  bar.className = 'source-bar'
  bar.style.background = source.color
  bar.title = source.name
  frame.append(bar)

  addOverlays(frame, page, position)

  const caption = document.createElement('figcaption')
  caption.textContent = `${position + 1}`

  const origin = document.createElement('small')
  origin.textContent = page.redactions.length > 0
    ? `${source.name} p.${page.pageIndex + 1} · redacted`
    : `${source.name} p.${page.pageIndex + 1}`
  origin.title = `${source.name}, page ${page.pageIndex + 1}`

  figure.append(frame, caption, origin)
  return figure
}

// Rebuilding the whole grid is cheap: the images already exist, we are only
// rearranging elements. Coalesced so a burst of changes paints once.
let pending = false

export function drawGrid() {
  if (pending) return
  pending = true

  requestAnimationFrame(() => {
    pending = false
    container.replaceChildren(...model.getPages().map(makeTile))
    container.classList.toggle('empty', model.isEmpty())
  })
}
