// ---------------------------------------------------------------------------
// model.js — the truth about the document.
//
// Rule for this file: it never touches the DOM, and never imports pdf.js or
// pdf-lib. It is plain data plus the functions that change that data. Anything
// that wants to know when something changed calls subscribe().
// ---------------------------------------------------------------------------

// sourceId -> { id, name, bytes, color, pageCount }
let sources = new Map()

// The document, in order. Each entry describes ONE page of the output:
//   { id, sourceId, pageIndex, rotation, stamps: [], redactions: [] }
// pageIndex counts from 0 (pdf-lib's convention, which is where it ends up).
// redactions are rectangles in 0..1 coordinates of the page AS DISPLAYED,
// measured from the top-left corner.
let pages = []

// Page ids the user has selected. Not part of undo history.
let selection = new Set()

// Document-level settings. These are applied at export time rather than baked
// into pages, because they depend on final order (numbering) or on the whole
// document (watermark).
let numbering = {
  enabled: false,
  style: 'bates',      // bates | plain | page | page-of | dashes
  prefix: '',
  start: 1,
  padding: 4,
  position: 'bottom-right',
  size: 10,
}

let watermark = {
  enabled: false,
  text: 'DRAFT',
  size: 60,
  opacity: 0.15,
  angle: 45,
  tiled: false,
}

// Flattening re-renders every page to an image at save time, so no text can be
// selected or edited afterwards. Costs searchability and file size.
let flatten = { enabled: false, dpi: 150 }

// What the saved file should be called. Empty means "work one out for me".
let outputName = ''

// Written into the saved file. Copying pages does NOT carry the source's
// Title/Author/Subject/Keywords across — those are dropped automatically — so
// these are values you choose to ADD, not ones you are stripping.
let metadata = { title: '', author: '' }

let nextPageId = 1
let nextSourceId = 1

const SOURCE_COLORS = ['#0a66c2', '#b54708', '#087443', '#7c3aed', '#be123c', '#0e7490']

// --- change notification ---------------------------------------------------

const listeners = new Set()

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) fn()
}

// --- undo / redo -----------------------------------------------------------

// We snapshot pages only. Sources are append-only and hold megabytes of file
// data; document settings are settings, not edits.
let past = []
let future = []

function cloneState() {
  return {
    pages: pages.map((p) => ({
      ...p,
      stamps: p.stamps.map((s) => ({ ...s })),
      redactions: p.redactions.map((r) => ({ ...r })),
    })),
    // A shallow copy: the entries are copied, the file bytes inside them are
    // shared references, so this stays cheap however large the PDFs are.
    sources: new Map(sources),
  }
}

// Call this at the start of every function that changes the document.
function beginChange() {
  past.push(cloneState())
  if (past.length > 100) past.shift()
  future.length = 0
}

function restore(state) {
  pages = state.pages
  sources = state.sources
  // Drop any selected ids that no longer exist.
  const alive = new Set(pages.map((p) => p.id))
  selection = new Set([...selection].filter((id) => alive.has(id)))
}

export function undo() {
  if (past.length === 0) return
  future.push(cloneState())
  restore(past.pop())
  notify()
}

export function redo() {
  if (future.length === 0) return
  past.push(cloneState())
  restore(future.pop())
  notify()
}

export const canUndo = () => past.length > 0
export const canRedo = () => future.length > 0

// --- reading ---------------------------------------------------------------

export const getPages = () => pages
export const getSources = () => sources
export const getSource = (id) => sources.get(id)
export const getNumbering = () => numbering
export const getWatermark = () => watermark
export const getOutputName = () => outputName
export const getMetadata = () => metadata
export const getFlatten = () => flatten
export const isSelected = (pageId) => selection.has(pageId)
export const getSelectedIds = () => [...selection]
export const getSelectedPages = () => pages.filter((p) => selection.has(p.id))
export const selectionCount = () => selection.size
export const isEmpty = () => pages.length === 0
export const getPage = (pageId) => pages.find((p) => p.id === pageId)

// How many of a file's pages are still in the document. Deleting or
// duplicating means this need not match the file's own page count.
export const pagesFromSource = (sourceId) => pages.filter((p) => p.sourceId === sourceId).length

// --- sources ---------------------------------------------------------------

// Hand out a source id before the file is opened, so render.js can cache
// thumbnails under the same id the model will use.
export function reserveSourceId() {
  return `s${nextSourceId++}`
}

export function addSource(id, name, bytes, pageCount) {
  beginChange()

  sources.set(id, {
    id,
    name,
    bytes,
    pageCount,
    color: SOURCE_COLORS[sources.size % SOURCE_COLORS.length],
  })

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    pages.push({
      id: `p${nextPageId++}`,
      sourceId: id,
      pageIndex,
      rotation: 0,
      stamps: [],
      redactions: [],
    })
  }

  notify()
  return id
}

// Remove a file and every page that came from it. Undoable, because the undo
// snapshot covers sources as well as pages.
export function removeSource(sourceId) {
  if (!sources.has(sourceId)) return
  beginChange()

  sources.delete(sourceId)
  pages = pages.filter((p) => p.sourceId !== sourceId)

  const alive = new Set(pages.map((p) => p.id))
  selection = new Set([...selection].filter((id) => alive.has(id)))
  notify()
}

// Put every file's pages back together, each file's pages in their original
// order. Useful after a merge has been shuffled about.
export function groupBySource() {
  beginChange()

  const order = [...sources.keys()]
  pages = [...pages].sort((a, b) => {
    const bySource = order.indexOf(a.sourceId) - order.indexOf(b.sourceId)
    return bySource !== 0 ? bySource : a.pageIndex - b.pageIndex
  })
  notify()
}

// --- selection (not undoable) ----------------------------------------------

export function toggleSelection(pageId) {
  if (selection.has(pageId)) selection.delete(pageId)
  else selection.add(pageId)
  notify()
}

export function selectOnly(pageId) {
  selection = new Set([pageId])
  notify()
}

export function selectRangeTo(pageId, anchorId) {
  const a = pages.findIndex((p) => p.id === anchorId)
  const b = pages.findIndex((p) => p.id === pageId)
  if (a === -1 || b === -1) return selectOnly(pageId)

  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(pages[i].id)
  notify()
}

export function selectSource(sourceId) {
  selection = new Set(pages.filter((p) => p.sourceId === sourceId).map((p) => p.id))
  notify()
}

export function selectAll() {
  selection = new Set(pages.map((p) => p.id))
  notify()
}

export function clearSelection() {
  selection.clear()
  notify()
}

// --- editing ---------------------------------------------------------------

// Move one or more pages so they sit at `toPosition`. Moving a block keeps the
// block's internal order, which is what you want when dragging a selection.
export function movePages(pageIds, toPosition) {
  const moving = new Set(pageIds)
  const target = pages[toPosition]
  if (!target || moving.has(target.id)) return  // dropped onto itself

  beginChange()

  const block = pages.filter((p) => moving.has(p.id))
  const rest = pages.filter((p) => !moving.has(p.id))

  const targetIndex = rest.indexOf(target)
  const firstMovingIndex = pages.findIndex((p) => moving.has(p.id))

  // Dragging forwards drops after the target, backwards drops before it.
  const insertAt = firstMovingIndex < toPosition ? targetIndex + 1 : targetIndex

  rest.splice(insertAt, 0, ...block)
  pages = rest
  notify()
}

export function deleteSelected() {
  if (selection.size === 0) return
  beginChange()
  pages = pages.filter((p) => !selection.has(p.id))
  selection.clear()
  notify()
}

// Redaction boxes are stored against the page AS DISPLAYED, so rotating the
// page has to rotate them too — otherwise a box silently slides off the thing
// it was covering, which for redaction is the worst possible failure.
function rotateRect(r, clockwise) {
  return clockwise
    ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w }
}

export function rotateSelected(degreesDelta) {
  if (selection.size === 0) return
  beginChange()

  const clockwise = degreesDelta > 0
  const quarterTurns = Math.abs(degreesDelta) / 90

  for (const page of pages) {
    if (!selection.has(page.id)) continue

    // Keep it in 0-359 no matter how many times they click.
    page.rotation = (((page.rotation + degreesDelta) % 360) + 360) % 360

    for (let turn = 0; turn < quarterTurns; turn++) {
      page.redactions = page.redactions.map((r) => rotateRect(r, clockwise))
    }
  }
  notify()
}

export function duplicateSelected() {
  if (selection.size === 0) return
  beginChange()

  const copies = []
  for (const page of pages) {
    if (!selection.has(page.id)) continue
    copies.push({
      ...page,
      id: `p${nextPageId++}`,
      stamps: page.stamps.map((s) => ({ ...s })),
      redactions: page.redactions.map((r) => ({ ...r })),
    })
  }

  // Duplicates go on the end, so nothing shifts under the user's cursor.
  pages = [...pages, ...copies]
  selection = new Set(copies.map((p) => p.id))
  notify()
}

export function setLabelOnSelected(text, position, size) {
  if (selection.size === 0) return
  beginChange()
  for (const page of pages) {
    if (!selection.has(page.id)) continue
    page.stamps = text ? [{ text, position, size }] : []
  }
  notify()
}

export function setRedactions(pageId, rects) {
  beginChange()
  const page = pages.find((p) => p.id === pageId)
  if (page) page.redactions = rects.map((r) => ({ ...r }))
  notify()
}

// --- document settings (not undoable: they are settings, not page edits) ---

export function setNumbering(patch) {
  numbering = { ...numbering, ...patch }
  notify()
}

export function setWatermark(patch) {
  watermark = { ...watermark, ...patch }
  notify()
}

export function setFlatten(patch) {
  flatten = { ...flatten, ...patch }
  notify()
}

export function setMetadata(patch) {
  metadata = { ...metadata, ...patch }
}

export function setOutputName(name) {
  outputName = name
  // No notify: this would re-render the grid on every keystroke for nothing.
}
