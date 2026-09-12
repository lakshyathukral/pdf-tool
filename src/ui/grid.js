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
  const sideways = page.rotation === 90 || page.rotation === 270
  if (thumb) {
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

  // The page's width in points as displayed, so added text is drawn to scale.
  const pointsWide = thumb ? (sideways ? thumb.pointsHigh : thumb.pointsWide) : 0
  const pointsHigh = thumb ? (sideways ? thumb.pointsWide : thumb.pointsHigh) : 0
  addOverlays(frame, page, position, { pointsWide, pointsHigh })

  // Markers for every bookmark starting on this page, so the structure of the
  // bundle is readable from the grid without opening the panel.
  page.bookmarks.forEach((bookmark, i) => {
    const flag = document.createElement('span')
    flag.className = `bookmark-flag level-${bookmark.level}`
    flag.style.top = `${3 + i * 13}px`
    flag.textContent = bookmark.title
    flag.title = bookmark.title
    frame.append(flag)
  })

  const caption = document.createElement('figcaption')
  caption.textContent = `${position + 1}`

  const origin = document.createElement('small')
  origin.textContent = page.redactions.length > 0
    ? `${source.name} p.${page.pageIndex + 1} · has redactions`
    : `${source.name} p.${page.pageIndex + 1}`
  origin.title = `${source.name}, page ${page.pageIndex + 1}`

  // Delete, on the page itself. The toolbar button only woke up once a page was
  // selected, so a grey "Delete" read as a feature that did not exist. Shown
  // only where the tool allows deleting (see the pages-deletable body class).
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'tile-delete'
  remove.textContent = '×'
  remove.title = `Delete page ${position + 1}`
  remove.setAttribute('aria-label', `Delete page ${position + 1}`)
  frame.append(remove)

  figure.append(frame, caption, origin)
  return figure
}

// What the tiles are drawn FROM, ignoring which pages are selected. When only
// the selection changes, the tiles themselves need no rebuilding.
//
// Replacing every tile on a click had a cost beyond the flicker: the tile under
// a double-click was thrown away between the two clicks, so the browser had no
// tile to report the double-click against and the page did not open.
function pagesSignature() {
  const settings = JSON.stringify([model.getNumbering(), model.getWatermark()])
  const pages = model.getPages().map((page) => [
    page.id,
    page.rotation,
    page.redactions.length,
    page.stamps.length,
    page.bookmarks.length,
    page.signatures.length,
    page.numberHidden ? 1 : 0,
    page.watermarkHidden ? 1 : 0,
    page.numberSpot ? `${page.numberSpot.anchor}${page.numberSpot.x}${page.numberSpot.y}` : '',
    getThumbnail(page.sourceId, page.pageIndex) ? 1 : 0,
  ].join(':')).join('|')
  return `${settings}#${pages}`
}

function paintSelection() {
  for (const tile of container.children) {
    tile.classList.toggle('selected', model.isSelected(tile.dataset.pageId))
  }
}

// Coalesced so a burst of changes paints once.
let pending = false
let lastSignature = null

export function drawGrid() {
  if (pending) return
  pending = true

  requestAnimationFrame(() => {
    pending = false
    const signature = pagesSignature()

    if (signature === lastSignature && container.children.length > 0) {
      paintSelection()
      return
    }

    lastSignature = signature
    container.replaceChildren(...model.getPages().map(makeTile))
    container.classList.toggle('empty', model.isEmpty())
  })
}
