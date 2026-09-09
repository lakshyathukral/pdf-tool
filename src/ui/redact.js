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

const dialog = document.querySelector('#redact-dialog')
const stage = document.querySelector('#redact-stage')
const caption = document.querySelector('#redact-caption')
const countEl = document.querySelector('#redact-count')

let currentPageId = null
let rects = []
let drawing = null
let imageUrl = null

// --- drawing the boxes on screen -------------------------------------------

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function toRect(d) {
  const x = clamp01(Math.min(d.x0, d.x1 ?? d.x0))
  const y = clamp01(Math.min(d.y0, d.y1 ?? d.y0))
  return {
    x,
    y,
    w: clamp01(Math.max(d.x0, d.x1 ?? d.x0)) - x,
    h: clamp01(Math.max(d.y0, d.y1 ?? d.y0)) - y,
  }
}

function paint() {
  for (const el of stage.querySelectorAll('.redact-box')) el.remove()

  const all = drawing ? [...rects, toRect(drawing)] : rects
  for (const r of all) {
    const box = document.createElement('div')
    box.className = 'redact-box'
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
  const { x, y } = pointToFraction(event)
  drawing = { x0: x, y0: y }
  stage.setPointerCapture(event.pointerId)
  event.preventDefault()
})

stage.addEventListener('pointermove', (event) => {
  if (!drawing) return
  const { x, y } = pointToFraction(event)
  drawing.x1 = x
  drawing.y1 = y
  paint()
})

stage.addEventListener('pointerup', () => {
  if (!drawing) return
  const rect = toRect(drawing)
  drawing = null

  // Ignore stray clicks that produced a box too small to be meant.
  if (rect.w > 0.005 && rect.h > 0.005) rects.push(rect)
  paint()
})

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
  dialog.showModal()
  paint()

  const big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, STAGE_WIDTH)
  releaseImage()
  imageUrl = big.url

  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  stage.classList.remove('loading')
  fitStage(stage, big.width, big.height)
  stage.replaceChildren(img)
  paint()
}

export function setupRedactor() {
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

  dialog.addEventListener('close', releaseImage)
}
