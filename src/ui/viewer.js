// ---------------------------------------------------------------------------
// ui/viewer.js — one page, large. For checking a page properly before saving.
//
// Shows the same overlays the thumbnail does, so what you see here is what the
// saved file will contain.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge } from '../render.js'
import { addOverlays } from './overlays.js'

const VIEW_WIDTH = 620

const dialog = document.querySelector('#viewer-dialog')
const frame = document.querySelector('#viewer-frame')
const caption = document.querySelector('#viewer-caption')
const counter = document.querySelector('#viewer-counter')

let position = 0
let imageUrl = null
// Bumped on each show(), so a slow render for a page you have already paged
// past does not overwrite the one you are now looking at.
let renderToken = 0

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

async function show() {
  const pages = model.getPages()
  if (pages.length === 0) return dialog.close()

  position = Math.min(Math.max(position, 0), pages.length - 1)
  const page = pages[position]
  const source = model.getSource(page.sourceId)
  const token = ++renderToken

  caption.textContent = `${source.name} — page ${page.pageIndex + 1}`
  counter.textContent = `${position + 1} of ${pages.length}`
  document.querySelector('#viewer-prev').disabled = position === 0
  document.querySelector('#viewer-next').disabled = position === pages.length - 1

  frame.replaceChildren()
  frame.classList.add('loading')

  const big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, VIEW_WIDTH)

  // A newer page was asked for while this one was rendering — throw it away.
  if (token !== renderToken) return URL.revokeObjectURL(big.url)

  releaseImage()
  imageUrl = big.url

  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  frame.classList.remove('loading')
  frame.style.width = `${big.width}px`
  frame.style.height = `${big.height}px`
  frame.replaceChildren(img)

  // Overlays are sized relative to the thumbnail, so scale them up to match.
  addOverlays(frame, page, position, { scale: big.width / 150 })
}

export async function openViewer(pageId) {
  const index = model.getPages().findIndex((p) => p.id === pageId)
  if (index === -1) return

  position = index
  if (!dialog.open) dialog.showModal()
  await show()
}

const currentPageId = () => model.getPages()[position]?.id

export function setupViewer(onRedact) {
  document.querySelector('#viewer-prev').addEventListener('click', () => { position--; show() })
  document.querySelector('#viewer-next').addEventListener('click', () => { position++; show() })
  document.querySelector('#viewer-close').addEventListener('click', () => dialog.close())

  document.querySelector('#viewer-rotate-left').addEventListener('click', () => {
    model.selectOnly(currentPageId())
    model.rotateSelected(-90)
    show()
  })

  document.querySelector('#viewer-rotate-right').addEventListener('click', () => {
    model.selectOnly(currentPageId())
    model.rotateSelected(90)
    show()
  })

  document.querySelector('#viewer-redact').addEventListener('click', () => {
    const id = currentPageId()
    dialog.close()
    onRedact(id)
  })

  // Arrow keys page through, which is the whole point of a viewer.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' && position > 0) { position--; show() }
    else if (event.key === 'ArrowRight' && position < model.getPages().length - 1) { position++; show() }
  })

  dialog.addEventListener('close', releaseImage)
}

// Redraw if the document changed underneath us (a rotation, a new label).
export function refreshViewer() {
  if (dialog.open) show()
}
