// ---------------------------------------------------------------------------
// ui/redact.js — the redaction editor: a big view of one page you drag boxes on.
//
// Boxes are stored as fractions of the page (0..1 from the top-left) rather
// than pixels, so they stay correct whatever size the page is rendered at here
// versus when it is flattened at export.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge } from '../render.js'
import { fitStage, placeholderStage } from './stage.js'

const STAGE_WIDTH = 720

// Zoom steps. 1 is "the whole page fits the dialog"; above that the page is
// re-rendered larger and scrolls inside its viewport, so text stays sharp
// instead of being a stretched thumbnail — the point is to read what you are
// about to destroy.
const ZOOM_STEPS = [1, 1.5, 2, 3, 4]
const MAX_RENDER_WIDTH = 2600

const dialog = document.querySelector('#redact-dialog')
const stage = document.querySelector('#redact-stage')
const caption = document.querySelector('#redact-caption')
const countEl = document.querySelector('#redact-count')
const colourInputs = document.querySelectorAll('input[name="redact-colour"]')

let currentPageId = null
let rects = []
let drawing = null
let imageUrl = null
let zoomIndex = 0
let renderToken = 0
let panning = null
// When on, a plain drag moves the page instead of drawing on it. A right-drag
// always pans, but a phone has no right button and a zoomed page has no
// reachable scrollbars, so there has to be a way in without a mouse.
let panMode = false

// --- drawing the boxes on screen -------------------------------------------

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Which colour new boxes are drawn in. Each box remembers its own, so one page
// can mix the two: a white box over a name in the body, a black one over a
// signature block.
function chosenColour() {
  for (const input of colourInputs) if (input.checked) return input.value
  return 'black'
}

function toRect(d) {
  const x = clamp01(Math.min(d.x0, d.x1 ?? d.x0))
  const y = clamp01(Math.min(d.y0, d.y1 ?? d.y0))
  return {
    x,
    y,
    w: clamp01(Math.max(d.x0, d.x1 ?? d.x0)) - x,
    h: clamp01(Math.max(d.y0, d.y1 ?? d.y0)) - y,
    // Older saved boxes have no colour; everything treats that as black.
    colour: d.colour ?? chosenColour(),
  }
}

function paint() {
  for (const el of stage.querySelectorAll('.redact-box')) el.remove()

  const all = drawing ? [...rects, toRect(drawing)] : rects
  for (const r of all) {
    const box = document.createElement('div')
    box.className = r.colour === 'white' ? 'redact-box white' : 'redact-box'
    box.style.left = `${r.x * 100}%`
    box.style.top = `${r.y * 100}%`
    box.style.width = `${r.w * 100}%`
    box.style.height = `${r.h * 100}%`
    stage.append(box)
  }

  countEl.textContent = rects.length === 0
    ? 'No boxes yet — drag across anything you want removed.'
    : `${rects.length} box${rects.length === 1 ? '' : 'es'} on this page.`
}

// --- pointer handling ------------------------------------------------------

function pointToFraction(event) {
  const bounds = stage.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  }
}

stage.addEventListener('pointerdown', (event) => {
  if (!imageUrl) return

  // The right button — or Move mode — moves the page instead of drawing on it.
  if (event.button === 2 || (panMode && event.button === 0)) {
    panning = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }
    stage.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }
  if (event.button !== 0) return

  const { x, y } = pointToFraction(event)
  drawing = { x0: x, y0: y, colour: chosenColour() }
  stage.setPointerCapture(event.pointerId)
  event.preventDefault()
})

// Suppress the context menu so a right-drag is a pan, not a menu.
stage.addEventListener('contextmenu', (event) => event.preventDefault())

stage.addEventListener('pointermove', (event) => {
  if (panning) {
    viewport.scrollLeft = panning.left - (event.clientX - panning.x)
    viewport.scrollTop = panning.top - (event.clientY - panning.y)
    return
  }
  if (!drawing) return
  const { x, y } = pointToFraction(event)
  drawing.x1 = x
  drawing.y1 = y
  paint()
})

stage.addEventListener('pointerup', () => {
  if (panning) {
    panning = null
    return
  }
  if (!drawing) return
  const rect = toRect(drawing)
  drawing = null

  // Ignore stray clicks that produced a box too small to be meant.
  if (rect.w > 0.005 && rect.h > 0.005) rects.push(rect)
  paint()
})

// --- zoom -------------------------------------------------------------------

const viewport = document.querySelector('#redact-viewport')
const zoomLevelEl = document.querySelector('#redact-zoom-level')

function zoomFactor() {
  return ZOOM_STEPS[zoomIndex]
}

// Re-render the page at the current zoom. Each call takes a token so a slow
// render at an old zoom cannot overwrite a newer one.
async function drawPageAtZoom({ keepCentre = true } = {}) {
  const page = model.getPage(currentPageId)
  if (!page) return

  const factor = zoomFactor()
  const width = Math.min(Math.round(STAGE_WIDTH * factor), MAX_RENDER_WIDTH)

  // Where the middle of the view is now, as a fraction of the whole page, so
  // zooming keeps looking at the same place rather than jumping to a corner.
  const before = {
    x: (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(1, viewport.scrollWidth),
    y: (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(1, viewport.scrollHeight),
  }

  const token = ++renderToken
  stage.classList.add('loading')

  const big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, width)
  if (token !== renderToken) return

  releaseImage()
  imageUrl = big.url

  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  stage.classList.remove('loading')
  if (factor === 1) {
    fitStage(stage, big.width, big.height)
  } else {
    // Zoomed in, the page is deliberately larger than the viewport so it can
    // be scrolled; fitStage's shrink-to-fit is exactly what we do not want.
    stage.style.width = `${big.width}px`
    stage.style.maxWidth = 'none'
    stage.style.aspectRatio = `${big.width} / ${big.height}`
    stage.style.height = 'auto'
  }
  stage.replaceChildren(img)
  paint()

  viewport.classList.toggle('zoomed', factor !== 1)
  const panButton = document.querySelector('#redact-pan')
  panButton.hidden = factor === 1
  if (factor === 1) setPanMode(false)
  zoomLevelEl.textContent = factor === 1 ? 'Fit' : `${Math.round(factor * 100)}%`
  document.querySelector('#redact-zoom-out').disabled = zoomIndex === 0
  document.querySelector('#redact-zoom-in').disabled = zoomIndex === ZOOM_STEPS.length - 1

  if (keepCentre) {
    viewport.scrollLeft = before.x * viewport.scrollWidth - viewport.clientWidth / 2
    viewport.scrollTop = before.y * viewport.scrollHeight - viewport.clientHeight / 2
  }
}

function setPanMode(on) {
  panMode = on
  const button = document.querySelector('#redact-pan')
  button.setAttribute('aria-pressed', String(on))
  button.classList.toggle('active', on)
  stage.classList.toggle('panning', on)
}

function setZoom(index) {
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index))
  if (next === zoomIndex) return
  zoomIndex = next
  drawPageAtZoom()
}

// --- opening and closing ---------------------------------------------------

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

export async function openRedactor(pageId) {
  const page = model.getPage(pageId)
  if (!page) return

  currentPageId = pageId
  rects = page.redactions.map((r) => ({ ...r }))
  drawing = null

  const source = model.getSource(page.sourceId)
  caption.textContent = `${source.name} — page ${page.pageIndex + 1}`

  stage.replaceChildren()
  stage.classList.add('loading')
  placeholderStage(stage, STAGE_WIDTH)
  zoomIndex = 0
  dialog.showModal()
  paint()

  await drawPageAtZoom({ keepCentre: false })
}

export function setupRedactor() {
  document.querySelector('#redact-zoom-in').addEventListener('click', () => setZoom(zoomIndex + 1))
  document.querySelector('#redact-zoom-out').addEventListener('click', () => setZoom(zoomIndex - 1))
  document.querySelector('#redact-zoom-fit').addEventListener('click', () => setZoom(0))
  document.querySelector('#redact-pan').addEventListener('click', () => setPanMode(!panMode))

  // Ctrl/Cmd with the wheel is what every document viewer uses to zoom, and it
  // is a trackpad pinch on a laptop. A plain wheel keeps scrolling the page.
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1))
  }, { passive: false })

  dialog.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoomIndex + 1) }
    if (event.key === '-') { event.preventDefault(); setZoom(zoomIndex - 1) }
    if (event.key === '0') { event.preventDefault(); setZoom(0) }
  })

  document.querySelector('#redact-undo').addEventListener('click', () => {
    rects.pop()
    paint()
  })

  document.querySelector('#redact-clear').addEventListener('click', () => {
    rects = []
    paint()
  })

  document.querySelector('#redact-cancel').addEventListener('click', () => {
    dialog.close()
  })

  document.querySelector('#redact-apply').addEventListener('click', () => {
    model.setRedactions(currentPageId, rects)
    dialog.close()
  })

  dialog.addEventListener('close', () => {
    releaseImage()
    setPanMode(false)
  })
}
