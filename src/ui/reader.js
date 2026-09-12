// ---------------------------------------------------------------------------
// ui/reader.js — the document as a scrolling column of full-size pages.
//
// Thumbnails are for arranging a bundle; they are useless for reading one. This
// shows the pages at a size you can actually read, one under the other, with
// everything that will print drawn on them.
//
// Pages are drawn as they come within reach and let go once they are far away,
// the way a PDF reader behaves — otherwise a three-hundred page bundle would
// flatten a phone. The redaction view works the same way.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge, getThumbnail } from '../render.js'
import { addOverlays } from './overlays.js'

const container = document.querySelector('#reader')

const FIT_WIDTH = 820
const ZOOM_STEPS = [1, 1.5, 2, 3]

let zoomIndex = 0
let observer = null
let renderSeq = 0
let onOpenPage = () => {}

export const isReading = () => !container.hidden

const fitWidth = () => Math.max(240, Math.min(FIT_WIDTH, container.clientWidth - 32))
const displayWidth = () => Math.round(fitWidth() * ZOOM_STEPS[zoomIndex])
const renderWidth = () => Math.min(2600, Math.round(displayWidth() * Math.min(2, window.devicePixelRatio || 1)))

// Until a page is drawn, its box takes the shape of its thumbnail, so the
// scroll position does not jump about as pages arrive.
function placeholderRatio(page) {
  const thumb = getThumbnail(page.sourceId, page.pageIndex)
  if (!thumb) return '1 / 1.414'
  const sideways = page.rotation === 90 || page.rotation === 270
  return sideways ? `${thumb.height} / ${thumb.width}` : `${thumb.width} / ${thumb.height}`
}

function release(stage) {
  if (stage.dataset.url) URL.revokeObjectURL(stage.dataset.url)
  stage.querySelector(':scope > img')?.remove()
  delete stage.dataset.url
  delete stage.dataset.renderedAt
  delete stage.dataset.rendering
  stage.dataset.token = String(++renderSeq)
  stage.classList.add('loading')
}

async function renderStage(stage) {
  const page = model.getPage(stage.dataset.pageId)
  if (!page) return

  const width = renderWidth()
  if (stage.dataset.renderedAt === String(width) || stage.dataset.rendering === String(width)) return

  const token = String(++renderSeq)
  stage.dataset.token = token
  stage.dataset.rendering = String(width)

  let big
  try {
    big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, width)
  } catch {
    delete stage.dataset.rendering
    return
  }

  // A newer render, a release, or a closed view all make this one stale.
  if (stage.dataset.token !== token || !stage.isConnected || container.hidden) {
    URL.revokeObjectURL(big.url)
    return
  }

  release(stage)
  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  stage.style.aspectRatio = `${big.width} / ${big.height}`
  stage.prepend(img)
  stage.dataset.url = big.url
  stage.dataset.renderedAt = String(width)
  stage.classList.remove('loading')

  // Everything that will print: added text, page numbers, the watermark and
  // any redaction boxes.
  addOverlays(stage, page, model.getPages().indexOf(page), {
    scale: big.width / 150,
    pointsWide: big.pointsWide,
    pointsHigh: big.pointsHigh,
  })
}

function watch() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) renderStage(entry.target)
      else release(entry.target)
    }
  }, { root: null, rootMargin: '1200px 0px' })
}

function build() {
  const width = displayWidth()

  container.replaceChildren(...model.getPages().map((page, position) => {
    const section = document.createElement('section')
    section.className = 'reader-page'
    if (model.isSelected(page.id)) section.classList.add('selected')
    section.dataset.pageId = page.id

    const label = document.createElement('p')
    label.className = 'reader-label'
    const source = model.getSource(page.sourceId)
    label.textContent = `Page ${position + 1} — ${source?.name ?? ''}`

    const stage = document.createElement('div')
    stage.className = 'reader-stage loading'
    stage.dataset.pageId = page.id
    stage.style.width = `${width}px`
    stage.style.aspectRatio = placeholderRatio(page)

    section.append(label, stage)
    return section
  }))

  for (const stage of container.querySelectorAll('.reader-stage')) observer?.observe(stage)
}

// The pages, ignoring which are selected: only a change here needs redrawing.
let lastSignature = null

function signature() {
  const settings = JSON.stringify([model.getNumbering(), model.getWatermark()])
  const pages = model.getPages().map((page) => [
    page.id, page.rotation, page.redactions.length, page.stamps.length,
    page.numberHidden ? 1 : 0, page.watermarkHidden ? 1 : 0,
  ].join(':')).join('|')
  return `${settings}#${pages}#${ZOOM_STEPS[zoomIndex]}`
}

export function drawReader() {
  if (container.hidden) return

  const now = signature()
  if (now === lastSignature && container.children.length > 0) {
    for (const section of container.children) {
      section.classList.toggle('selected', model.isSelected(section.dataset.pageId))
    }
    return
  }

  lastSignature = now
  build()
}

export function setReading(on) {
  container.hidden = !on
  document.querySelector('#thumbnails').hidden = on
  document.querySelector('#view-zoom').hidden = !on

  if (!on) {
    observer?.disconnect()
    for (const stage of container.querySelectorAll('.reader-stage')) release(stage)
    container.replaceChildren()
    lastSignature = null
    return
  }

  watch()
  lastSignature = null
  drawReader()
}

function syncZoom() {
  const factor = ZOOM_STEPS[zoomIndex]
  document.querySelector('#reader-zoom-level').textContent = factor === 1 ? 'Fit' : `${Math.round(factor * 100)}%`
  document.querySelector('#reader-zoom-out').disabled = zoomIndex === 0
  document.querySelector('#reader-zoom-in').disabled = zoomIndex === ZOOM_STEPS.length - 1
}

function setZoom(index) {
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index))
  if (next === zoomIndex) return

  zoomIndex = next
  syncZoom()

  const width = displayWidth()
  for (const stage of container.querySelectorAll('.reader-stage')) {
    stage.style.width = `${width}px`
    if (stage.dataset.url) renderStage(stage)
  }
  lastSignature = signature()
}

export function setupReader(openPage) {
  onOpenPage = openPage

  // Clicking a page selects it, as clicking a thumbnail does; a double-click
  // opens it full size, again like the thumbnails.
  container.addEventListener('click', (event) => {
    const section = event.target.closest('.reader-page')
    if (!section || event.target.closest('.text-mark, .mv-bar')) return
    model.toggleSelection(section.dataset.pageId)
  })

  container.addEventListener('dblclick', (event) => {
    const section = event.target.closest('.reader-page')
    if (section) onOpenPage(section.dataset.pageId)
  })

  document.querySelector('#reader-zoom-in').addEventListener('click', () => setZoom(zoomIndex + 1))
  document.querySelector('#reader-zoom-out').addEventListener('click', () => setZoom(zoomIndex - 1))

  window.addEventListener('resize', () => {
    if (container.hidden) return
    const width = displayWidth()
    for (const stage of container.querySelectorAll('.reader-stage')) stage.style.width = `${width}px`
  })

  syncZoom()
}
