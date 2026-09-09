// ---------------------------------------------------------------------------
// main.js — wiring. Connects controls to the model, and redraws when it
// changes. The actual work lives in model.js, render.js, export.js and ui/.
// ---------------------------------------------------------------------------

import './style.css'
import * as model from './model.js'
import { openSource, renderThumbnail, rasterizeRedacted, flattenDocument } from './render.js'
import {
  buildPdf,
  buildFlattened,
  defaultOutputName,
  safeFileName,
  downloadBytes,
  downloadMany,
  formatPageNumber,
  splitStarts,
} from './export.js'
import { drawGrid } from './ui/grid.js'
import { setupDragDrop } from './ui/dragdrop.js'
import { openRedactor, setupRedactor } from './ui/redact.js'
import { drawFileList, setupFileList } from './ui/files.js'
import { drawBookmarks, setupBookmarks } from './ui/bookmarks.js'
import { openViewer, setupViewer, refreshViewer } from './ui/viewer.js'
import * as presets from './presets.js'
import { TOOLS, ALWAYS_PANELS, getTool, currentToolId, goToTool, goToLanding } from './tools.js'
import { drawLanding } from './ui/landing.js'

const el = (id) => document.querySelector(`#${id}`)

const statusEl = el('status')
const fileInput = el('file-input')

const setStatus = (text) => {
  statusEl.textContent = text
  statusEl.title = text  // the bar truncates, so keep the full text on hover
}

// Errors need somewhere they cannot be cut off or hidden.
function showError(message) {
  el('error-text').textContent = message
  el('error-banner').hidden = false
}

const clearError = () => { el('error-banner').hidden = true }

// ---------------------------------------------------------------------------
// Keep the controls in step with the model
// ---------------------------------------------------------------------------

// --- which tool are we in -------------------------------------------------

// No tool in the address bar means the landing page. An unknown one falls back
// to the full editor rather than showing nothing.
const activeTool = () => getTool(currentToolId()) ?? TOOLS.pro
const onLanding = () => getTool(currentToolId()) === null

const PANEL_IDS = ['panel-files', 'panel-bookmarks', 'panel-label', 'panel-numbering', 'panel-watermark', 'panel-presets', 'panel-saving']
const PAGE_ACTION_IDS = ['select-all', 'select-none', 'rotate-left', 'rotate-right', 'duplicate', 'delete', 'view', 'redact']

// Show only the parts this tool needs. Everything still exists and still works
// — a simple tool is the full editor with pieces hidden, not a separate app.
function applyTool() {
  const tool = activeTool()
  const isPro = tool.panels === 'all'

  for (const id of PANEL_IDS) {
    el(id).hidden = !(isPro || ALWAYS_PANELS.includes(id) || tool.panels.includes(id))
  }

  for (const id of PAGE_ACTION_IDS) {
    el(id).hidden = !(tool.pageActions === 'all' || tool.pageActions.includes(id))
  }

  // The split controls only make sense in the full editor or the split tool.
  el('split-block').hidden = !(isPro || tool.primary === 'split')
  el('extract').hidden = !(isPro || tool.primary === 'extract')

  el('tool-name').textContent = onLanding()
    ? 'Runs entirely in your browser — nothing is uploaded.'
    : tool.name

  el('primary-action').textContent = tool.primaryLabel
  el('open-pro').hidden = onLanding() || isPro
  el('dropzone-tool').textContent = tool.name
  el('dropzone-hint').textContent = tool.hint ?? ''
}

function applyRoute() {
  clearError()
  applyTool()
  refreshControls()
}

function refreshControls() {
  const hasPages = !model.isEmpty()
  const selected = model.selectionCount()
  const hasSelection = selected > 0

  el('undo').disabled = !model.canUndo()
  el('redo').disabled = !model.canRedo()
  el('select-all').disabled = !hasPages
  el('select-none').disabled = !hasSelection
  el('rotate-left').disabled = !hasSelection
  el('rotate-right').disabled = !hasSelection
  el('duplicate').disabled = !hasSelection
  el('delete').disabled = !hasSelection
  el('label-apply').disabled = !hasSelection
  el('label-clear').disabled = !hasSelection
  el('bookmark-add').disabled = !hasSelection
  el('bookmark-add-sub').disabled = !hasSelection

  el('bookmark-hint').textContent =
    !hasSelection ? 'Select a page first — click a thumbnail.'
    : selected > 1 ? `Will name all ${selected} selected pages. Use {n} in the title to number them.`
    : ''
  el('primary-action').disabled =
    !hasPages || (activeTool().primary === 'extract' && !hasSelection)
  el('extract').disabled = !hasSelection
  el('split').disabled = !hasPages

  // Both work on one page at a time — a box drawn on one page means nothing
  // on another, and the viewer shows a single page.
  el('redact').disabled = selected !== 1
  el('view').disabled = selected !== 1

  // Three exclusive views: pick a tool, add files, work on them.
  const landing = onLanding()
  el('app-landing').hidden = !landing
  el('app-empty').hidden = landing || hasPages
  el('app-workspace').hidden = landing || !hasPages

  el('selection-summary').textContent =
    selected === 0 ? 'Click a page to select it'
    : selected === 1 ? '1 page selected'
    : `${selected} pages selected`

  el('label-hint').textContent = hasSelection ? '' : 'Select pages first — click a thumbnail.'

  // The Bates-only fields are noise under the other styles.
  const numbering = model.getNumbering()
  const isBates = numbering.style === 'bates'
  el('numbering-prefix-field').hidden = !isBates
  el('numbering-padding-field').hidden = !isBates

  // Show the real first and last number so settings can be checked before
  // saving rather than after.
  const pageCount = model.getPages().length
  const last = numbering.start + pageCount - 1

  el('numbering-preview').textContent =
    !numbering.enabled ? ''
    : pageCount === 0 ? 'Add pages to see the numbering.'
    : `Pages will read ${formatPageNumber(numbering, numbering.start, last)} to ` +
      `${formatPageNumber(numbering, last, last)}, added when you save.`

  el('flatten-dpi-field').hidden = !model.getFlatten().enabled

  el('output-name').placeholder = hasPages ? defaultOutputName(model.getSources()) : 'combined'

  if (hasPages) {
    const redacted = model.getPages().filter((p) => p.redactions.length > 0).length
    const parts = [`${pageCount} pages · ${model.getSources().size} file(s)`]
    if (redacted > 0) parts.push(`${redacted} redacted`)
    setStatus(parts.join(' · '))
  }
}

model.subscribe(() => {
  drawGrid()
  drawFileList()
  drawBookmarks()
  refreshViewer()
  refreshControls()
})

// ---------------------------------------------------------------------------
// Loading files
// ---------------------------------------------------------------------------

// Everything is held in memory, so a very large file will take the tab down.
// Better to say so before it happens than to freeze with no explanation.
const LARGE_FILE_MB = 150

// pdf.js and pdf-lib both fail on locked files, in their own vocabularies.
// Translate into something a person can act on.
function describeLoadError(error, name) {
  if (error?.name === 'PasswordException' || /password|encrypt/i.test(error?.message ?? '')) {
    return `"${name}" is password-protected, so it cannot be opened here. ` +
      `Open it in Preview, choose File > Export as PDF to save an unlocked copy, then add that.`
  }
  if (/invalid pdf|structure/i.test(error?.message ?? '')) {
    return `"${name}" appears to be damaged or is not really a PDF.`
  }
  return `Could not read ${name}: ${error.message}`
}

async function loadFiles(files) {
  for (const file of files) {
    if (file.type !== 'application/pdf') {
      setStatus(`Skipped "${file.name}" — not a PDF.`)
      continue
    }

    const sizeMb = file.size / 1024 / 1024
    if (sizeMb > LARGE_FILE_MB) {
      const proceed = confirm(
        `"${file.name}" is ${Math.round(sizeMb)} MB.\n\n` +
        `This tool holds the whole document in memory, and a file this large ` +
        `may make the browser tab run out and crash. Nothing on your disk is ` +
        `at risk either way.\n\nTry to open it anyway?`,
      )
      if (!proceed) {
        setStatus(`Skipped "${file.name}" — ${Math.round(sizeMb)} MB.`)
        continue
      }
    }

    setStatus(`Reading ${file.name}...`)

    try {
      const bytes = await file.arrayBuffer()

      // The model allocates the id first so render.js caches thumbnails under
      // the same id. openSource clones the bytes for pdf.js, which takes
      // ownership of what it is given — `bytes` stays intact for pdf-lib.
      const id = model.reserveSourceId()
      const pageCount = await openSource(id, bytes)
      model.addSource(id, file.name, bytes, pageCount)

      // Render thumbnails one at a time. Doing them all at once does not make
      // them faster — canvas work runs on the main thread — and it would stop
      // pages appearing progressively.
      for (const page of model.getPages()) {
        if (page.sourceId !== id) continue
        await renderThumbnail(page.sourceId, page.pageIndex)
        drawGrid()
      }
    } catch (error) {
      setStatus(`Could not read ${file.name}.`)
      showError(describeLoadError(error, file.name))
      console.error(error)
    }
  }

  refreshControls()
}

for (const input of [fileInput, el('file-input-empty')]) {
  input.addEventListener('change', async () => {
    const files = [...input.files]
    input.value = ''  // so picking the same file again still fires "change"
    await loadFiles(files)
  })
}

// --- dragging files in from the desktop ------------------------------------
// The page grid also uses drag events to reorder tiles, so we only act when
// the thing being dragged is actually files from outside the browser.
const dropzone = el('dropzone')
const isFileDrag = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files')

window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return
  event.preventDefault()  // without this the browser just opens the file
  dropzone.classList.add('over')
})

window.addEventListener('dragleave', (event) => {
  // relatedTarget is null when the pointer has left the window entirely.
  if (isFileDrag(event) && event.relatedTarget === null) dropzone.classList.remove('over')
})

window.addEventListener('drop', async (event) => {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dropzone.classList.remove('over')
  await loadFiles([...event.dataTransfer.files])
})

// ---------------------------------------------------------------------------
// Page operations
// ---------------------------------------------------------------------------

el('undo').addEventListener('click', model.undo)
el('redo').addEventListener('click', model.redo)
el('select-all').addEventListener('click', model.selectAll)
el('select-none').addEventListener('click', model.clearSelection)
el('rotate-left').addEventListener('click', () => model.rotateSelected(-90))
el('rotate-right').addEventListener('click', () => model.rotateSelected(90))
el('duplicate').addEventListener('click', model.duplicateSelected)
el('delete').addEventListener('click', model.deleteSelected)
el('redact').addEventListener('click', () => openRedactor(model.getSelectedIds()[0]))
el('view').addEventListener('click', () => openViewer(model.getSelectedIds()[0]))

el('label-apply').addEventListener('click', () => {
  model.setLabelOnSelected(
    el('label-text').value.trim(),
    el('label-position').value,
    Number(el('label-size').value),
  )
})

el('label-clear').addEventListener('click', () => model.setLabelOnSelected('', '', 0))

// ---------------------------------------------------------------------------
// Document settings
// ---------------------------------------------------------------------------

// One shape describing every saved setting. Presets store this; the "remember
// what I was using" feature stores this; reading and applying both go through
// the same two functions so they can never drift apart.
function readSettings() {
  return {
    numbering: model.getNumbering(),
    watermark: model.getWatermark(),
    label: {
      text: el('label-text').value,
      position: el('label-position').value,
      size: Number(el('label-size').value),
    },
    metadata: model.getMetadata(),
    flatten: model.getFlatten(),
  }
}

function applySettings(settings) {
  if (!settings) return

  const { numbering, watermark, label, metadata, flatten } = settings

  if (numbering) {
    el('numbering-enabled').checked = numbering.enabled
    el('numbering-style').value = numbering.style
    el('numbering-prefix').value = numbering.prefix
    el('numbering-start').value = numbering.start
    el('numbering-padding').value = numbering.padding
    el('numbering-position').value = numbering.position
    el('numbering-size').value = numbering.size
  }

  if (watermark) {
    el('watermark-enabled').checked = watermark.enabled
    el('watermark-text').value = watermark.text
    el('watermark-size').value = watermark.size
    el('watermark-angle').value = watermark.angle
    el('watermark-opacity').value = Math.round(watermark.opacity * 100)
    el('watermark-tiled').checked = Boolean(watermark.tiled)
  }

  if (flatten) {
    el('flatten-enabled').checked = flatten.enabled
    el('flatten-dpi').value = flatten.dpi
  }

  if (label) {
    el('label-text').value = label.text ?? ''
    el('label-position').value = label.position ?? 'bottom-right'
    el('label-size').value = label.size ?? 12
  }

  if (metadata) {
    el('meta-title').value = metadata.title ?? ''
    el('meta-author').value = metadata.author ?? ''
  }

  // Push the freshly filled-in fields into the model.
  readNumbering()
  readWatermark()
  readMetadata()
  readFlatten()
}

function readMetadata() {
  model.setMetadata({ title: el('meta-title').value, author: el('meta-author').value })
}

function readNumbering() {
  model.setNumbering({
    enabled: el('numbering-enabled').checked,
    style: el('numbering-style').value,
    prefix: el('numbering-prefix').value,
    start: Number(el('numbering-start').value),
    padding: Number(el('numbering-padding').value),
    position: el('numbering-position').value,
    size: Number(el('numbering-size').value),
  })
}

function readWatermark() {
  model.setWatermark({
    enabled: el('watermark-enabled').checked,
    text: el('watermark-text').value,
    size: Number(el('watermark-size').value),
    angle: Number(el('watermark-angle').value),
    // The slider is in whole percent; pdf-lib wants a 0..1 fraction.
    opacity: Number(el('watermark-opacity').value) / 100,
    tiled: el('watermark-tiled').checked,
  })
}

function readFlatten() {
  model.setFlatten({
    enabled: el('flatten-enabled').checked,
    dpi: Number(el('flatten-dpi').value),
  })
}

function remember() {
  presets.rememberLastUsed(readSettings())
}

for (const name of ['enabled', 'style', 'prefix', 'start', 'padding', 'position', 'size']) {
  el(`numbering-${name}`).addEventListener('input', () => { readNumbering(); remember() })
}

for (const name of ['enabled', 'text', 'size', 'angle', 'opacity', 'tiled']) {
  el(`watermark-${name}`).addEventListener('input', () => { readWatermark(); remember() })
}

for (const name of ['flatten-enabled', 'flatten-dpi']) {
  el(name).addEventListener('input', () => { readFlatten(); remember() })
}

for (const name of ['meta-title', 'meta-author']) {
  el(name).addEventListener('input', () => { readMetadata(); remember() })
}

for (const name of ['label-text', 'label-position', 'label-size']) {
  el(name).addEventListener('input', remember)
}

el('output-name').addEventListener('input', () => model.setOutputName(el('output-name').value))

// --- presets ---------------------------------------------------------------

function drawPresetList() {
  const names = presets.presetNames()
  const chosen = el('preset-select').value

  el('preset-select').replaceChildren(
    ...(names.length === 0
      ? [new Option('None saved yet', '')]
      : [new Option('Choose a preset…', ''), ...names.map((n) => new Option(n, n))]),
  )

  if (names.includes(chosen)) el('preset-select').value = chosen

  const hasChoice = Boolean(el('preset-select').value)
  el('preset-apply').disabled = !hasChoice
  el('preset-delete').disabled = !hasChoice
}

el('preset-select').addEventListener('change', drawPresetList)

el('preset-save').addEventListener('click', () => {
  const name = el('preset-name').value.trim()
  if (!name) {
    el('preset-hint').textContent = 'Give the preset a name first.'
    return
  }

  const saved = presets.savePreset(name, readSettings())
  el('preset-hint').textContent = saved
    ? `Saved "${name}".`
    : 'Could not save — this browser is blocking stored data.'

  el('preset-name').value = ''
  drawPresetList()
  el('preset-select').value = name
  drawPresetList()
})

el('preset-apply').addEventListener('click', () => {
  const name = el('preset-select').value
  applySettings(presets.getPreset(name))
  el('preset-hint').textContent = `Using "${name}".`
})

el('preset-delete').addEventListener('click', () => {
  const name = el('preset-select').value
  presets.deletePreset(name)
  el('preset-hint').textContent = `Deleted "${name}".`
  drawPresetList()
})

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (event) => {
  // Don't hijack keys while the user is typing in a field or in the dialog.
  if (event.target.matches('input, select, textarea')) return
  if (document.querySelector('#redact-dialog').open) return

  const meta = event.metaKey || event.ctrlKey

  if (meta && event.key === 'z' && !event.shiftKey) { event.preventDefault(); model.undo() }
  else if (meta && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) { event.preventDefault(); model.redo() }
  else if (meta && event.key === 'a') { event.preventDefault(); model.selectAll() }
  else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); model.deleteSelected() }
  else if (event.key === 'Escape') model.clearSelection()
})

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

const chosenName = () => model.getOutputName().trim() || defaultOutputName(model.getSources())

// Everything the builder needs, in one place.
function exportOptions(pages, firstNumber, totalPages) {
  return {
    pages,
    sources: model.getSources(),
    numbering: model.getNumbering(),
    watermark: model.getWatermark(),
    rasterize: rasterizeRedacted,
    metadata: model.getMetadata(),
    firstNumber,
    totalPages,
  }
}

// The last step before a file reaches the user. If flattening is on, the
// finished PDF is re-rendered to page images so nothing in it can be selected
// or edited. Runs on whatever was just built, so it applies equally to a full
// save, an extract, or each piece of a split.
async function finish(bytes, pages) {
  const flatten = model.getFlatten()
  if (!flatten.enabled) return bytes

  const images = await flattenDocument(bytes, {
    dpi: flatten.dpi,
    onProgress: (page, total) => setStatus(`Flattening page ${page} of ${total}...`),
  })

  // Carry the bookmarks across, positioned within this set of pages.
  const bookmarks = pages.flatMap((page, pageIndex) =>
    page.bookmarks.map((b) => ({ ...b, pageIndex })),
  )

  return buildFlattened(images, model.getMetadata(), bookmarks)
}

// Wraps a save so a failure always reports rather than hanging a disabled button.
async function runSave(button, label, work) {
  button.disabled = true
  clearError()
  setStatus(`${label}...`)
  try {
    await work()
  } catch (error) {
    setStatus('Save failed.')
    showError(`${label} failed: ${error.message}`)
    console.error(error)
  } finally {
    refreshControls()
  }
}

function doSave() {
  return runSave(el('primary-action'), 'Building the PDF', async () => {
    const pages = model.getPages()
    const numbering = model.getNumbering()
    const bytes = await finish(await buildPdf(
      exportOptions(pages, numbering.start, numbering.start + pages.length - 1),
    ), pages)
    const name = safeFileName(chosenName())
    downloadBytes(bytes, name)
    setStatus(`Saved ${name}`)
  })
}

function doExtract() {
  return runSave(el('extract'), 'Extracting pages', async () => {
    const pages = model.getSelectedPages()
    const numbering = model.getNumbering()
    const bytes = await finish(await buildPdf(
      exportOptions(pages, numbering.start, numbering.start + pages.length - 1),
    ), pages)
    const name = safeFileName(`${chosenName()}-extract`)
    downloadBytes(bytes, name)
    setStatus(`Saved ${name} — ${pages.length} page(s)`)
  })
}

function doSplit() {
  return runSave(el('split'), 'Splitting', async () => {
    const all = model.getPages()
    const mode = el('split-mode').value

    const starts = splitStarts(all, mode, model.isSelected)

    if (starts.length < 2) {
      setStatus('Nothing to split — select the pages where a new file should start.')
      return
    }

    const numbering = model.getNumbering()
    const base = chosenName()
    const files = []

    for (let part = 0; part < starts.length; part++) {
      const from = starts[part]
      const to = part + 1 < starts.length ? starts[part + 1] : all.length
      const chunk = all.slice(from, to)

      // Numbering keeps counting across the whole document rather than
      // restarting at 1 in every piece.
      const bytes = await finish(await buildPdf(
        exportOptions(chunk, numbering.start + from, numbering.start + all.length - 1),
      ), chunk)

      files.push({
        name: safeFileName(`${base}-${String(part + 1).padStart(3, '0')}`),
        bytes,
      })
      setStatus(`Splitting... ${part + 1} of ${starts.length}`)
    }

    downloadMany(files, `${safeFileName(base).replace(/\.pdf$/i, '')}-split.zip`)
    setStatus(`Split into ${files.length} file(s)`)
  })
}

const RUN = { save: doSave, extract: doExtract, split: doSplit }

el('extract').addEventListener('click', doExtract)
el('split').addEventListener('click', doSplit)
el('primary-action').addEventListener('click', () => RUN[activeTool().primary]())

// Double-clicking a page opens the viewer; redaction is reached from there or
// from the toolbar.
el('error-dismiss').addEventListener('click', clearError)
el('home-link').addEventListener('click', goToLanding)
el('open-pro').addEventListener('click', () => goToTool('pro'))

// The address bar is the single source of truth for which tool is open, so
// the back button and bookmarked links work without any extra code.
window.addEventListener('hashchange', applyRoute)

setupDragDrop(openViewer)
setupRedactor()
setupViewer(openRedactor)
setupFileList()
setupBookmarks(openViewer)
drawFileList()
drawBookmarks()

// Restore whatever settings were in use last time, then fall back to reading
// the untouched defaults out of the page.
drawLanding()
applySettings(presets.recallLastUsed())
readNumbering()
readWatermark()
readMetadata()
readFlatten()
drawPresetList()
applyRoute()
