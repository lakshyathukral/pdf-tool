// ---------------------------------------------------------------------------
// ui/sign.js — placing a signature image on a page.
//
// Drag a box where the signature should go. The height follows the image's own
// proportions, so a signature never comes out stretched.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import * as signatures from '../signatures.js'
import { renderLarge } from '../render.js'
import { fitStage, placeholderStage } from './stage.js'

const STAGE_WIDTH = 720

const dialog = document.querySelector('#sign-dialog')
const stage = document.querySelector('#sign-stage')
const caption = document.querySelector('#sign-caption')
const chooser = document.querySelector('#sign-choose')
const countEl = document.querySelector('#sign-count')

let pageId = null
let placements = []
let drawing = null
let imageUrl = null

const chosenSignature = () => signatures.getSignature(chooser.value)

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// The box the user dragged, with its height set from the signature's own
// proportions rather than wherever the pointer happened to stop.
function boxFrom(drag) {
  const asset = chosenSignature()
  if (!asset) return null

  const x = clamp01(Math.min(drag.x0, drag.x1 ?? drag.x0))
  const width = clamp01(Math.max(drag.x0, drag.x1 ?? drag.x0)) - x
  if (width <= 0.01) return null

  // Fractions are of different lengths in each direction, so the page's own
  // shape has to be divided out to keep the image's true aspect.
  const stageAspect = stage.clientWidth / stage.clientHeight
  const height = width * (asset.height / asset.width) * stageAspect

  return { x, y: clamp01(Math.min(drag.y0, drag.y1 ?? drag.y0)), w: width, h: clamp01(height) }
}

function paint() {
  for (const el of stage.querySelectorAll('.sign-mark')) el.remove()

  const preview = drawing ? boxFrom(drawing) : null
  const all = preview ? [...placements, preview] : placements

  for (const box of all) {
    const asset = signatures.getSignature(box.signatureId ?? chooser.value)
    const mark = document.createElement('img')
    mark.className = 'sign-mark'
    mark.src = asset?.url ?? ''
    mark.style.left = `${box.x * 100}%`
    mark.style.top = `${box.y * 100}%`
    mark.style.width = `${box.w * 100}%`
    mark.style.height = `${box.h * 100}%`
    stage.append(mark)
  }

  countEl.textContent = placements.length === 0
    ? 'Drag a box where the signature should go.'
    : `${placements.length} on this page.`
}

const fractionOf = (event) => {
  const bounds = stage.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  }
}

stage.addEventListener('pointerdown', (event) => {
  if (!imageUrl || !chosenSignature()) return
  const { x, y } = fractionOf(event)
  drawing = { x0: x, y0: y }
  stage.setPointerCapture(event.pointerId)
  event.preventDefault()
})

stage.addEventListener('pointermove', (event) => {
  if (!drawing) return
  const { x, y } = fractionOf(event)
  drawing.x1 = x
  drawing.y1 = y
  paint()
})

stage.addEventListener('pointerup', () => {
  if (!drawing) return
  const box = boxFrom(drawing)
  drawing = null
  if (box) placements.push({ signatureId: chooser.value, ...box })
  paint()
})

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

function fillChooser() {
  const all = signatures.listSignatures()
  const previous = chooser.value
  chooser.replaceChildren(...all.map((sig) => new Option(sig.name, sig.id)))
  if (all.some((sig) => sig.id === previous)) chooser.value = previous
}

export async function openSigner(id) {
  const page = model.getPage(id)
  if (!page || !signatures.hasSignatures()) return

  pageId = id
  placements = page.signatures.map((s) => ({ ...s }))
  drawing = null

  fillChooser()
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

// Replace this page's placements with whatever is on the stage.
function commit() {
  const page = model.getPage(pageId)
  if (!page) return
  for (let i = page.signatures.length - 1; i >= 0; i--) model.removeSignaturePlacement(pageId, i)
  for (const box of placements) {
    model.placeSignature(pageId, box.signatureId, { x: box.x, y: box.y, w: box.w, h: box.h })
  }
}

export function setupSigner() {
  chooser.addEventListener('change', paint)

  document.querySelector('#sign-undo').addEventListener('click', () => { placements.pop(); paint() })
  document.querySelector('#sign-clear').addEventListener('click', () => { placements = []; paint() })
  document.querySelector('#sign-cancel').addEventListener('click', () => dialog.close())

  document.querySelector('#sign-apply').addEventListener('click', () => {
    commit()
    dialog.close()
  })

  // Put the LAST box drawn onto every selected page — how you initial each
  // page of a bundle without repeating the work forty times.
  document.querySelector('#sign-all').addEventListener('click', () => {
    const box = placements.at(-1)
    if (!box) return
    commit()
    model.placeSignatureOnSelected(box.signatureId, { x: box.x, y: box.y, w: box.w, h: box.h })
    dialog.close()
  })

  dialog.addEventListener('close', releaseImage)
}
