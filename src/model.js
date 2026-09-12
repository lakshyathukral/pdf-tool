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
//   { id, sourceId, pageIndex, rotation, stamps: [], redactions: [],
//     bookmarks: [], signatures: [] }
// stamps are the text added with "Add text on pages" — see textmarks.js for
// their shape.
// signatures are placements: { signatureId, x, y, w, h } as fractions of the
// page AS DISPLAYED, measured from the top-left — the same convention as
// redaction boxes, so both survive zooming and rotation the same way.
// bookmarks is a LIST of { title, level }. A page needs more than one because a
// section heading and the first document under it usually start on the same
// page: "A. Pleadings" and "A1. Particulars of Claim" both point at page 1.
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
  size: 10,
  // How the number looks and where it sits: the same choices as added text.
  // x and y of null mean "at the grid spot", worked out for each page's size.
  anchor: 'bottom-right',
  x: null,
  y: null,
  font: 'arial',
  bold: false,
  italic: false,
  colour: 'black',
  box: 'none',
  // Whether a page whose number is hidden still uses up a number. Off lets
  // numbering start at 1 after a cover page.
  countHidden: true,
}

let watermark = {
  enabled: false,
  text: 'DRAFT',
  // The same fonts as added text, so the preview can be drawn as it prints.
  font: 'arial',
  bold: false,
  colour: 'grey',
  size: 60,
  opacity: 0.15,
  angle: 45,
  tiled: false,
}

// Flattening re-renders every page to an image at save time, so no text can be
// selected or edited afterwards. Costs searchability and file size.
let flatten = { enabled: false, dpi: 150, format: 'png' }

// What the saved file should be called. Empty means "work one out for me".
let outputName = ''

// A password to put ON the saved file. Empty means save it unprotected —
// which, for a document opened with a password, means the protection is
// removed. That only works because opening it required the password.
// What should happen to the password when the file is saved. Never a silent
// answer: a file that arrived protected keeps its password unless someone
// chooses otherwise.
//   none   — the file had none and none is being added
//   add    — it had none and one is being put on
//   keep   — it had one and the saved copy keeps it
//   change — it had one and a new one replaces it
//   remove — it had one and the saved copy has none
// keepFrom names which file's password to keep, for a bundle whose files had
// different ones.
let protection = { mode: 'none', password: '', keepFrom: null }

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
      bookmarks: p.bookmarks.map((b) => ({ ...b })),
      signatures: p.signatures.map((sig) => ({ ...sig })),
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
// Which document-level settings the current tool exposes. null means all —
// the full editor. A setting whose controls are hidden is NOT in effect: a
// watermark switched on in one tool was being stamped onto documents in
// another, where nothing on screen showed it was on. Gating the getters means
// the exporter and the thumbnail previews cannot disagree about it.
let exposed = null

export function setExposedSettings(names) {
  exposed = names
  notify()
}

const isExposed = (name) => exposed === null || exposed.has(name)

export const getNumbering = () =>
  isExposed('numbering') ? numbering : { ...numbering, enabled: false }
export const getWatermark = () =>
  isExposed('watermark') ? watermark : { ...watermark, enabled: false }
export const getOutputName = () => outputName
export const getMetadata = () => metadata
// The password that will actually be written, worked out from the choice.
export function getProtection() {
  if (!isExposed('password')) return { enabled: false, password: '' }

  if (protection.mode === 'keep') {
    const source = keptSource()
    return { enabled: Boolean(source?.password), password: source?.password ?? '' }
  }

  if (protection.mode === 'change' || protection.mode === 'add') {
    return { enabled: Boolean(protection.password), password: protection.password }
  }

  return { enabled: false, password: '' }
}

export const getProtectionChoice = () => ({ ...protection })

const protectedList = () => [...sources.values()].filter((source) => source.password)

function keptSource() {
  const protectedOnes = protectedList()
  return protectedOnes.find((source) => source.id === protection.keepFrom) ?? protectedOnes[0] ?? null
}

// The files that arrived with a password, for the "keep which one" list.
export const protectedSources = () => protectedList().map(({ id, name }) => ({ id, name }))

// Two files locked with different passwords: only one can protect the saved
// file, so the choice has to be put to the user rather than guessed.
export const passwordsDiffer = () => new Set(protectedList().map((source) => source.password)).size > 1

// Whether any loaded file needed a password to open — the panel says so, since
// "save it unticked and the password is gone" is not obvious otherwise.
export const anySourceProtected = () => [...sources.values()].some((s) => s.password)
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

// "2024-03-01 Witness Statement.pdf" -> "2024-03-01 Witness Statement"
function bookmarkTitleFor(fileName) {
  return fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim()
}

// `sourceOutline` is the bookmarks the file already had, as
// { title, level, pageIndex }. They are nested one level under the entry named
// after the file, so merging three bookmarked documents gives three top-level
// entries each keeping its own structure underneath.
// The password a protected file was opened with. Needed again at export time,
// because the exporter has to decrypt the original to copy pages out of it.
export function setSourcePassword(id, password) {
  const source = sources.get(id)
  if (source) source.password = password
}

export function addSource(id, name, bytes, pageCount, sourceOutline = []) {
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
      // The first page of each file added gets a bookmark named after it, so
      // merging a set of exhibits produces a navigable bundle with no work.
      bookmarks: pageIndex === 0 ? [{ title: bookmarkTitleFor(name), level: 1 }] : [],
      signatures: [],
      // Where this page's number sits if moved on its own, and whether it is
      // left off this page. Hidden numbers still count.
      numberSpot: null,
      numberHidden: false,
      // Leaves the watermark off this page only.
      watermarkHidden: false,
    })
  }

  for (const entry of sourceOutline) {
    const page = pages.find((p) => p.sourceId === id && p.pageIndex === entry.pageIndex)
    // +1 so the document's own structure sits under the entry named after it,
    // keeping its internal nesting intact rather than flattening it.
    page?.bookmarks.push({
      title: entry.title,
      level: Math.min(MAX_BOOKMARK_LEVEL, entry.level + 1),
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

// Select by position, for typed page ranges.
export function selectPositions(positions) {
  selection = new Set(positions.map((i) => pages[i]?.id).filter(Boolean))
  notify()
}

export const getSelectedPositions = () =>
  pages.map((p, i) => (selection.has(p.id) ? i : -1)).filter((i) => i !== -1)

// Odd and even count the way a reader does — page 1 is odd — which is what
// people mean when separating the two sides of a double-sided scan.
export function selectOdd() {
  selection = new Set(pages.filter((_, i) => i % 2 === 0).map((p) => p.id))
  notify()
}

export function selectEven() {
  selection = new Set(pages.filter((_, i) => i % 2 === 1).map((p) => p.id))
  notify()
}

export function invertSelection() {
  selection = new Set(pages.filter((p) => !selection.has(p.id)).map((p) => p.id))
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
export function rotateRect(r, clockwise) {
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
      // A duplicated page must not duplicate its bookmarks: two entries with
      // the same name pointing at different pages is worse than none.
      bookmarks: [],
      // Signatures DO copy — duplicating a signed page should stay signed.
      signatures: page.signatures.map((sig) => ({ ...sig })),
    })
  }

  // Duplicates go on the end, so nothing shifts under the user's cursor.
  pages = [...pages, ...copies]
  selection = new Set(copies.map((p) => p.id))
  notify()
}

// --- text on pages ---------------------------------------------------------

// Text added together shares a group, so "Annexure P-1 to P-4" can be taken
// off again in one go rather than page by page. A page can carry several
// groups: a bundle often needs an annexure number AND "Certified True Copy".
let nextGroupId = 1

// entries: [{ pageId, mark }]. One undoable step however many pages it covers.
// With bookmark on, each page also gets a bookmark with the same words — an
// annexure number usually needs to be both — in the same undoable step.
export function addTextMarks(entries, { bookmark = false } = {}) {
  const useful = entries.filter((e) => e.mark.text && pages.some((p) => p.id === e.pageId))
  if (useful.length === 0) return null

  beginChange()
  const group = `t${nextGroupId++}`
  for (const { pageId, mark } of useful) {
    const page = pages.find((p) => p.id === pageId)
    page.stamps.push({ ...mark, group })
    if (bookmark) page.bookmarks.push({ title: mark.text.trim(), level: 1 })
  }
  notify()
  return group
}

export function removeTextGroup(group) {
  if (!pages.some((p) => p.stamps.some((s) => s.group === group))) return
  beginChange()
  for (const page of pages) page.stamps = page.stamps.filter((s) => s.group !== group)
  notify()
}

// Every page carrying a group, with that page's text, in document order —
// what the editor needs to reopen text that was already added.
export function getTextGroupMarks(group) {
  return pages.flatMap((page) =>
    page.stamps.filter((mark) => mark.group === group).map((mark) => ({ page, mark })))
}

// Put edited text back as one undoable step. It keeps its group, so it stays
// one row under "Text already added".
export function replaceTextGroup(group, entries) {
  if (!pages.some((p) => p.stamps.some((s) => s.group === group))) return
  beginChange()
  for (const page of pages) page.stamps = page.stamps.filter((s) => s.group !== group)
  for (const { pageId, mark } of entries) {
    pages.find((p) => p.id === pageId)?.stamps.push({ ...mark, group })
  }
  notify()
}

// Move one page's copy of a piece of text, leaving every other page alone —
// dragging it in the page viewer.
export function moveTextMark(pageId, group, { x, y }) {
  const mark = pages.find((p) => p.id === pageId)?.stamps.find((s) => s.group === group)
  if (!mark || (mark.x === x && mark.y === y)) return
  beginChange()
  mark.x = x
  mark.y = y
  notify()
}

// Take a piece of text off one page only.
export function removeTextMark(pageId, group) {
  const page = pages.find((p) => p.id === pageId)
  if (!page?.stamps.some((s) => s.group === group)) return
  beginChange()
  page.stamps = page.stamps.filter((s) => s.group !== group)
  notify()
}

// Each set of text added, in the order it first appears in the document.
export function getTextGroups() {
  const groups = new Map()
  for (const page of pages) {
    for (const mark of page.stamps) {
      if (!groups.has(mark.group)) groups.set(mark.group, { group: mark.group, texts: [], pages: 0 })
      const entry = groups.get(mark.group)
      entry.texts.push(mark.text)
      entry.pages += 1
    }
  }
  return [...groups.values()]
}

// --- page numbers on single pages --------------------------------------------

// Move the page number on one page only. null puts it back with the rest.
export function setNumberSpot(pageId, spot) {
  const page = pages.find((p) => p.id === pageId)
  if (!page) return
  beginChange()
  page.numberSpot = spot ? { anchor: spot.anchor, x: spot.x, y: spot.y } : null
  notify()
}

// Every page's own spot at once, from the placing view: one undoable step.
export function setNumberSpots(entries) {
  if (entries.length === 0) return
  beginChange()
  for (const { pageId, spot } of entries) {
    const page = pages.find((p) => p.id === pageId)
    if (page) page.numberSpot = spot ? { anchor: spot.anchor, x: spot.x, y: spot.y } : null
  }
  notify()
}

export function setNumberHidden(pageId, hidden) {
  const page = pages.find((p) => p.id === pageId)
  if (!page || Boolean(page.numberHidden) === hidden) return
  beginChange()
  page.numberHidden = hidden
  notify()
}

export function showNumbersEverywhere() {
  if (!pages.some((p) => p.numberHidden)) return
  beginChange()
  for (const page of pages) page.numberHidden = false
  notify()
}

export const hiddenNumberCount = () => pages.filter((p) => p.numberHidden).length

// --- the watermark on single pages -------------------------------------------

export function setWatermarkHidden(pageId, hidden) {
  const page = pages.find((p) => p.id === pageId)
  if (!page || Boolean(page.watermarkHidden) === hidden) return
  beginChange()
  page.watermarkHidden = hidden
  notify()
}

export function showWatermarkEverywhere() {
  if (!pages.some((p) => p.watermarkHidden)) return
  beginChange()
  for (const page of pages) page.watermarkHidden = false
  notify()
}

export const hiddenWatermarkCount = () => pages.filter((p) => p.watermarkHidden).length

// One redaction box off one page — tapping it in the page viewer.
export function removeRedaction(pageId, index) {
  const page = pages.find((p) => p.id === pageId)
  if (!page?.redactions[index]) return
  beginChange()
  page.redactions.splice(index, 1)
  notify()
}

// Matches the exporter's limit; imported documents keep their own nesting.
const MAX_BOOKMARK_LEVEL = 5

// --- bookmarks -------------------------------------------------------------

// A sub-bookmark nests under whatever comes before it. An entry deeper than
// the one above allows is pulled up rather than dropped, so a stray
// sub-bookmark still appears — the same rule the exporter uses when it builds
// the real outline, so the panel can never show something the file will not.
function withEffectiveLevels(entries) {
  let deepestAllowed = 1

  return entries.map((entry) => {
    const effectiveLevel = Math.min(entry.level, deepestAllowed)
    deepestAllowed = effectiveLevel + 1
    return { ...entry, effectiveLevel }
  })
}

// Every bookmark in document order, with where it points and how to address it.
export function getBookmarks() {
  const flat = []

  pages.forEach((page, position) => {
    page.bookmarks.forEach((bookmark, index) => {
      flat.push({ ...bookmark, position, pageId: page.id, index })
    })
  })

  return withEffectiveLevels(flat)
}

export function addBookmark(pageId, title, level) {
  if (!title.trim()) return
  beginChange()
  pages.find((p) => p.id === pageId)?.bookmarks.push({ title: title.trim(), level })
  notify()
}

export function renameBookmark(pageId, index, title) {
  beginChange()
  const bookmark = pages.find((p) => p.id === pageId)?.bookmarks[index]
  if (bookmark) bookmark.title = title.trim()
  notify()
}

export function removeBookmark(pageId, index) {
  beginChange()
  pages.find((p) => p.id === pageId)?.bookmarks.splice(index, 1)
  notify()
}

// Indent or outdent one entry.
export function nudgeBookmarkLevel(pageId, index, delta) {
  beginChange()
  const bookmark = pages.find((p) => p.id === pageId)?.bookmarks[index]
  if (bookmark) {
    bookmark.level = Math.max(1, Math.min(MAX_BOOKMARK_LEVEL, bookmark.level + delta))
  }
  notify()
}

export const maxBookmarkLevel = () => MAX_BOOKMARK_LEVEL

// A bookmark on each of several pages, each with its own title, as one step —
// automatic numbering gives every page the next number.
export function addBookmarks(entries, level) {
  const useful = entries.filter((e) => e.title.trim() && pages.some((p) => p.id === e.pageId))
  if (useful.length === 0) return
  beginChange()
  for (const { pageId, title } of useful) {
    pages.find((p) => p.id === pageId).bookmarks.push({ title: title.trim(), level })
  }
  notify()
}

// Name every selected page at once. {n} in the title is replaced by a counter,
// so "Exhibit {n}" gives Exhibit 1, Exhibit 2, and so on in page order.
export function bookmarkSelected(pattern, level, startAt = 1) {
  if (selection.size === 0 || !pattern.trim()) return
  beginChange()

  let n = startAt
  for (const page of pages) {
    if (!selection.has(page.id)) continue
    page.bookmarks.push({ title: pattern.replace(/\{n\}/g, String(n)), level })
    n++
  }
  notify()
}

// --- signatures ------------------------------------------------------------

// Put a signature on one page at the given spot.
export function placeSignature(pageId, signatureId, box) {
  beginChange()
  pages.find((p) => p.id === pageId)?.signatures.push({ signatureId, ...box })
  notify()
}

// The same signature in the same spot on every selected page — how you initial
// each page of a bundle without doing it forty times.
export function placeSignatureOnSelected(signatureId, box) {
  if (selection.size === 0) return
  beginChange()
  for (const page of pages) {
    if (selection.has(page.id)) page.signatures.push({ signatureId, ...box })
  }
  notify()
}

export function removeSignaturePlacement(pageId, index) {
  beginChange()
  pages.find((p) => p.id === pageId)?.signatures.splice(index, 1)
  notify()
}

export function clearSignaturesOnSelected() {
  if (selection.size === 0) return
  beginChange()
  for (const page of pages) {
    if (selection.has(page.id)) page.signatures = []
  }
  notify()
}

// Every page a given signature image appears on — so removing the image can
// warn about what it would take with it.
export const pagesUsingSignature = (signatureId) =>
  pages.filter((p) => p.signatures.some((sig) => sig.signatureId === signatureId)).length

export const signaturePlacementCount = () =>
  pages.reduce((n, p) => n + p.signatures.length, 0)

// Add boxes to several pages at once, as a single undoable change. Search
// results arrive this way: one Undo should take back the whole search, not one
// rectangle of it.
export function addRedactions(entries) {
  const useful = entries.filter((e) => e.rects.length > 0)
  if (useful.length === 0) return 0

  beginChange()
  let added = 0
  for (const entry of useful) {
    const page = pages.find((p) => p.id === entry.pageId)
    if (!page) continue
    for (const rect of entry.rects) {
      page.redactions.push({ ...rect })
      added += 1
    }
  }
  notify()
  return added
}

export function setRedactions(pageId, rects) {
  beginChange()
  const page = pages.find((p) => p.id === pageId)
  if (page) page.redactions = rects.map((r) => ({ ...r }))
  notify()
}

// The redaction view edits every page at once and hands back the full set.
// One call, one undoable step, and no step at all if nothing actually changed,
// so opening the view and pressing Apply does not leave an empty Undo behind.
export function replaceRedactions(entries) {
  const changed = entries.filter(({ pageId, rects }) => {
    const page = pages.find((p) => p.id === pageId)
    return page && JSON.stringify(page.redactions) !== JSON.stringify(rects)
  })
  if (changed.length === 0) return 0

  beginChange()
  for (const { pageId, rects } of changed) {
    const page = pages.find((p) => p.id === pageId)
    page.redactions = rects.map((r) => ({ ...r }))
  }
  notify()
  return changed.length
}

// Delete particular pages, whether or not they are selected. The × on a page
// uses this, so deleting one page never disturbs what else is selected.
export function deletePages(ids) {
  const doomed = new Set(ids)
  if (!pages.some((p) => doomed.has(p.id))) return

  beginChange()
  pages = pages.filter((p) => !doomed.has(p.id))
  for (const id of doomed) selection.delete(id)
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

export function setProtection(patch) {
  protection = { ...protection, ...patch }
}

export function setMetadata(patch) {
  metadata = { ...metadata, ...patch }
}

export function setOutputName(name) {
  outputName = name
  // No notify: this would re-render the grid on every keystroke for nothing.
}
