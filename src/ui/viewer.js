// ---------------------------------------------------------------------------
// ui/viewer.js — one page, large. For checking a page properly before saving.
//
// Shows the same overlays the thumbnail does, so what you see here is what the
// saved file will contain. Text added with "Add text on pages" can be moved
// right here by dragging it: fixing one page should not mean reopening the
// whole placing view. Buttons under the page for this were easy to miss.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge } from '../render.js'
import { addOverlays, makeTextMark } from './overlays.js'
import { fitStage } from './stage.js'
import { COLOURS, PAGE_NUMBER, anchorFractions, numberMark, resolveSpot } from '../textmarks.js'
import { FONTS, getFont, hasItalic } from '../fonts.js'

const VIEW_WIDTH = 620

const dialog = document.querySelector('#viewer-dialog')
const frame = document.querySelector('#viewer-frame')
const caption = document.querySelector('#viewer-caption')
const counter = document.querySelector('#viewer-counter')
const hint = document.querySelector('#viewer-text-hint')
const numberNote = document.querySelector('#viewer-number-note')
const watermarkNote = document.querySelector('#viewer-watermark-note')
const addMenu = document.querySelector('#viewer-add-menu')

// The watermark and redaction boxes are tapped rather than dragged: a
// watermark sits across the whole page, and a box is sized in the redaction
// view. They get the same small bar of choices as text.
const WATERMARK = 'watermark'
const REDACTION = 'redaction:'

let position = 0
let imageUrl = null
// Bumped on each render, so a slow render for a page you have already paged
// past does not overwrite the one you are now looking at.
let renderToken = 0
// The page currently drawn, and at what size.
let shown = null          // { pageId, rotation, scale, pointsWide, pointsHigh }
// Reopens text in the full editor. Passed in by main.js.
let onEditText = null
// Opens the same view for page numbers.
let onEditNumbers = null
// Opens the redaction view at a page. Passed in by main.js.
let onRedactPage = null
// Switches page numbering on and opens its placing view.
let onAddNumbers = null
// Opens the watermark's own panel.
let onWatermark = null
// Hands text typed here to the placing view, to put it on other pages too.
let onPlaceEverywhere = null
// The look text was last given, so a new piece starts where the last left off.
let seedLook = () => ({})

// Text being typed straight on the page: { x, y, text, look }.
let draft = null
// Where "Add text here" is being offered, after a tap on blank paper.
let addHere = null

const SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]

let selected = null       // the group of the text picked on this page
let lastMove = null       // { pageId, group, from } — what "Undo move" puts back
let press = null          // a pointer held down on a piece of text

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const currentPage = () => model.getPages()[position]

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

function actionButton(label, action, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.action = action
  button.className = className
  button.textContent = label
  return button
}

// What a piece of text on the page stands for, with its position worked out.
// Page numbers are not stored on the page, so theirs comes from the settings.
function markOn(page, group) {
  if (group !== PAGE_NUMBER) return page.stamps.find((m) => m.group === group) ?? null
  const numbering = model.getNumbering()
  const mark = numbering.enabled ? numberMark(numbering, page, '') : null
  return mark && shown ? resolveSpot(mark, shown.pointsWide, shown.pointsHigh) : null
}

// Dress the text on the page as movable: a dashed box, a tag saying what to
// do, and for the text picked, a small bar of what else can be done with it.
function decorateText(page) {
  const nodes = [...frame.querySelectorAll('.text-mark')]
  numberNote.hidden = !(model.getNumbering().enabled && page.numberHidden)
  const watermark = model.getWatermark()
  watermarkNote.hidden = !(watermark.enabled && watermark.text && page.watermarkHidden)

  for (const node of nodes) {
    const mark = markOn(page, node.dataset.group)
    if (!mark) continue
    const words = node.textContent
    const isNumber = mark.group === PAGE_NUMBER

    const picked = selected === mark.group
    const moved = lastMove?.pageId === page.id && lastMove.group === mark.group
    // Near the top there is no room above for the bar, so it goes below.
    const barBelow = mark.y < 0.2

    node.classList.add('movable')
    node.classList.toggle('sel', picked)
    node.classList.toggle('bar-below', picked && barBelow)
    node.classList.toggle('tag-above', picked ? barBelow : mark.y > 0.85)
    node.tabIndex = 0
    node.setAttribute('role', 'button')
    node.setAttribute('aria-label', `${words}. Drag to move it on this page, or press Enter for more.`)

    const tag = document.createElement('span')
    tag.className = moved ? 'mv-tag moved' : 'mv-tag'
    tag.textContent = moved ? '✓ Moved on this page only' : 'Drag to move'
    tag.setAttribute('aria-hidden', 'true')
    node.append(tag)

    keepInsidePage(tag)

    if (picked) {
      const bar = document.createElement('span')
      bar.className = 'mv-bar'
      bar.append(actionButton('Font, size and box…', 'style'))
      if (moved) bar.append(actionButton('Undo move', 'undo-move'))
      bar.append(actionButton(isNumber ? 'Hide number on this page' : 'Remove from this page', 'remove', 'danger'))
      node.append(bar)
      keepInsidePage(bar)
    }
  }

  decorateTappable(page)
  if (draft) paintDraft()
  else if (addHere) paintAddHere()
  hint.hidden = frame.querySelectorAll('.text-mark, .watermark-preview, .redact-mark').length === 0
}

// --- adding text by typing on the page ---------------------------------------

function defaultLook() {
  const seed = seedLook() ?? {}
  return {
    size: Number.isFinite(seed.size) ? seed.size : 14,
    font: getFont(seed.font).id,
    bold: seed.bold !== false,
    italic: Boolean(seed.italic) && hasItalic(getFont(seed.font).id),
    colour: COLOURS[seed.colour] ? seed.colour : 'black',
    box: ['none', 'outline', 'filled'].includes(seed.box) ? seed.box : 'none',
  }
}

// The text starts where you tapped and grows right and down from there, the
// way typing does.
function startDraft(point) {
  addHere = null
  selected = null
  draft = { x: clamp(point.x, 0.02, 0.94), y: clamp(point.y, 0.02, 0.94), text: '', look: defaultLook() }
  redrawOverlays()
}

function cancelDraft() {
  if (!draft) return
  draft = null
  redrawOverlays()
}

function commitDraft() {
  const page = currentPage()
  const text = draft?.text.trim()
  if (!page || !text) return cancelDraft()

  const mark = { text, x: draft.x, y: draft.y, anchor: 'top-left', ...draft.look }
  draft = null
  // The model change redraws the page through refreshViewer().
  model.addTextMarks([{ pageId: page.id, mark }])
}

function restyleDraft(patch) {
  Object.assign(draft.look, patch)
  if (!hasItalic(draft.look.font)) draft.look.italic = false
  redrawOverlays()
}

function paintAddHere() {
  const bar = document.createElement('div')
  bar.className = 'mv-bar add-here'
  bar.style.left = `${addHere.x * 100}%`
  bar.style.top = `${addHere.y * 100}%`
  bar.append(actionButton('Add text here', 'add-here'))
  frame.append(bar)
  keepInsidePage(bar)
}

function draftBar() {
  const bar = document.createElement('div')
  bar.className = 'mv-bar draft-bar'
  bar.style.left = `${draft.x * 100}%`

  const fonts = document.createElement('select')
  fonts.setAttribute('aria-label', 'Font')
  for (const font of FONTS) fonts.append(new Option(font.name, font.id))
  fonts.value = draft.look.font
  fonts.addEventListener('change', () => restyleDraft({ font: fonts.value }))

  const sizes = document.createElement('select')
  sizes.setAttribute('aria-label', 'Size')
  for (const size of SIZES) sizes.append(new Option(`${size} pt`, String(size)))
  sizes.value = String(draft.look.size)
  sizes.addEventListener('change', () => restyleDraft({ size: Number(sizes.value) }))

  const style = document.createElement('span')
  style.className = 'draft-group'
  for (const [label, key] of [['B', 'bold'], ['I', 'italic']]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = key === 'italic' ? 'italic' : ''
    button.textContent = label
    button.setAttribute('aria-label', key === 'bold' ? 'Bold' : 'Italic')
    button.setAttribute('aria-pressed', String(Boolean(draft.look[key])))
    button.disabled = key === 'italic' && !hasItalic(draft.look.font)
    button.addEventListener('click', () => restyleDraft({ [key]: !draft.look[key] }))
    style.append(button)
  }

  const colours = document.createElement('span')
  colours.className = 'draft-group draft-colours'
  for (const name of ['black', 'blue', 'red']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.colour = name
    button.style.setProperty('--swatch', COLOURS[name].css)
    button.setAttribute('aria-label', COLOURS[name].name)
    button.setAttribute('aria-pressed', String(draft.look.colour === name))
    button.addEventListener('click', () => restyleDraft({ colour: name }))
    colours.append(button)
  }

  const boxes = document.createElement('select')
  boxes.setAttribute('aria-label', 'Box around it')
  for (const [label, value] of [['No box', 'none'], ['Outline', 'outline'], ['Filled', 'filled']]) {
    boxes.append(new Option(label, value))
  }
  boxes.value = draft.look.box
  boxes.addEventListener('change', () => restyleDraft({ box: boxes.value }))

  const everywhere = actionButton('Other pages…', 'draft-everywhere')
  everywhere.addEventListener('click', () => {
    const text = draft.text.trim()
    const look = { ...draft.look }
    draft = null
    dialog.close()
    onPlaceEverywhere?.({ text, look })
  })

  const cancel = actionButton('Cancel', 'draft-cancel')
  cancel.addEventListener('click', cancelDraft)

  const add = actionButton('Add', 'draft-add', 'primary')
  add.addEventListener('click', commitDraft)

  bar.append(fonts, sizes, style, colours, boxes, everywhere, cancel, add)
  return bar
}

function paintDraft() {
  if (!shown) return

  const node = makeTextMark({ ...draft.look, text: draft.text, x: draft.x, y: draft.y, anchor: 'top-left' },
    shown.pointsWide, shown.pointsHigh)
  node.classList.add('draft')
  node.contentEditable = 'true'
  node.spellcheck = false
  node.setAttribute('aria-label', 'Type the text for this page')
  node.addEventListener('input', () => { draft.text = node.textContent })
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commitDraft() }
    else if (event.key === 'Escape') { event.preventDefault(); cancelDraft() }
  })

  frame.append(node)
  const bar = draftBar()
  frame.append(bar)
  putBarByTheText(node, bar)

  // Put the cursor at the end of whatever has been typed so far.
  node.focus({ preventScroll: true })
  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(false)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

// Just under the text being typed, measured from the text itself — or just
// above it when there is no room below. Anchoring it to the page instead put
// it on top of the words.
function putBarByTheText(node, bar) {
  // On a phone the bar is docked at the foot of the screen by the stylesheet,
  // so it must not be given a position here as well.
  if (window.matchMedia('(max-width: 700px)').matches) {
    bar.classList.remove('above', 'wrapped')
    bar.style.top = ''
    bar.style.left = ''
    return
  }

  const page = frame.getBoundingClientRect()
  const text = node.getBoundingClientRect()
  const room = dialog.getBoundingClientRect()
  const gap = 10
  const edge = 12

  // Wider than the window it sits in: let it wrap rather than run off the side.
  bar.classList.toggle('wrapped', bar.getBoundingClientRect().width > room.width - edge * 2)

  const box = bar.getBoundingClientRect()
  const below = text.bottom - page.top + gap
  const fits = below + box.height < page.height
  bar.style.top = `${((fits ? below : text.top - page.top - gap) / page.height) * 100}%`
  bar.classList.toggle('above', !fits)

  // Left edge measured in the page's own pixels, kept inside the dialog.
  const left = Math.min(
    Math.max(text.left, room.left + edge),
    room.right - edge - box.width,
  ) - page.left
  bar.style.left = `${left}px`
}

const closeAddMenu = () => {
  addMenu.hidden = true
  document.querySelector('#viewer-add').setAttribute('aria-expanded', 'false')
}

function decorateTappable() {
  const copies = [...frame.querySelectorAll('.watermark-preview')]
  for (const copy of copies) {
    copy.classList.add('tappable')
    copy.classList.toggle('sel', selected === WATERMARK)
  }
  if (selected === WATERMARK && copies.length > 0) {
    // A tiled watermark is nine copies, so its bar sits in the middle of the
    // page rather than on any one of them.
    const bar = document.createElement('span')
    bar.className = 'mv-bar floating'
    bar.dataset.group = WATERMARK
    bar.append(actionButton('Leave the watermark off this page', 'remove', 'danger'))
    frame.append(bar)
  }

  for (const box of frame.querySelectorAll('.redact-mark')) {
    const key = `${REDACTION}${box.dataset.index}`
    const picked = selected === key
    box.dataset.group = key
    box.classList.add('tappable')
    box.classList.toggle('sel', picked)
    box.classList.toggle('bar-below', picked && parseFloat(box.style.top) < 20)
    box.tabIndex = 0
    box.setAttribute('role', 'button')
    box.setAttribute('aria-label', 'Redaction box. Press Enter for choices.')

    if (picked) {
      const bar = document.createElement('span')
      bar.className = 'mv-bar'
      bar.append(actionButton('Remove this box', 'remove', 'danger'))
      bar.append(actionButton('Open the redaction view', 'redact'))
      box.append(bar)
      keepInsidePage(bar)
    }
  }
}

// The tag and the bar are centred on their text, so for text near the left
// or right edge they ran off the page and the dialog cut them short. Slide
// them back in; the bar's pointer stays over the text.
function keepInsidePage(element) {
  const page = frame.getBoundingClientRect()
  const box = element.getBoundingClientRect()
  const margin = 6
  const shift =
    box.left < page.left + margin ? page.left + margin - box.left
    : box.right > page.right - margin ? page.right - margin - box.right
    : 0
  if (shift === 0) return
  element.style.transform = `translateX(calc(-50% + ${shift}px))`
  element.style.setProperty('--pointer-shift', `${-shift}px`)
}

// Redraw what sits on the page without rendering the page again.
function redrawOverlays() {
  const page = currentPage()
  if (!page || shown?.pageId !== page.id) return

  for (const child of [...frame.children]) {
    if (child.tagName !== 'IMG') child.remove()
  }
  addOverlays(frame, page, position, { scale: shown.scale, pointsWide: shown.pointsWide, pointsHigh: shown.pointsHigh })
  decorateText(page)
}

async function show() {
  const pages = model.getPages()
  if (pages.length === 0) return dialog.close()

  position = Math.min(Math.max(position, 0), pages.length - 1)
  const page = pages[position]
  const source = model.getSource(page.sourceId)

  caption.textContent = `${source.name} — page ${page.pageIndex + 1}`
  counter.textContent = `${position + 1} of ${pages.length}`
  document.querySelector('#viewer-prev').disabled = position === 0
  document.querySelector('#viewer-next').disabled = position === pages.length - 1

  // Only what is drawn on the page changed — a moved piece of text, a new
  // box. Keep the page image, rather than flashing it blank after every drag.
  if (imageUrl && shown?.pageId === page.id && shown.rotation === page.rotation) {
    return redrawOverlays()
  }

  if (shown?.pageId !== page.id) {
    selected = null
    lastMove = null
    draft = null
    addHere = null
  }
  press = null
  shown = null
  hint.hidden = true

  const token = ++renderToken
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
  fitStage(frame, big.width, big.height)
  frame.replaceChildren(img)

  // Overlays are sized relative to the thumbnail, so scale them up to match.
  shown = {
    pageId: page.id,
    rotation: page.rotation,
    scale: big.width / 150,
    pointsWide: big.pointsWide,
    pointsHigh: big.pointsHigh,
  }
  addOverlays(frame, page, position, { scale: shown.scale, pointsWide: shown.pointsWide, pointsHigh: shown.pointsHigh })
  decorateText(page)
}

export async function openViewer(pageId) {
  const index = model.getPages().findIndex((p) => p.id === pageId)
  if (index === -1) return

  position = index
  if (!dialog.open) dialog.showModal()
  await show()
}

const currentPageId = () => model.getPages()[position]?.id

function pointerFraction(event) {
  const bounds = frame.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  }
}

function setUpMovingText() {
  frame.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.mv-bar')) return

    // A watermark or a redaction box: tapping picks it, or puts it down.
    const tapped = event.target.closest('.watermark-preview.tappable, .redact-mark.tappable')
    if (tapped) {
      const key = tapped.classList.contains('watermark-preview') ? WATERMARK : tapped.dataset.group
      selected = selected === key ? null : key
      redrawOverlays()
      event.preventDefault()
      return
    }

    const node = event.target.closest('.text-mark.movable')
    if (!node) {
      // Typing on the page: a tap elsewhere leaves it alone.
      if (draft) return

      // Tapping the page itself puts the picked text down.
      if (selected) {
        selected = null
        redrawOverlays()
        return
      }

      // Otherwise, offer to add text where the page was tapped.
      addHere = pointerFraction(event)
      redrawOverlays()
      return
    }

    const page = currentPage()
    const mark = page && markOn(page, node.dataset.group)
    if (!mark) return

    const point = pointerFraction(event)
    press = {
      node,
      pageId: page.id,
      group: mark.group,
      anchor: mark.anchor,
      // A page number's own spot may be none at all, meaning the shared one.
      from: mark.group === PAGE_NUMBER ? page.numberSpot ?? null : { x: mark.x, y: mark.y },
      x: mark.x,
      y: mark.y,
      // Keep the grab point under the finger rather than jumping a corner to it.
      dx: point.x - mark.x,
      dy: point.y - mark.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    frame.setPointerCapture(event.pointerId)
    event.preventDefault()
  })

  frame.addEventListener('pointermove', (event) => {
    if (!press) return
    // A few pixels of wobble is a tap, not a drag.
    if (!press.moved && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < 4) return
    press.moved = true
    press.node.classList.add('dragging')

    // Keep the whole box on the page.
    const bounds = frame.getBoundingClientRect()
    const box = press.node.getBoundingClientRect()
    const w = Math.min(1, box.width / bounds.width)
    const h = Math.min(1, box.height / bounds.height)
    const [ax, ay] = anchorFractions(press.anchor)
    const point = pointerFraction(event)

    press.x = clamp(point.x - press.dx, ax * w, 1 - (1 - ax) * w)
    press.y = clamp(point.y - press.dy, ay * h, 1 - (1 - ay) * h)
    press.node.style.left = `${press.x * 100}%`
    press.node.style.top = `${press.y * 100}%`
  })

  frame.addEventListener('pointerup', () => {
    if (!press) return
    const done = press
    press = null

    if (done.moved) {
      selected = done.group
      lastMove = { pageId: done.pageId, group: done.group, from: done.from }
      // The model change redraws the page through refreshViewer().
      if (done.group === PAGE_NUMBER) {
        model.setNumberSpot(done.pageId, { anchor: done.anchor, x: done.x, y: done.y })
      } else {
        model.moveTextMark(done.pageId, done.group, { x: done.x, y: done.y })
      }
    } else {
      selected = selected === done.group ? null : done.group
      redrawOverlays()
    }
  })

  frame.addEventListener('pointercancel', () => {
    if (!press) return
    press = null
    redrawOverlays()
  })

  frame.addEventListener('click', (event) => {
    const button = event.target.closest('.mv-bar button')
    if (!button) return

    // The bar for text being typed wires up its own buttons.
    if (button.closest('.draft-bar')) return

    if (button.dataset.action === 'add-here') {
      startDraft(addHere ?? { x: 0.2, y: 0.2 })
      return
    }
    const group = button.closest('[data-group]')?.dataset.group
    const pageId = currentPageId()
    if (!group || !pageId) return

    if (group === WATERMARK) {
      selected = null
      model.setWatermarkHidden(pageId, true)
      return
    }

    if (group.startsWith(REDACTION)) {
      if (button.dataset.action === 'redact') {
        dialog.close()
        onRedactPage?.(pageId)
      } else if (button.dataset.action === 'remove') {
        selected = null
        model.removeRedaction(pageId, Number(group.slice(REDACTION.length)))
      }
      return
    }

    const isNumber = group === PAGE_NUMBER

    if (button.dataset.action === 'style') {
      dialog.close()
      if (isNumber) onEditNumbers?.(pageId)
      else onEditText?.(group, pageId)
    } else if (button.dataset.action === 'undo-move' && lastMove) {
      const { from } = lastMove
      lastMove = null
      if (isNumber) model.setNumberSpot(pageId, from)
      else model.moveTextMark(pageId, group, from)
    } else if (button.dataset.action === 'remove') {
      selected = null
      if (lastMove?.group === group) lastMove = null
      if (isNumber) model.setNumberHidden(pageId, true)
      else model.removeTextMark(pageId, group)
    }
  })

  // Enter or Space picks the focused text, for anyone not using a mouse.
  frame.addEventListener('keydown', (event) => {
    const node = event.target.closest?.('.text-mark.movable, .redact-mark.tappable')
    if (!node || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    const group = node.dataset.group
    selected = selected === group ? null : group
    redrawOverlays()
    frame.querySelector(`[data-group="${CSS.escape(group)}"]`)?.focus()
  })
}

export function setupViewer(options = {}) {
  onRedactPage = options.onRedact ?? null
  onEditText = options.onEditText ?? null
  onEditNumbers = options.onEditNumbers ?? null
  onAddNumbers = options.onAddNumbers ?? null
  onWatermark = options.onWatermark ?? null
  onPlaceEverywhere = options.onPlaceEverywhere ?? null
  seedLook = options.look ?? seedLook

  document.querySelector('#viewer-watermark-show').addEventListener('click', () => {
    const id = currentPageId()
    if (id) model.setWatermarkHidden(id, false)
  })
  setUpMovingText()

  // A page number hidden on this page can be brought back from here.
  document.querySelector('#viewer-number-show').addEventListener('click', () => {
    const id = currentPageId()
    if (id) model.setNumberHidden(id, false)
  })

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

  document.querySelector('#viewer-add').addEventListener('click', (event) => {
    event.stopPropagation()
    const open = addMenu.hidden
    addMenu.hidden = !open
    document.querySelector('#viewer-add').setAttribute('aria-expanded', String(open))
  })

  addMenu.addEventListener('click', (event) => {
    const item = event.target.closest('button[data-add]')
    if (!item) return
    closeAddMenu()

    const id = currentPageId()
    if (item.dataset.add === 'text') {
      // Near the top left, where a reader starts: it can be dragged from there.
      startDraft({ x: 0.18, y: 0.16 })
    } else if (item.dataset.add === 'numbers') {
      dialog.close()
      onAddNumbers?.(id)
    } else if (item.dataset.add === 'watermark') {
      dialog.close()
      onWatermark?.()
    }
  })

  dialog.addEventListener('click', (event) => {
    if (!event.target.closest('.viewer-add')) closeAddMenu()
  })

  document.querySelector('#viewer-redact').addEventListener('click', () => {
    const id = currentPageId()
    dialog.close()
    onRedactPage?.(id)
  })

  // Arrow keys page through, which is the whole point of a viewer.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' && position > 0) { position--; show() }
    else if (event.key === 'ArrowRight' && position < model.getPages().length - 1) { position++; show() }
  })

  dialog.addEventListener('close', () => {
    releaseImage()
    closeAddMenu()
    shown = null
    selected = null
    lastMove = null
    press = null
    draft = null
    addHere = null
  })
}

// Redraw if the document changed underneath us (a rotation, moved text).
export function refreshViewer() {
  if (dialog.open) show()
}
