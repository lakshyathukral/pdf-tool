// ---------------------------------------------------------------------------
// ui/files.js — the list of loaded PDFs: what came from where, and how to
// select or remove each one.
// ---------------------------------------------------------------------------

import * as model from '../model.js'

const list = document.querySelector('#file-list')
const panel = document.querySelector('#panel-files')

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function makeRow(source) {
  const inDocument = model.pagesFromSource(source.id)

  const row = document.createElement('li')
  row.className = 'file-row'
  row.dataset.sourceId = source.id

  const swatch = document.createElement('span')
  swatch.className = 'swatch'
  swatch.style.background = source.color

  const name = document.createElement('span')
  name.className = 'file-name'
  name.textContent = source.name
  name.title = source.name

  // Say how many of the file's pages are still in the document, and only
  // mention the original count when the two differ.
  const meta = document.createElement('span')
  meta.className = 'file-meta'
  meta.textContent =
    inDocument === source.pageCount
      ? `${inDocument} page${inDocument === 1 ? '' : 's'} · ${formatSize(source.bytes.byteLength)}`
      : `${inDocument} of ${source.pageCount} pages in use · ${formatSize(source.bytes.byteLength)}`

  const select = document.createElement('button')
  select.type = 'button'
  select.dataset.action = 'select'
  select.textContent = 'Select its pages'
  select.disabled = inDocument === 0

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.dataset.action = 'remove'
  remove.textContent = 'Remove'

  row.append(swatch, name, meta, select, remove)
  return row
}

export function drawFileList() {
  const sources = [...model.getSources().values()]
  panel.hidden = sources.length === 0
  list.replaceChildren(...sources.map(makeRow))
}

export function setupFileList() {
  // One listener on the list rather than two per row, since rows are rebuilt
  // every time anything changes.
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return

    const sourceId = button.closest('.file-row').dataset.sourceId

    if (button.dataset.action === 'select') model.selectSource(sourceId)
    else if (button.dataset.action === 'remove') model.removeSource(sourceId)
  })

  document.querySelector('#group-by-file').addEventListener('click', model.groupBySource)
}
