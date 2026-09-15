// ---------------------------------------------------------------------------
// ui/bundle.js — "Annexures from file names": ten files named Annexure 1 to
// Annexure 10 become one bundle, each bookmarked by its name, with the name
// on its first page if wanted, and an index at the front.
//
// The names on the page are ordinary added text (see addtext.js), so they are
// dragged, restyled and edited exactly like anything else written on a page.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { indexRows, pageText, shortLabel } from '../bundle.js'
import { buildIndexPdf, formatPageNumber } from '../export.js'
import { openSource, renderThumbnail } from '../render.js'
import { openTextEditor, placeFileNames } from './addtext.js'

const $ = (id) => document.querySelector(`#${id}`)

let onChanged = () => {}

// --- the list of files --------------------------------------------------------

function pagesOf(sourceId) {
  const numbers = []
  model.getPages().forEach((page, i) => { if (page.sourceId === sourceId) numbers.push(i + 1) })
  if (numbers.length === 0) return ''
  const first = numbers[0]
  const last = numbers.at(-1)
  return first === last ? `page ${first}` : `pages ${first} to ${last}`
}

function fileRow(sourceId, n) {
  const li = document.createElement('li')

  const number = document.createElement('span')
  number.className = 'bundle-n'
  number.textContent = `${n}.`

  const input = document.createElement('input')
  input.type = 'text'
  input.value = model.fileTitle(sourceId)
  input.dataset.sourceId = sourceId
  input.setAttribute('aria-label', `Name of file ${n}`)
  input.title = model.getSource(sourceId)?.name ?? ''

  const where = document.createElement('small')
  where.textContent = pagesOf(sourceId)

  li.append(number, input, where)
  return li
}

// Text written with this flow, found by what it is rather than remembered.
const namesGroup = () => {
  for (const page of model.getPages()) {
    const mark = page.stamps.find((s) => s.names)
    if (mark) return { group: mark.group, pageId: page.id }
  }
  return null
}

export function drawBundlePanel() {
  const files = model.filesInOrder()
  const list = $('bundle-files')

  // Leave the list alone while a name is being typed, or the box would be
  // rebuilt under the cursor.
  if (!list.contains(document.activeElement)) {
    list.replaceChildren(...files.map((id, i) => fileRow(id, i + 1)))
  }

  $('bundle-empty').hidden = files.length > 0
  $('bundle-actions').hidden = files.length === 0
  $('bundle-order').hidden = files.length < 2 || model.inNumberOrder()

  const names = namesGroup()
  $('bundle-names').hidden = Boolean(names)
  $('bundle-names-done').hidden = !names
  $('bundle-index').checked = Boolean(model.getIndexSource())
}

// --- writing the names on the pages ------------------------------------------

// The first page shown from each file, in document order.
function firstPages() {
  const seen = new Set()
  return model.getPages().filter((page) => {
    const source = model.getSource(page.sourceId)
    if (!source || source.index || seen.has(page.sourceId)) return false
    seen.add(page.sourceId)
    return true
  })
}

// Ask how much of a long name to write, only when some name has more than a
// label in it. Resolves 'short', 'full', or null for cancel.
function askForm(titles) {
  const long = titles.find((title) => shortLabel(title))
  if (!long) return Promise.resolve('full')

  const dialog = $('names-dialog')
  $('names-short').textContent = shortLabel(long)
  $('names-full').textContent = long
  dialog.querySelector('input[value="short"]').checked = true

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      const chosen = dialog.querySelector('input[name="names-form"]:checked')?.value ?? 'short'
      resolve(dialog.returnValue === 'go' ? chosen : null)
    }, { once: true })
    dialog.returnValue = ''
    dialog.showModal()
  })
}

export async function writeFileNames() {
  const existing = namesGroup()
  if (existing) return openTextEditor(existing.group, existing.pageId)

  const pages = firstPages()
  if (pages.length === 0) return
  const titles = pages.map((page) => model.fileTitle(page.sourceId))
  const form = await askForm(titles)
  if (!form) return

  await placeFileNames(pages.map((page, i) => ({ page, text: pageText(titles[i], form) })), form)
}

// --- the index ----------------------------------------------------------------

let built = ''       // what the index on the pages was last written from
let building = false
let again = false
let timer = null

function rowsFor(indexPages) {
  return indexRows({
    pages: model.getPages(),
    isIndex: (page) => Boolean(model.getSource(page.sourceId)?.index),
    indexPages,
    titleOf: model.fileTitle,
    numbering: model.getNumbering(),
    formatNumber: formatPageNumber,
  })
}

// Write the index, at the length it needs: adding a page to the index moves
// every page number after it, which can change what the index says.
async function writeIndex(startingPages) {
  let pages = startingPages
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = rowsFor(pages)
    const result = await buildIndexPdf(rows)
    if (result.pageCount === pages || attempt === 2) return { ...result, signature: JSON.stringify([rows, result.pageCount]) }
    pages = result.pageCount
  }
}

async function refreshIndex() {
  const source = model.getIndexSource()
  if (!source) return
  if (building) { again = true; return }

  const wanted = JSON.stringify([rowsFor(source.pageCount), source.pageCount])
  if (wanted === built) return

  building = true
  try {
    const { bytes, pageCount, signature } = await writeIndex(source.pageCount)
    if (!model.getIndexSource()) return
    const id = model.reserveSourceId()
    await openSource(id, bytes)
    built = signature
    model.refreshIndex(id, bytes, pageCount)
    for (let i = 0; i < pageCount; i++) await renderThumbnail(id, i)
    onChanged()
  } finally {
    building = false
    if (again) { again = false; scheduleIndex() }
  }
}

function scheduleIndex() {
  clearTimeout(timer)
  timer = setTimeout(refreshIndex, 250)
}

// Saving waits for the index to catch up with the last change, so a file is
// never saved with an index that is out of date.
export async function indexUpToDate() {
  for (let i = 0; i < 20 && model.getIndexSource(); i++) {
    clearTimeout(timer)
    if (building) { await new Promise((resolve) => setTimeout(resolve, 50)); continue }
    const source = model.getIndexSource()
    if (JSON.stringify([rowsFor(source.pageCount), source.pageCount]) === built) return
    await refreshIndex()
  }
}

async function addIndex() {
  building = true
  try {
    const { bytes, pageCount, signature } = await writeIndex(1)
    const id = model.reserveSourceId()
    await openSource(id, bytes)
    built = signature
    model.addIndex(id, bytes, pageCount)
    for (let i = 0; i < pageCount; i++) await renderThumbnail(id, i)
    onChanged()
  } finally {
    building = false
  }
}

// --- wiring -----------------------------------------------------------------------

export function setupBundle(options = {}) {
  onChanged = options.onChanged ?? onChanged

  $('bundle-sort').addEventListener('click', model.sortFilesByName)
  $('bundle-names').addEventListener('click', writeFileNames)
  $('bundle-names-edit').addEventListener('click', writeFileNames)
  $('bundle-names-remove').addEventListener('click', () => {
    const names = namesGroup()
    if (names) model.removeTextGroup(names.group)
  })

  $('bundle-index').addEventListener('change', async (event) => {
    if (event.target.checked) await addIndex()
    else model.removeIndex()
  })

  // A name is saved when the box is left or Enter is pressed.
  const list = $('bundle-files')
  const save = (input) => {
    if (input.value.trim()) model.renameFile(input.dataset.sourceId, input.value)
    else input.value = model.fileTitle(input.dataset.sourceId)
  }
  list.addEventListener('change', (event) => { if (event.target.matches('input')) save(event.target) })
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); event.target.blur() }
  })
  list.addEventListener('focusout', () => requestAnimationFrame(drawBundlePanel))

  // Keep the index true to the bundle as it changes.
  model.subscribe(() => { if (model.getIndexSource()) scheduleIndex() })
}
