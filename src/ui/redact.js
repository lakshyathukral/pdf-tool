// ---------------------------------------------------------------------------
// ui/redact.js — the redaction view: every page of the document in one
// scrolling column, with search at the top.
//
// It used to open a single page at a time, so redacting a forty-page bundle
// meant forty trips in and out of a dialog. Now the whole document scrolls, a
// box can be drawn on any page, and a search outlines every match in place.
//
// Nothing touches the document until Apply. Until then the boxes live in a
// draft, so Cancel genuinely leaves the document as it was, and Apply is a
// single step that one Undo takes back.
//
// Boxes are fractions of the page as displayed (0..1 from the top-left), so
// they hold whatever size a page is drawn at here or flattened at on export.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge, getThumbnail, findOnPage, pageHasText } from '../render.js'

const FIT_WIDTH = 780
const ZOOM_STEPS = [1, 1.5, 2, 3]
const MAX_RENDER_WIDTH = 2600
const MIN_BOX = 0.005

const $ = (selector) => document.querySelector(selector)

const dialog = $('#redact-dialog')
const scroller = $('#redact-scroll')
const countEl = $('#redact-count')
const zoomLevelEl = $('#redact-zoom-level')
const searchField = $('#redact-search')
const matchCaseBox = $('#redact-match-case')
const searchStatus = $('#redact-search-status')
const resultsBar = $('#redact-search-results')
const applyMatchesButton = $('#redact-apply-matches')
const drawButton = $('#redact-draw')
const colourInputs = document.querySelectorAll('input[name="redact-colour"]')

// A phone scrolls with a finger, so on a touch screen a drag scrolls unless
// drawing is switched on. A mouse always draws, and the wheel scrolls.
const touchFirst = window.matchMedia('(pointer: coarse)').matches
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

let draft = new Map()  // pageId -> the boxes that Apply will write
let history = []       // { pageId, rect } in the order they were added
let matches = []       // { id, pageId, rects, included }
let matchCursor = -1
let zoomIndex = 0
let drawMode = !touchFirst
let drawing = null
let panning = null
// A box being moved, or resized by its corner: { stage, rect, start, x0, y0, resize }
let editing = null
let dirty = false
let observer = null
let renderSeq = 0

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const clamp01 = (v) => Math.min(1, Math.max(0, v))

function chosenColour() {
  for (const input of colourInputs) if (input.checked) return input.value
  return 'black'
}

const stageFor = (pageId) =>
  scroller.querySelector(`.redact-stage[data-page-id="${CSS.escape(pageId)}"]`)

// --- sizes -----------------------------------------------------------------

// "Fit" is the width the view can show without sideways scrolling; zooming
// multiplies it. The page is drawn a little larger than it is shown on a sharp
// screen, so text stays readable while you decide what to destroy.
const fitWidth = () => Math.max(240, Math.min(FIT_WIDTH, scroller.clientWidth - 32))
const displayWidth = () => Math.round(fitWidth() * ZOOM_STEPS[zoomIndex])
const renderWidth = () =>
  Math.min(MAX_RENDER_WIDTH, Math.round(displayWidth() * Math.min(2, window.devicePixelRatio || 1)))

// Until a page is drawn, its box takes the shape of its thumbnail so the
// scroll position does not jump about as pages arrive.
function placeholderRatio(page) {
  const thumb = getThumbnail(page.sourceId, page.pageIndex)
  if (!thumb) return '1 / 1.414'
  const sideways = page.rotation === 90 || page.rotation === 270
  return sideways ? `${thumb.height} / ${thumb.width}` : `${thumb.width} / ${thumb.height}`
}

// --- drawing pages, only when they are near the screen -----------------------

// Rendering all three hundred pages of a bundle at once would flatten a phone.
// Each page is drawn as it comes within reach and let go once it is far away,
// the way a PDF reader behaves.
function watch() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) renderStage(entry.target)
      else release(entry.target)
    }
  }, { root: scroller, rootMargin: '1500px 0px' })
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

  // A newer render, a release, or a closed dialog all make this one stale.
  if (stage.dataset.token !== token || !stage.isConnected || !dialog.open) {
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

function buildPages() {
  const width = displayWidth()

  const sections = model.getPages().map((page, position) => {
    const section = document.createElement('section')
    section.className = 'redact-page'

    const label = document.createElement('p')
    label.className = 'redact-page-label'
    label.textContent = `Page ${position + 1}`

    const stage = document.createElement('div')
    stage.className = 'redact-stage loading'
    stage.dataset.pageId = page.id
    stage.style.width = `${width}px`
    stage.style.aspectRatio = placeholderRatio(page)

    section.append(label, stage)
    return section
  })

  scroller.replaceChildren(...sections)
  for (const stage of scroller.querySelectorAll('.redact-stage')) {
    paintStage(stage)
    observer.observe(stage)
  }
}

// --- boxes and matches on screen -------------------------------------------

function place(node, rect) {
  node.style.left = `${rect.x * 100}%`
  node.style.top = `${rect.y * 100}%`
  node.style.width = `${rect.w * 100}%`
  node.style.height = `${rect.h * 100}%`
}

function boxElement(rect, pageId, index) {
  const box = document.createElement('div')
  box.className = rect.colour === 'white' ? 'redact-box white' : 'redact-box'
  place(box, rect)

  // The box being dragged out has no remove button yet: it is not a box yet.
  if (index >= 0) {
    // A finished box can be dragged to move it, or by its corner to resize it
    // — the same as text is moved on the page elsewhere in the app.
    box.dataset.pageId = pageId
    box.dataset.index = String(index)
    box.title = 'Drag to move. Drag the corner to resize.'

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'redact-remove'
    remove.textContent = '×'
    remove.title = 'Remove this box'
    remove.setAttribute('aria-label', 'Remove this box')
    remove.dataset.pageId = pageId
    remove.dataset.index = String(index)

    const resize = document.createElement('span')
    resize.className = 'redact-resize'
    resize.setAttribute('aria-hidden', 'true')

    box.append(remove, resize)
  }
  return box
}

function matchElement(match, rect) {
  const node = document.createElement('div')
  node.className = match.included ? 'redact-match' : 'redact-match excluded'
  node.dataset.matchId = String(match.id)
  node.title = match.included
    ? 'This will be redacted. Click to leave it out.'
    : 'Left out. Click to include it again.'
  place(node, rect)
  return node
}

function toRect(d) {
  const x0 = Math.min(d.x0, d.x1 ?? d.x0)
  const y0 = Math.min(d.y0, d.y1 ?? d.y0)
  return {
    x: x0,
    y: y0,
    w: Math.max(d.x0, d.x1 ?? d.x0) - x0,
    h: Math.max(d.y0, d.y1 ?? d.y0) - y0,
    colour: d.colour,
  }
}

function paintStage(stage) {
  const pageId = stage.dataset.pageId
  for (const node of stage.querySelectorAll('.redact-box, .redact-match')) node.remove()

  ;(draft.get(pageId) ?? []).forEach((rect, index) => stage.append(boxElement(rect, pageId, index)))

  for (const match of matches) {
    if (match.pageId !== pageId) continue
    for (const rect of match.rects) stage.append(matchElement(match, rect))
  }

  if (drawing?.pageId === pageId) stage.append(boxElement(toRect(drawing), pageId, -1))
}

function paintAll() {
  for (const stage of scroller.querySelectorAll('.redact-stage')) paintStage(stage)
  updateCount()
}

function updateCount() {
  let boxes = 0
  let pagesWithBoxes = 0
  for (const rects of draft.values()) {
    if (rects.length === 0) continue
    boxes += rects.length
    pagesWithBoxes += 1
  }

  // Applying turns every page with a box into a picture, so say so before it
  // happens rather than leaving it to be discovered in the saved file.
  countEl.textContent = boxes === 0
    ? 'No boxes yet. Drag across anything that must be removed, on any page.'
    : `${plural(boxes, 'box', 'boxes')} on ${plural(pagesWithBoxes, 'page')}. Applying turns `
      + `${pagesWithBoxes === 1 ? 'that page' : 'those pages'} into images, which is what destroys the text.`

  $('#redact-undo').disabled = history.length === 0
}

// --- drawing, removing, undoing --------------------------------------------

function fractionIn(stage, event) {
  const bounds = stage.getBoundingClientRect()
  return {
    x: clamp01((event.clientX - bounds.left) / bounds.width),
    y: clamp01((event.clientY - bounds.top) / bounds.height),
  }
}

scroller.addEventListener('pointerdown', (event) => {
  // Remove buttons and matches act on click; they must not start a box.
  if (event.target.closest('.redact-remove, .redact-match')) return

  // The right button moves the view, as it does in most document viewers.
  if (event.button === 2) {
    panning = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
    scroller.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }

  // On a finished box, a drag moves it — or resizes it, from its corner.
  const boxNode = event.target.closest('.redact-box[data-index]')
  if (boxNode && event.button === 0) {
    const boxStage = boxNode.closest('.redact-stage')
    const rect = draft.get(boxNode.dataset.pageId)?.[Number(boxNode.dataset.index)]
    if (boxStage && rect) {
      const { x, y } = fractionIn(boxStage, event)
      editing = {
        stage: boxStage,
        rect,
        start: { ...rect },
        x0: x,
        y0: y,
        resize: Boolean(event.target.closest('.redact-resize')),
      }
      boxStage.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
  }

  const stage = event.target.closest('.redact-stage')
  if (!stage || event.button !== 0) return
  if (event.pointerType === 'touch' && !drawMode) return
  if (!stage.dataset.url) return

  const { x, y } = fractionIn(stage, event)
  drawing = { pageId: stage.dataset.pageId, stage, x0: x, y0: y, colour: chosenColour() }
  stage.setPointerCapture(event.pointerId)
  event.preventDefault()
})

scroller.addEventListener('pointermove', (event) => {
  if (panning) {
    scroller.scrollLeft = panning.left - (event.clientX - panning.x)
    scroller.scrollTop = panning.top - (event.clientY - panning.y)
    return
  }

  if (editing) {
    const { x, y } = fractionIn(editing.stage, event)
    const { rect, start } = editing
    const dx = x - editing.x0
    const dy = y - editing.y0

    // The box is changed where it lives in the draft, so Undo last box and
    // Apply both see the moved box.
    if (editing.resize) {
      rect.w = Math.min(1 - start.x, Math.max(MIN_BOX * 2, start.w + dx))
      rect.h = Math.min(1 - start.y, Math.max(MIN_BOX * 2, start.h + dy))
    } else {
      rect.x = Math.min(1 - start.w, Math.max(0, start.x + dx))
      rect.y = Math.min(1 - start.h, Math.max(0, start.y + dy))
    }
    dirty = true
    paintStage(editing.stage)
    return
  }

  if (!drawing) return

  const { x, y } = fractionIn(drawing.stage, event)
  drawing.x1 = x
  drawing.y1 = y
  paintStage(drawing.stage)
})

function finishPointer() {
  if (panning) {
    panning = null
    return
  }
  if (editing) {
    editing = null
    updateCount()
    return
  }
  if (!drawing) return

  const done = drawing
  drawing = null
  const rect = toRect(done)

  // A stray tap makes a box too small to have been meant.
  if (rect.w > MIN_BOX && rect.h > MIN_BOX) {
    const list = draft.get(done.pageId) ?? []
    list.push(rect)
    draft.set(done.pageId, list)
    history.push({ pageId: done.pageId, rect })
    dirty = true
  }

  paintStage(done.stage)
  updateCount()
}

scroller.addEventListener('pointerup', finishPointer)
scroller.addEventListener('pointercancel', finishPointer)
scroller.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.redact-stage')) event.preventDefault()
})

scroller.addEventListener('click', (event) => {
  const remove = event.target.closest('.redact-remove')
  if (remove) return removeBox(remove.dataset.pageId, Number(remove.dataset.index))

  const match = event.target.closest('.redact-match')
  if (match) toggleMatch(Number(match.dataset.matchId))
})

function removeBox(pageId, index) {
  const list = draft.get(pageId)
  if (!list?.[index]) return

  const [gone] = list.splice(index, 1)
  history = history.filter((entry) => entry.rect !== gone)
  dirty = true

  const stage = stageFor(pageId)
  if (stage) paintStage(stage)
  updateCount()
}

function undoLastBox() {
  const last = history.pop()
  if (!last) return

  const list = draft.get(last.pageId) ?? []
  const index = list.indexOf(last.rect)
  if (index >= 0) list.splice(index, 1)
  dirty = true

  const stage = stageFor(last.pageId)
  if (stage) paintStage(stage)
  updateCount()
}

function setDrawMode(on) {
  drawMode = on
  scroller.classList.toggle('drawing', on)
  drawButton.hidden = !touchFirst
  drawButton.setAttribute('aria-pressed', String(on))
  drawButton.textContent = on ? 'Stop drawing' : 'Draw boxes'
}

// --- search ------------------------------------------------------------------

// Text positions come back for the page as stored. A page the person has
// rotated is shown turned, so each match is turned the same way to land on the
// words it found, using the same rotation the model applies to drawn boxes.
function displayedRect(rect, page) {
  let r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  const turns = ((((page.rotation ?? 0) / 90) % 4) + 4) % 4
  for (let i = 0; i < turns; i++) r = model.rotateRect(r, true)
  return { x: r.x, y: r.y, w: r.w, h: r.h }
}

async function runSearch() {
  const needle = searchField.value.trim()
  clearMatches()

  if (needle === '') {
    searchStatus.textContent = 'Type a name, a number or a phrase to find.'
    return
  }

  const pages = model.getPages()
  const findButton = $('#redact-find')
  searchStatus.textContent = `Searching ${plural(pages.length, 'page')}…`
  findButton.disabled = true

  const found = []
  let pagesWithText = 0
  let nextId = 1

  try {
    for (const page of pages) {
      if (await pageHasText(page.sourceId, page.pageIndex)) pagesWithText += 1
      const hits = await findOnPage(page.sourceId, page.pageIndex, needle, {
        matchCase: matchCaseBox.checked,
      })
      for (const hit of hits) {
        found.push({
          id: nextId++,
          pageId: page.id,
          rects: hit.rects.map((rect) => displayedRect(rect, page)),
          included: true,
        })
      }
    }
  } catch (error) {
    searchStatus.textContent = `Could not search this document: ${error.message}`
    return
  } finally {
    findButton.disabled = false
  }

  matches = found
  matchCursor = -1

  if (found.length === 0) {
    searchStatus.textContent = pagesWithText === 0
      ? 'This document has no text to search. It is probably a scan or a photograph, so draw the boxes by hand.'
      : `No match for "${needle}".`
  } else {
    const onPages = new Set(found.map((m) => m.pageId)).size
    searchStatus.textContent =
      `${plural(found.length, 'match', 'matches')} on ${plural(onPages, 'page')}, outlined in yellow. `
      + 'Click any to leave it out.'
  }

  paintAll()
  refreshMatchControls()
  if (found.length > 0) goToMatch(0)
}

function refreshMatchControls() {
  const included = matches.filter((m) => m.included).length
  resultsBar.hidden = matches.length === 0
  applyMatchesButton.disabled = included === 0
  applyMatchesButton.textContent = included === 0
    ? 'Nothing left to redact'
    : `Redact ${plural(included, 'match', 'matches')}`
  $('#redact-prev').disabled = matches.length < 2
  $('#redact-next').disabled = matches.length < 2
}

function toggleMatch(id) {
  const match = matches.find((m) => m.id === id)
  if (!match) return
  match.included = !match.included

  const stage = stageFor(match.pageId)
  if (stage) paintStage(stage)
  refreshMatchControls()
}

function clearMatches() {
  matches = []
  matchCursor = -1
  for (const stage of scroller.querySelectorAll('.redact-stage')) paintStage(stage)
  refreshMatchControls()
}

function goToMatch(index) {
  if (matches.length === 0) return
  matchCursor = (index + matches.length) % matches.length

  const match = matches[matchCursor]
  const stage = stageFor(match.pageId)
  if (!stage) return

  const rect = match.rects[0]
  scroller.scrollTo({
    top: Math.max(0, stage.offsetTop + rect.y * stage.clientHeight - scroller.clientHeight / 3),
    left: Math.max(0, stage.offsetLeft + rect.x * stage.clientWidth - scroller.clientWidth / 2),
    behavior: reducedMotion ? 'auto' : 'smooth',
  })

  for (const node of stage.querySelectorAll(`.redact-match[data-match-id="${match.id}"]`)) {
    node.classList.remove('flash')
    void node.offsetWidth
    node.classList.add('flash')
  }
}

// Matches become ordinary boxes, in the colour chosen, and join the draft. They
// can still be removed one by one before Apply, like any box drawn by hand.
function applyMatches() {
  const colour = chosenColour()
  let added = 0

  for (const match of matches) {
    if (!match.included) continue
    const list = draft.get(match.pageId) ?? []
    for (const r of match.rects) {
      const rect = { ...r, colour }
      list.push(rect)
      history.push({ pageId: match.pageId, rect })
      added += 1
    }
    draft.set(match.pageId, list)
  }

  if (added > 0) dirty = true
  matches = []
  matchCursor = -1
  searchStatus.textContent = added > 0
    ? `Added ${plural(added, 'box', 'boxes')}. Check them as you scroll, then Apply.`
    : ''

  paintAll()
  refreshMatchControls()
}

// --- zoom ------------------------------------------------------------------

function syncZoom() {
  const factor = ZOOM_STEPS[zoomIndex]
  zoomLevelEl.textContent = factor === 1 ? 'Fit' : `${Math.round(factor * 100)}%`
  $('#redact-zoom-out').disabled = zoomIndex === 0
  $('#redact-zoom-in').disabled = zoomIndex === ZOOM_STEPS.length - 1
}

function setZoom(index) {
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index))
  if (next === zoomIndex) return

  // Keep looking at the same part of the document rather than jumping.
  const along = scroller.scrollTop / Math.max(1, scroller.scrollHeight)

  zoomIndex = next
  syncZoom()

  const width = displayWidth()
  for (const stage of scroller.querySelectorAll('.redact-stage')) stage.style.width = `${width}px`
  scroller.scrollTop = along * scroller.scrollHeight

  // Pages already drawn are redrawn at the new size; the rest arrive sharp as
  // they scroll into reach.
  for (const stage of scroller.querySelectorAll('.redact-stage')) {
    if (stage.dataset.url) renderStage(stage)
  }
}

// --- opening, applying, closing --------------------------------------------

function teardown() {
  observer?.disconnect()
  observer = null
  for (const stage of scroller.querySelectorAll('.redact-stage')) release(stage)
  scroller.replaceChildren()
  matches = []
  drawing = null
  panning = null
  editing = null
}

// Opens on the whole document. Given a page, it scrolls there first, so the
// page viewer and a selected page still take you straight to the right place.
export function openRedactor(pageId = null) {
  const pages = model.getPages()
  if (pages.length === 0) return

  draft = new Map(pages.map((page) => [page.id, page.redactions.map((r) => ({ ...r }))]))
  history = []
  matches = []
  matchCursor = -1
  drawing = null
  panning = null
  dirty = false
  zoomIndex = 0
  searchField.value = ''
  searchStatus.textContent = ''

  dialog.showModal()

  syncZoom()
  setDrawMode(!touchFirst)
  watch()
  buildPages()
  refreshMatchControls()
  updateCount()

  scroller.scrollTop = 0
  if (pageId) {
    requestAnimationFrame(() => {
      const stage = stageFor(pageId)
      if (stage) scroller.scrollTop = Math.max(0, stage.parentElement.offsetTop - 8)
    })
  }
}

export function setupRedactor() {
  $('#redact-find').addEventListener('click', runSearch)
  searchField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      runSearch()
    }
  })

  $('#redact-prev').addEventListener('click', () => goToMatch(matchCursor - 1))
  $('#redact-next').addEventListener('click', () => goToMatch(matchCursor + 1))
  applyMatchesButton.addEventListener('click', applyMatches)
  $('#redact-clear-matches').addEventListener('click', () => {
    clearMatches()
    searchStatus.textContent = ''
  })

  $('#redact-zoom-in').addEventListener('click', () => setZoom(zoomIndex + 1))
  $('#redact-zoom-out').addEventListener('click', () => setZoom(zoomIndex - 1))
  drawButton.addEventListener('click', () => setDrawMode(!drawMode))
  $('#redact-undo').addEventListener('click', undoLastBox)

  // Ctrl or Cmd with the wheel zooms, as does a trackpad pinch. A plain wheel
  // scrolls through the document.
  scroller.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1))
  }, { passive: false })

  dialog.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoomIndex + 1) }
    else if (event.key === '-') { event.preventDefault(); setZoom(zoomIndex - 1) }
    else if (event.key === '0') { event.preventDefault(); setZoom(0) }
    else if (event.key === 'z' && !event.target.matches('input')) { event.preventDefault(); undoLastBox() }
  })

  $('#redact-cancel').addEventListener('click', () => {
    dirty = false
    dialog.close()
  })

  $('#redact-apply').addEventListener('click', () => {
    model.replaceRedactions([...draft].map(([pageId, rects]) => ({ pageId, rects })))
    dirty = false
    dialog.close()
  })

  // Escape would otherwise throw away a document's worth of boxes in one key.
  dialog.addEventListener('cancel', (event) => {
    if (!dirty) return
    event.preventDefault()
    countEl.textContent =
      'You have boxes that are not applied yet. Press Apply to keep them, or Cancel to throw them away.'
  })

  dialog.addEventListener('close', teardown)

  window.addEventListener('resize', () => {
    if (!dialog.open) return
    const width = displayWidth()
    for (const stage of scroller.querySelectorAll('.redact-stage')) stage.style.width = `${width}px`
  })
}
