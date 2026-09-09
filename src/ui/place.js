// ---------------------------------------------------------------------------
// ui/place.js — dragging a label into position on the page.
//
// Typing percentages works, but nobody thinks in percentages. This shows the
// page with the label on it and lets you move it with the mouse — or a finger,
// since it uses pointer events.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge } from '../render.js'
import { fitStage, placeholderStage } from './stage.js'

const STAGE_WIDTH = 720

const dialog = document.querySelector('#place-dialog')
const stage = document.querySelector('#place-stage')
const caption = document.querySelector('#place-caption')
const readout = document.querySelector('#place-readout')

let chip = null
let position = { x: 0.5, y: 0.5 }
let dragOffset = null
let imageUrl = null
let onDone = () => {}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

function paint() {
  if (!chip) return
  chip.style.left = `${position.x * 100}%`
  chip.style.top = `${position.y * 100}%`
  readout.textContent =
    `${Math.round(position.x * 1000) / 10}% across, ${Math.round(position.y * 1000) / 10}% down`
}

const fractionOf = (event) => {
  const bounds = stage.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  }
}

// Dragging the label itself: keep the grab point under the pointer rather than
// snapping the corner to it, which feels wrong.
stage.addEventListener('pointerdown', (event) => {
  if (!chip) return
  const point = fractionOf(event)

  if (event.target === chip) {
    dragOffset = { x: point.x - position.x, y: point.y - position.y }
  } else {
    // Clicking the page moves the label there, centred on the click.
    const bounds = stage.getBoundingClientRect()
    const chipBox = chip.getBoundingClientRect()
    dragOffset = { x: chipBox.width / bounds.width / 2, y: chipBox.height / bounds.height / 2 }
    position = { x: clamp01(point.x - dragOffset.x), y: clamp01(point.y - dragOffset.y) }
    paint()
  }

  stage.setPointerCapture(event.pointerId)
  event.preventDefault()
})

stage.addEventListener('pointermove', (event) => {
  if (!dragOffset) return
  const point = fractionOf(event)
  position = { x: clamp01(point.x - dragOffset.x), y: clamp01(point.y - dragOffset.y) }
  paint()
})

stage.addEventListener('pointerup', () => { dragOffset = null })

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

export async function openPlacer({ pageId, text, size, start }, done) {
  const page = model.getPage(pageId)
  if (!page) return

  onDone = done
  position = { x: clamp01(start?.x ?? 0.5), y: clamp01(start?.y ?? 0.5) }
  dragOffset = null
  chip = null

  const source = model.getSource(page.sourceId)
  caption.textContent = `${source.name} — page ${page.pageIndex + 1}`

  stage.replaceChildren()
  stage.classList.add('loading')
  placeholderStage(stage, STAGE_WIDTH)
  dialog.showModal()

  const big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, STAGE_WIDTH)
  releaseImage()
  imageUrl = big.url

  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  chip = document.createElement('span')
  chip.className = 'place-chip'
  chip.textContent = text
  // Show the label at its real size: the page is drawn `big.width` pixels wide
  // for a page `pointsWide` points wide, so a point is that many pixels.
  chip.style.fontSize = `${size * (big.width / big.pointsWide)}px`

  stage.classList.remove('loading')
  fitStage(stage, big.width, big.height)
  stage.replaceChildren(img, chip)
  paint()
}

export function setupPlacer() {
  document.querySelector('#place-cancel').addEventListener('click', () => dialog.close())

  document.querySelector('#place-apply').addEventListener('click', () => {
    onDone({ ...position })
    dialog.close()
  })

  document.querySelector('#place-centre').addEventListener('click', () => {
    position = { x: 0.5, y: 0.5 }
    paint()
  })

  dialog.addEventListener('close', releaseImage)
}
