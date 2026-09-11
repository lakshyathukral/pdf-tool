// ---------------------------------------------------------------------------
// ui/files.js — the strip of loaded PDFs above the pages: what came from
// where, how to select or remove each one, and how to add more.
//
// This used to be told three times over: a count in the header, a strip here,
// and a full list in the sidebar. One place, next to the pages it describes.
// ---------------------------------------------------------------------------

import * as model from '../model.js'

const strip = document.querySelector('#file-strip')
const chips = document.querySelector('#file-chips')

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function makeChip(source) {
  const inDocument = model.pagesFromSource(source.id)

  const chip = document.createElement('span')
  chip.className = 'file-chip'
  chip.dataset.sourceId = source.id
  chip.title = `${source.name} — click to select its pages`

  const swatch = document.createElement('span')
  swatch.className = 'swatch'
  swatch.style.background = source.color

  const name = document.createElement('span')
  name.className = 'chip-name'
  name.textContent = source.name

  // The page count is the useful number; the original count only matters when
  // pages have been deleted, and the size only when it is large.
  const meta = document.createElement('span')
  meta.className = 'chip-meta'
  meta.textContent =
    inDocument === source.pageCount
      ? `${inDocument} page${inDocument === 1 ? '' : 's'}`
      : `${inDocument} of ${source.pageCount} pages`
  chip.title = `${source.name} — ${formatSize(source.bytes.byteLength)}. Click to select its pages.`

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.dataset.action = 'remove'
  remove.textContent = '×'
  remove.title = `Remove ${source.name} and all its pages`
  remove.setAttribute('aria-label', `Remove ${source.name}`)

  chip.append(swatch, name, meta, remove)
  return chip
}

export function drawFileStrip() {
  const sources = [...model.getSources().values()]
  strip.hidden = sources.length === 0
  chips.replaceChildren(...sources.map(makeChip))

  // Only worth offering once there is more than one file to group.
  document.querySelector('#group-by-file').hidden = sources.length < 2
}

export function setupFileList() {
  document.querySelector('#group-by-file').addEventListener('click', model.groupBySource)

  // One listener for the whole strip; chips are rebuilt on every change.
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.file-chip')
    if (!chip) return
    const sourceId = chip.dataset.sourceId

    if (event.target.closest('[data-action="remove"]')) model.removeSource(sourceId)
    else model.selectSource(sourceId)
  })
}
