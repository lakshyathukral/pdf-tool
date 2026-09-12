// ---------------------------------------------------------------------------
// ui/addtext.js — "Add text on pages": the sidebar steps and the placing view.
//
// This replaced "Label pages". "Label" is not what anyone calls an annexure
// number or a Certified True Copy stamp; its preview was a black badge that
// looked nothing like what printed; and dragging it into place was hidden
// under "Advanced placement".
//
// The sidebar decides WHAT to write and WHICH pages. The placing view decides
// how it looks and exactly where, showing each page as it will print.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { renderLarge } from '../render.js'
import { addOverlays, makeTextMark } from './overlays.js'
import { COLOURS, NUMBER_STYLES, PAGE_NUMBER, anchorFractions, anchorPoint, countedPages, formatCounter, hasHindiLetters, lastPageNumber, numberedText, parseCounter, toHindiWords } from '../textmarks.js'
import { formatPageNumber } from '../export.js'
import { FONTS, DEFAULT_FONT, cssFamily, getFont, hasItalic, registerFontFaces } from '../fonts.js'

// Wide enough to stay sharp on a large screen at the size the page is shown.
const RENDER_WIDTH = 1000

const $ = (id) => document.querySelector(`#${id}`)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

// --- what has been chosen --------------------------------------------------

let auto = { word: 'Annexure', prefix: 'P-', style: '1', start: 1 }

// null until the user picks one. Until then the sensible choice follows what
// is loaded: pages clicked means those pages; several files means the first
// page of each, which is where an annexure number goes.
let pagesMode = null

let look = {
  anchor: 'top-right',
  x: null,          // worked out from the anchor once a page's size is known
  y: null,
  size: 14,
  font: DEFAULT_FONT,
  bold: true,
  italic: false,
  colour: 'black',
  box: 'none',
}

let remember = () => {}
// Opens the watermark's own panel. Passed in by main.js.
let onWatermark = () => {}

const numbering = () => $('label-auto').open

function effectiveMode() {
  if (pagesMode) return pagesMode
  if (model.selectionCount() > 0) return 'selected'
  return model.getSources().size > 1 ? 'first' : 'every'
}

// In document order, so after reordering it is the first page SHOWN from each
// file, not necessarily that file's page 1.
function firstPageOfEachFile() {
  const seen = new Set()
  return model.getPages().filter((page) => {
    if (seen.has(page.sourceId)) return false
    seen.add(page.sourceId)
    return true
  })
}

function pagesFor(mode) {
  if (mode === 'every') return model.getPages()
  if (mode === 'selected') return model.getSelectedPages()
  return firstPageOfEachFile()
}

// Every page the text will go on, with the words for that page.
function targets() {
  const typed = $('label-text').value.trim()
  return pagesFor(effectiveMode()).map((page, i) => ({
    page,
    text: numbering() ? numberedText(auto, auto.start + i) : typed,
  }))
}

function describePage(page) {
  const name = model.getSource(page.sourceId)?.name.replace(/\.pdf$/i, '') ?? ''
  return `${name}, page ${page.pageIndex + 1}`
}

// "Annexure P-1 to P-4", or simply the text when every page gets the same.
function summarise(list) {
  if (list.length === 0) return ''
  if (!numbering() || list.length === 1) return list[0].text
  const last = `${auto.prefix.trim()}${formatCounter(auto.start + list.length - 1, auto.style)}`
  return `${list[0].text} to ${last}`
}

// --- the sidebar -------------------------------------------------------------

function drawSequence(list) {
  const rows = list.slice(0, 5).map(({ page, text }) => {
    const li = document.createElement('li')
    const b = document.createElement('b')
    b.textContent = text
    const span = document.createElement('span')
    span.textContent = describePage(page)
    li.append(b, span)
    return li
  })

  if (list.length > 5) {
    const more = document.createElement('li')
    more.className = 'more'
    more.textContent = `…and ${list.length - 5} more, up to ${list.at(-1).text}`
    rows.push(more)
  }

  if (list.length === 0) {
    const none = document.createElement('li')
    none.className = 'more'
    none.textContent = 'No pages chosen yet. See step 2.'
    rows.push(none)
  }

  $('label-sequence').replaceChildren(...rows)
}

// "Annexure P-4" after "Annexure P-1" reads as just "P-4": the words both
// share at the start are dropped from the second.
function shortenAfter(first, last) {
  const a = first.split(' ')
  const b = last.split(' ')
  let same = 0
  while (same < a.length - 1 && same < b.length - 1 && a[same] === b[same]) same++
  return b.slice(same).join(' ')
}

function drawAdded() {
  const groups = model.getTextGroups()
  $('label-added').hidden = groups.length === 0

  $('label-added-list').replaceChildren(...groups.map((group) => {
    const first = group.texts[0]
    const last = group.texts.at(-1)

    const li = document.createElement('li')
    const words = document.createElement('div')
    const b = document.createElement('b')
    b.textContent = first === last ? first : `${first} to ${shortenAfter(first, last)}`
    b.title = b.textContent
    const span = document.createElement('span')
    span.textContent = `on ${plural(group.pages, 'page')}`
    words.append(b, span)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.dataset.group = group.group
    remove.textContent = '×'
    remove.title = 'Take this text off'
    remove.setAttribute('aria-label', `Remove ${b.textContent}`)

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'at-edit'
    edit.dataset.editGroup = group.group
    edit.textContent = 'Edit'
    edit.title = 'Move it, restyle it, or place it differently on one page'
    edit.setAttribute('aria-label', `Edit ${b.textContent}`)

    li.append(words, edit, remove)
    return li
  }))
}

export function drawTextPanel() {
  const mode = effectiveMode()
  const counts = {
    every: model.getPages().length,
    selected: model.selectionCount(),
    first: firstPageOfEachFile().length,
  }

  for (const input of document.querySelectorAll('input[name="label-pages"]')) {
    input.checked = input.value === mode
    input.closest('.at-radio').classList.toggle('on', input.checked)
  }
  $('label-count-every').textContent = plural(counts.every, 'page')
  $('label-count-selected').textContent = counts.selected ? plural(counts.selected, 'page') : 'none selected'
  $('label-count-first').textContent = plural(counts.first, 'page')

  // While numbering is on, the words come from there. Hiding the box rather
  // than greying it out avoids two places that both look like the text.
  const on = numbering()
  $('label-text').hidden = on
  $('label-auto-note').hidden = !on

  for (const button of $('label-style').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === auto.style))
  }

  const list = targets()
  if (on) drawSequence(list)

  const missingText = !on && $('label-text').value.trim() === ''
  $('label-place').disabled = missingText || list.length === 0
  $('label-hint').textContent =
    counts.every === 0 ? ''
    : missingText ? 'Type what to write first, or tap one of the suggestions.'
    : list.length === 0 ? 'Click the pages to put it on, or choose Every page.'
    : `Goes on ${plural(list.length, 'page')}.`

  drawAdded()
}

// --- the placing view --------------------------------------------------------

const dialog = $('text-dialog')
const stage = $('text-stage')

// list: every page with its words. When "Set each page separately" is chosen,
// spots holds the positions moved on one page only, by index into list.
// editing is the group being changed, or null when adding new text.
let placing = null        // { list, index, pointsWide, pointsHigh, each, spots, editing }
let renderToken = 0
// The look in use before an edit began. Editing old text borrows its look, and
// must not quietly become the style for the next thing added.
let lookBeforeEdit = null
let imageUrl = null
let drag = null

function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

const currentMark = () => stage.querySelector('.td-mark')

const rememberLook = () => { if (!placing?.editing) remember() }

// Where the text goes on one page: its own spot if it was moved on its own,
// otherwise the spot every page shares.
function spotFor(index) {
  const own = placing?.each ? placing.spots.get(index) : null
  return own ?? { anchor: look.anchor, x: look.x, y: look.y }
}

const currentSpot = () => spotFor(placing.index)

// Move the text on the page being shown: on this page alone when placing each
// page separately, on every page otherwise.
function setSpot(patch) {
  if (placing.each) placing.spots.set(placing.index, { ...currentSpot(), ...patch })
  else Object.assign(look, patch)
}

function markFor(text, spot) {
  return {
    text,
    x: spot.x,
    y: spot.y,
    anchor: spot.anchor,
    size: look.size,
    font: look.font,
    bold: look.bold,
    italic: look.italic && hasItalic(look.font),
    colour: look.colour,
    box: look.box,
  }
}

function paintMark() {
  currentMark()?.remove()
  if (!placing?.pointsWide) return

  const { text } = placing.list[placing.index]
  const spot = currentSpot()
  const node = makeTextMark(markFor(text, spot), placing.pointsWide)
  node.classList.add('td-mark')
  node.classList.toggle('grip-above', spot.y > 0.9)
  node.tabIndex = 0
  node.setAttribute('aria-label', `${text}. Drag to move, or use the arrow keys.`)

  const grip = document.createElement('span')
  grip.className = 'td-grip'
  grip.textContent = 'Drag to move'
  grip.setAttribute('aria-hidden', 'true')
  node.append(grip)

  stage.append(node)
}

// A grid spot shows as chosen only while the text is still exactly there.
function sitsOnGrid(spot) {
  if (!placing?.pointsWide) return false
  const point = anchorPoint(spot.anchor, placing.pointsWide, placing.pointsHigh)
  return Math.abs(point.x - spot.x) < 1e-4 && Math.abs(point.y - spot.y) < 1e-4
}

// Everything already on this page, faded, so nothing new is put on top of it:
// the page number while adding text, added text while placing numbers, the
// watermark. Tapping one offers to edit it instead (see showOtherBar).
function drawContext(page) {
  stage.querySelector('.td-context')?.remove()
  const context = document.createElement('div')
  context.className = 'td-context'
  stage.append(context)

  addOverlays(context, page, model.getPages().indexOf(page), {
    pointsWide: placing.pointsWide,
    pointsHigh: placing.pointsHigh,
  })

  // What is being edited is drawn live on top, not faded underneath.
  if (placing.editing) {
    for (const node of context.querySelectorAll(`[data-group="${CSS.escape(placing.editing)}"]`)) node.remove()
  }
  for (const node of context.querySelectorAll('.text-mark, .watermark-preview')) {
    node.classList.add('td-other')
    node.title = 'Already on the page. Tap to edit it.'
  }
}

const hideOtherBar = () => stage.querySelector('.td-other-bar')?.remove()

function showOtherBar(node) {
  hideOtherBar()
  const pageId = placing.list[placing.index].page.id
  const target = node.classList.contains('watermark-preview') ? { kind: 'watermark' }
    : node.dataset.group === PAGE_NUMBER ? { kind: 'numbers', pageId }
    : { kind: 'text', group: node.dataset.group, pageId }

  const first = placing.editing === PAGE_NUMBER ? 'Save page numbers'
    : placing.editing ? 'Save changes'
    : 'Add this text'
  const then = target.kind === 'watermark' ? 'change the watermark'
    : target.kind === 'numbers' ? 'edit the page number'
    : `edit “${node.textContent}”`

  const bar = document.createElement('div')
  bar.className = 'mv-bar td-other-bar'
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.target = JSON.stringify(target)
  button.textContent = `${first}, then ${then}`
  bar.append(button)

  const stageBox = stage.getBoundingClientRect()
  const box = node.getBoundingClientRect()
  const across = ((box.left + box.width / 2 - stageBox.left) / stageBox.width) * 100
  const down = ((box.top - stageBox.top) / stageBox.height) * 100
  bar.style.left = `${Math.min(80, Math.max(20, across))}%`
  bar.style.top = `${Math.max(10, down)}%`
  stage.append(bar)
}

// Keep what was placed here, then open the thing that was tapped. Opening waits
// for this view to finish closing, or its closing would wipe the new one.
function switchTo(target) {
  if (!commit()) return
  dialog.addEventListener('close', () => {
    if (target.kind === 'numbers') openNumberPlacer(target.pageId)
    else if (target.kind === 'text') openTextEditor(target.group, target.pageId)
    else onWatermark()
  }, { once: true })
  dialog.close()
}

function drawControls() {
  const spot = placing ? currentSpot() : look

  // A font cannot translate. Choosing Hindi for English words says so, and
  // offers the Hindi for the words the site suggests.
  const englishInHindi = Boolean(placing) && placing.editing !== PAGE_NUMBER && look.font === 'hindi'
    && placing.list.every(({ text }) => !hasHindiLetters(text))
  const translatable = englishInHindi && placing.list.every(({ text }) => toHindiWords(text))
  $('text-hindi-tip').hidden = !englishInHindi
  $('text-hindi-words').hidden = !translatable
  $('text-hindi-tip').querySelector('span').textContent = translatable
    ? 'Hindi letters show when the words are in Hindi.'
    : 'Hindi letters show when the words are in Hindi. Type them in Hindi in step 1.'
  const gridded = sitsOnGrid(spot)
  for (const button of $('text-grid').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(gridded && button.dataset.anchor === spot.anchor))
  }

  const several = Boolean(placing) && placing.list.length > 1
  const each = several && placing.each
  $('text-scope-block').hidden = !several
  for (const button of $('text-scope').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String((button.dataset.scope === 'each') === each))
  }
  $('text-scope-tip').hidden = !each
  $('text-scope-tip').textContent = 'Move the text on this page, then press › for the next. Pages you do not move keep the usual spot.'

  $('text-size').value = look.size
  $('text-size-out').textContent = `${look.size} pt`

  for (const button of $('text-fonts').querySelectorAll('button')) {
    const on = button.dataset.font === look.font
    button.setAttribute('aria-pressed', String(on))
    button.querySelector('b').style.fontWeight = look.bold ? '700' : '400'
  }

  $('text-bold').setAttribute('aria-pressed', String(look.bold))
  $('text-italic').disabled = !hasItalic(look.font)
  $('text-italic').setAttribute('aria-pressed', String(look.italic && hasItalic(look.font)))

  for (const button of $('text-colours').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.colour === look.colour))
  }
  for (const button of $('text-box').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.box === look.box))
  }
}

function drawFontTiles() {
  const sample = placing.list[0]?.text || 'Annexure P-1'
  $('text-fonts').replaceChildren(...FONTS.map((font) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'td-font'
    button.dataset.font = font.id

    const b = document.createElement('b')
    b.textContent = font.sample ?? sample
    b.style.fontFamily = cssFamily(font.id)
    const small = document.createElement('small')
    small.textContent = font.name

    button.append(b, small)
    return button
  }))
}

function drawPager() {
  const { list, index, each, spots } = placing
  const { page, text } = list[index]

  $('text-pager').hidden = false
  $('text-prev').disabled = index === 0
  $('text-next').disabled = index === list.length - 1
  $('text-prev').hidden = list.length === 1
  $('text-next').hidden = list.length === 1

  const b = document.createElement('b')
  b.textContent = text
  const small = document.createElement('small')
  small.textContent = list.length === 1
    ? ` · ${describePage(page)}`
    : ` · ${describePage(page)} · ${index + 1} of ${list.length}`
  const own = document.createElement('span')
  own.className = 'td-own'
  own.textContent = 'Own spot'
  own.hidden = !(each && spots.has(index))
  $('text-pager-label').replaceChildren(b, small, own)

  const n = list.length
  const moved = each ? spots.size : 0
  const editing = Boolean(placing.editing)
  const first = list[0].text
  const last = list.at(-1).text

  const numbers = placing.editing === PAGE_NUMBER
  $('text-title').textContent = numbers ? 'Place your page numbers' : editing ? 'Edit your text' : 'Place your text'

  const summary = document.createElement('b')
  // Page numbers read in full ("Page 1 of 4 to Page 4 of 4"): cutting the
  // shared start off the second one left "4 of 4", which reads oddly.
  summary.textContent =
    numbers ? (first === last ? first : `${first} to ${last}`)
    : editing ? (first === last ? first : `${first} to ${shortenAfter(first, last)}`)
    : summarise(list)
  $('text-summary').replaceChildren(
    numbers ? '' : editing ? 'Editing ' : 'Adds ', summary,
    !editing && effectiveMode() === 'first' && n > 1 ? ', on the first page of each file' : ` on ${plural(n, 'page')}`,
    moved > 0 ? `, ${moved} placed on their own` : '',
  )
  $('text-apply').textContent =
    editing ? 'Save changes'
    : n === 1 ? 'Add to this page'
    : `Add to ${plural(n, 'page')}`
}

async function showPage() {
  const { page } = placing.list[placing.index]
  const token = ++renderToken

  drawPager()
  currentMark()?.remove()
  stage.classList.add('loading')

  const big = await renderLarge(page.sourceId, page.pageIndex, page.rotation, RENDER_WIDTH)

  // Paged on, or closed, while this was rendering.
  if (!placing || token !== renderToken) return URL.revokeObjectURL(big.url)

  releaseImage()
  imageUrl = big.url
  placing.pointsWide = big.pointsWide
  placing.pointsHigh = big.pointsHigh

  if (look.x === null || look.y === null) {
    Object.assign(look, anchorPoint(look.anchor, big.pointsWide, big.pointsHigh))
  }

  const img = document.createElement('img')
  img.src = big.url
  img.alt = ''
  img.draggable = false

  stage.style.setProperty('--ratio', (big.width / big.height).toFixed(4))
  stage.replaceChildren(img)
  drawContext(page)
  stage.classList.remove('loading')
  paintMark()
  drawControls()
}

async function openPlacer() {
  const list = targets()
  if (list.length === 0) return

  registerFontFaces()
  placing = { list, index: 0, pointsWide: 0, pointsHigh: 0, each: false, spots: new Map(), editing: null }
  drawFontTiles()
  drawControls()
  stage.replaceChildren()
  dialog.showModal()
  await showPage()
}

// Reopen text already added, on the page asked for, exactly as it was left:
// its look, its spot, and any page that was placed on its own. Saving puts it
// back as one change; nothing about it is locked once added.
export async function openTextEditor(group, pageId) {
  const entries = model.getTextGroupMarks(group)
  if (entries.length === 0) return

  const first = entries[0].mark
  lookBeforeEdit = { ...look }
  look = {
    ...look,
    anchor: first.anchor,
    x: first.x,
    y: first.y,
    size: first.size,
    font: getFont(first.font).id,
    bold: Boolean(first.bold),
    italic: Boolean(first.italic),
    colour: COLOURS[first.colour] ? first.colour : 'black',
    box: first.box ?? 'none',
  }

  // Pages whose text is not where the first page's is were placed on their own.
  const spots = new Map()
  entries.forEach(({ mark }, i) => {
    if (mark.anchor !== first.anchor || mark.x !== first.x || mark.y !== first.y) {
      spots.set(i, { anchor: mark.anchor, x: mark.x, y: mark.y })
    }
  })

  registerFontFaces()
  placing = {
    list: entries.map(({ page, mark }) => ({ page, text: mark.text })),
    index: Math.max(0, entries.findIndex((entry) => entry.page.id === pageId)),
    pointsWide: 0,
    pointsHigh: 0,
    each: spots.size > 0,
    spots,
    editing: group,
  }
  drawFontTiles()
  drawControls()
  stage.replaceChildren()
  dialog.showModal()
  await showPage()
}

// Save what the view holds: new text, edited text, or page numbers.
function commit() {
  if (!placing?.pointsWide) return false
  const entries = placing.list.map(({ page, text }, i) => ({
    pageId: page.id,
    mark: markFor(text, spotFor(i)),
  }))
  if (placing.editing === PAGE_NUMBER) saveNumbers()
  else if (placing.editing) model.replaceTextGroup(placing.editing, entries)
  else model.addTextMarks(entries, { bookmark: $('label-bookmark').checked })
  return true
}

// Page numbers use this same view: the fonts, the grid, dragging, and a
// different spot on single pages. Their words come from the numbering
// settings, and a page whose number is hidden is left out.
export async function openNumberPlacer(pageId) {
  const numbering = model.getNumbering()
  const pages = model.getPages()
  if (!numbering.enabled || pages.length === 0) return

  const total = lastPageNumber(numbering, pages)
  const list = pages
    .map((page, i) => ({
      page,
      text: formatPageNumber(numbering, numbering.start + countedPages(numbering, pages.slice(0, i)), total),
    }))
    .filter(({ page }) => !page.numberHidden)
  if (list.length === 0) return

  lookBeforeEdit = { ...look }
  look = {
    ...look,
    anchor: numbering.anchor ?? 'bottom-right',
    x: Number.isFinite(numbering.x) ? numbering.x : null,
    y: Number.isFinite(numbering.y) ? numbering.y : null,
    size: numbering.size,
    font: getFont(numbering.font).id,
    bold: Boolean(numbering.bold),
    italic: Boolean(numbering.italic),
    colour: COLOURS[numbering.colour] ? numbering.colour : 'black',
    box: numbering.box ?? 'none',
  }

  const spots = new Map()
  list.forEach(({ page }, i) => {
    if (page.numberSpot) spots.set(i, { ...page.numberSpot })
  })

  registerFontFaces()
  placing = {
    list,
    index: Math.max(0, list.findIndex((entry) => entry.page.id === pageId)),
    pointsWide: 0,
    pointsHigh: 0,
    each: spots.size > 0,
    spots,
    editing: PAGE_NUMBER,
    // Rewrites each page's words for another font, since the Hindi font
    // writes them in Hindi.
    retext: (font) => {
      const withFont = { ...model.getNumbering(), font }
      const all = model.getPages()
      const last = lastPageNumber(withFont, all)
      for (const entry of list) {
        const before = all.slice(0, all.indexOf(entry.page))
        entry.text = formatPageNumber(withFont, withFont.start + countedPages(withFont, before), last)
      }
    },
  }
  drawFontTiles()
  drawControls()
  stage.replaceChildren()
  dialog.showModal()
  await showPage()
}

function saveNumbers() {
  // Left on a grid spot, the number keeps no fixed x and y, so it stays half
  // an inch in on pages of every size rather than copying this page's.
  const shared = { anchor: look.anchor, x: look.x, y: look.y }
  const onGridSpot = sitsOnGrid(shared)

  model.setNumbering({
    anchor: look.anchor,
    x: onGridSpot ? null : look.x,
    y: onGridSpot ? null : look.y,
    size: look.size,
    font: look.font,
    bold: look.bold,
    italic: look.italic && hasItalic(look.font),
    colour: look.colour,
    box: look.box,
  })
  model.setNumberSpots(placing.list.map(({ page }, i) => ({
    pageId: page.id,
    spot: placing.each ? placing.spots.get(i) ?? null : null,
  })))

  // Put the text look back BEFORE remembering settings. Remembering first
  // saved the page numbers' look as the look for the next text added, so an
  // annexure number landed on top of the page number.
  if (lookBeforeEdit) {
    look = lookBeforeEdit
    lookBeforeEdit = null
  }
  remember()
}

// Move the text's anchor point, keeping the whole box on the page.
function moveTo(x, y) {
  const node = currentMark()
  if (!node) return

  const bounds = stage.getBoundingClientRect()
  const box = node.getBoundingClientRect()
  const w = Math.min(1, box.width / bounds.width)
  const h = Math.min(1, box.height / bounds.height)
  const [ax, ay] = anchorFractions(currentSpot().anchor)

  const next = {
    x: clamp(x, ax * w, 1 - (1 - ax) * w),
    y: clamp(y, ay * h, 1 - (1 - ay) * h),
  }
  setSpot(next)

  node.style.left = `${next.x * 100}%`
  node.style.top = `${next.y * 100}%`
  node.classList.toggle('grip-above', next.y > 0.9)
  drawControls()
}

function pointerFraction(event) {
  const bounds = stage.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  }
}

function setUpStage() {
  stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.td-other-bar')) return
    hideOtherBar()
    const other = event.target.closest('.td-other')
    if (other) {
      showOtherBar(other)
      event.preventDefault()
      return
    }

    const node = currentMark()
    if (!node) return
    const point = pointerFraction(event)

    if (!node.contains(event.target)) {
      // Tapping the page brings the middle of the text to that spot.
      const bounds = stage.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      const [ax, ay] = anchorFractions(currentSpot().anchor)
      moveTo(
        point.x + (ax - 0.5) * (box.width / bounds.width),
        point.y + (ay - 0.5) * (box.height / bounds.height),
      )
    }

    // Keep the grab point under the finger rather than jumping a corner to it.
    const spot = currentSpot()
    drag = { dx: point.x - spot.x, dy: point.y - spot.y }
    stage.setPointerCapture(event.pointerId)
    node.focus({ preventScroll: true })
    event.preventDefault()
  })

  stage.addEventListener('pointermove', (event) => {
    if (!drag) return
    const point = pointerFraction(event)
    moveTo(point.x - drag.dx, point.y - drag.dy)
  })

  const endDrag = () => {
    if (!drag) return
    drag = null
    drawPager()
    rememberLook()
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  stage.addEventListener('click', (event) => {
    const button = event.target.closest('.td-other-bar button')
    if (button) switchTo(JSON.parse(button.dataset.target))
  })

  // Arrow keys nudge the text, for anyone not using a mouse.
  stage.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.02 : 0.004
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[event.key]
    if (!move || !currentMark()) return
    event.preventDefault()
    const spot = currentSpot()
    moveTo(spot.x + move[0], spot.y + move[1])
    drawPager()
    rememberLook()
  })
}

// A change to how the text looks: redraw it and remember the choice. The look
// is always shared by every page; only the position can differ.
function restyle(patch) {
  Object.assign(look, patch)
  if (!hasItalic(look.font)) look.italic = false
  // Page number words follow the font: "Page 1 of 7" becomes "पृष्ठ 1 / 7".
  if (patch.font && placing?.retext) {
    placing.retext(look.font)
    drawPager()
  }
  paintMark()
  drawControls()
  rememberLook()
}

function setUpDialog() {
  setUpStage()

  $('text-prev').addEventListener('click', () => {
    if (placing.index > 0) { placing.index--; showPage() }
  })
  $('text-next').addEventListener('click', () => {
    if (placing.index < placing.list.length - 1) { placing.index++; showPage() }
  })

  $('text-scope').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-scope]')
    if (!button || !placing) return
    placing.each = button.dataset.scope === 'each'
    // Back to one spot for all: the separate spots go, as the button says.
    if (!placing.each) placing.spots.clear()
    paintMark()
    drawControls()
    drawPager()
  })

  $('text-grid').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-anchor]')
    if (!button || !placing?.pointsWide) return
    const anchor = button.dataset.anchor
    setSpot({ anchor, ...anchorPoint(anchor, placing.pointsWide, placing.pointsHigh) })
    paintMark()
    drawControls()
    drawPager()
    rememberLook()
  })

  $('text-hindi-words').addEventListener('click', () => {
    if (!placing) return
    // New text: change the words where they come from, so the sidebar agrees.
    if (!placing.editing) {
      if (numbering()) {
        auto = { ...auto, word: toHindiWords(auto.word) ?? auto.word, prefix: toHindiWords(auto.prefix) ?? auto.prefix }
        fillAuto()
      } else {
        $('label-text').value = toHindiWords($('label-text').value) ?? $('label-text').value
      }
      drawTextPanel()
      remember()
    }
    for (const entry of placing.list) entry.text = toHindiWords(entry.text) ?? entry.text
    drawPager()
    paintMark()
    drawControls()
  })

  $('text-size').addEventListener('input', () => restyle({ size: Number($('text-size').value) }))

  $('text-fonts').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-font]')
    if (button) restyle({ font: getFont(button.dataset.font).id })
  })

  $('text-bold').addEventListener('click', () => restyle({ bold: !look.bold }))
  $('text-italic').addEventListener('click', () => restyle({ italic: !look.italic }))

  $('text-colours').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-colour]')
    if (button) restyle({ colour: button.dataset.colour })
  })

  $('text-box').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-box]')
    if (button) restyle({ box: button.dataset.box })
  })

  $('text-apply').addEventListener('click', () => {
    if (commit()) dialog.close()
  })

  for (const id of ['text-cancel', 'text-close']) {
    $(id).addEventListener('click', () => dialog.close())
  }

  dialog.addEventListener('close', () => {
    if (lookBeforeEdit) {
      look = lookBeforeEdit
      lookBeforeEdit = null
    }
    placing = null
    drag = null
    releaseImage()
    stage.replaceChildren()
  })
}

// --- wiring ------------------------------------------------------------------

function readAuto() {
  // Read in the chosen style, so lettered numbering can start at "C".
  const start = parseCounter($('label-start').value, auto.style)
  $('label-start').setAttribute('aria-invalid', String(start === null))
  auto = {
    ...auto,
    word: $('label-word').value,
    prefix: $('label-prefix').value,
    start: start ?? auto.start,
  }
}

// "Start at" shows the first number the way it will be written: A, I or 1.
function showStart() {
  $('label-start').value = formatCounter(auto.start, auto.style)
  $('label-start').inputMode = auto.style === '1' ? 'numeric' : 'text'
  $('label-start').setAttribute('aria-invalid', 'false')
}

function fillAuto() {
  $('label-word').value = auto.word
  $('label-prefix').value = auto.prefix
  showStart()
}

export function setupTextTool(options = {}) {
  remember = options.remember ?? remember
  onWatermark = options.onWatermark ?? onWatermark

  const changed = () => { drawTextPanel(); remember() }

  $('label-text').addEventListener('input', changed)
  $('label-bookmark').addEventListener('change', changed)

  // The suggestions fill in the form; nothing goes on a page until placed.
  $('label-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('.at-chip')
    if (!chip) return

    if (chip.dataset.text) {
      $('label-text').value = chip.dataset.text
      $('label-auto').open = false
    } else {
      auto = { ...auto, word: chip.dataset.word, prefix: chip.dataset.prefix, style: chip.dataset.style, start: 1 }
      fillAuto()
      $('label-auto').open = true
    }
    changed()
  })

  $('label-auto').addEventListener('toggle', changed)

  for (const id of ['label-word', 'label-prefix', 'label-start']) {
    $(id).addEventListener('input', () => { readAuto(); changed() })
  }

  $('label-style').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]')
    if (!button) return
    auto.style = button.dataset.value
    showStart()
    changed()
  })

  $('label-pages').addEventListener('change', (event) => {
    if (event.target.name !== 'label-pages') return
    pagesMode = event.target.value
    drawTextPanel()
  })

  $('label-place').addEventListener('click', openPlacer)

  $('label-added-list').addEventListener('click', (event) => {
    const edit = event.target.closest('button[data-edit-group]')
    if (edit) return openTextEditor(edit.dataset.editGroup)
    const button = event.target.closest('button[data-group]')
    if (button) model.removeTextGroup(button.dataset.group)
  })

  setUpDialog()
  drawTextPanel()
}

// --- the page viewer hands work over to this tool -----------------------------

// The look text was last given, so text typed on a page starts from it.
export const textLook = () => ({ ...look })

// Text typed on one page, to be put on other pages too: it becomes step 1, and
// the placing view opens with the look it already had.
export async function startPlacing({ text, look: incoming }) {
  if (text) $('label-text').value = text
  $('label-auto').open = false
  if (incoming) look = { ...look, ...incoming, x: null, y: null }

  // "Other pages…" means the whole document. Without this it would follow
  // whatever was selected — which, coming from the page viewer, is the single
  // page just been looked at, the one page it is NOT meant to mean.
  pagesMode = 'every'

  drawTextPanel()
  remember()
  await openPlacer()
}

// --- presets and "remember what I used" --------------------------------------

export function getTextSettings() {
  return {
    text: $('label-text').value,
    numbered: numbering(),
    bookmark: $('label-bookmark').checked,
    auto: { ...auto },
    look: { ...look },
  }
}

export function applyTextSettings(settings) {
  if (!settings) return

  $('label-text').value = settings.text ?? ''
  $('label-bookmark').checked = Boolean(settings.bookmark)

  if (settings.auto) {
    const saved = settings.auto
    auto = {
      word: typeof saved.word === 'string' ? saved.word : auto.word,
      prefix: typeof saved.prefix === 'string' ? saved.prefix : auto.prefix,
      style: NUMBER_STYLES.includes(saved.style) ? saved.style : '1',
      start: Number.isInteger(saved.start) && saved.start >= 1 ? saved.start : 1,
    }
    fillAuto()
  }
  $('label-auto').open = Boolean(settings.numbered)

  // Settings saved before this tool existed have none of these, and anything
  // out of range is ignored rather than trusted.
  const saved = settings.look
  if (saved) {
    look = {
      ...look,
      anchor: typeof saved.anchor === 'string' && saved.anchor.includes('-') ? saved.anchor : look.anchor,
      x: Number.isFinite(saved.x) ? clamp(saved.x, 0, 1) : null,
      y: Number.isFinite(saved.y) ? clamp(saved.y, 0, 1) : null,
      size: Number.isFinite(saved.size) ? clamp(Math.round(saved.size), 6, 72) : look.size,
      font: getFont(saved.font).id,
      bold: typeof saved.bold === 'boolean' ? saved.bold : look.bold,
      italic: Boolean(saved.italic),
      colour: COLOURS[saved.colour] ? saved.colour : 'black',
      box: ['none', 'outline', 'filled'].includes(saved.box) ? saved.box : 'none',
    }
  }

  drawTextPanel()
}
