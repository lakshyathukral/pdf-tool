// ---------------------------------------------------------------------------
// main.js — wiring. Connects controls to the model, and redraws when it
// changes. The actual work lives in model.js, render.js, export.js and ui/.
// ---------------------------------------------------------------------------

import './style.css'
import * as model from './model.js'
import {
  openSource,
  renderThumbnail,
  rasterizeRedacted,
  flattenDocument,
  readOutline,
  passwordProblem,
} from './render.js'
import {
  buildPdf,
  buildFlattened,
  defaultOutputName,
  safeFileName,
  downloadBytes,
  downloadMany,
  canShareFiles,
  shareBytes,
  formatPageNumber,
  splitStarts,
} from './export.js'
import { drawGrid } from './ui/grid.js'
import { setupDragDrop } from './ui/dragdrop.js'
import { openRedactor, setupRedactor } from './ui/redact.js'
import { setupSearch } from './ui/search.js'
import { drawFileList, drawFileStrip, setupFileList } from './ui/files.js'
import { drawBookmarks, setupBookmarks } from './ui/bookmarks.js'
import { parsePageRanges, formatPageRanges } from './ranges.js'
import { openViewer, setupViewer, refreshViewer } from './ui/viewer.js'
import { openSigner, setupSigner } from './ui/sign.js'
import { openPlacer, setupPlacer } from './ui/place.js'
import * as presets from './presets.js'
import * as signatures from './signatures.js'
import { pdfFromImages, PAGE_SIZES } from './images.js'
import { TOOLS, ALWAYS_PANELS, getTool, isComingSoon, isPage, currentToolId, goToTool, goToLanding } from './tools.js'
import { drawLanding, setupLanding } from './ui/landing.js'

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

// An unfinished tool behaves like no tool at all, so its address shows the
// landing page rather than a half-working screen.
const onLanding = () =>
  getTool(currentToolId()) === null || isComingSoon(currentToolId()) || isPage(currentToolId())

const PANEL_IDS = ['panel-files', 'panel-photos', 'panel-password', 'panel-search', 'panel-bookmarks', 'panel-signatures', 'panel-label', 'panel-numbering', 'panel-watermark', 'panel-presets', 'panel-saving']
const PAGE_ACTION_IDS = ['select-all', 'select-none', 'rotate-left', 'rotate-right', 'duplicate', 'delete', 'view', 'redact']
// Controls that select more than one page at a time.
const MULTI_SELECT_IDS = ['select-all', 'select-odd', 'select-even', 'select-invert', 'range-input', 'range-select']

// Show only the parts this tool needs. Everything still exists and still works
// — a simple tool is the full editor with pieces hidden, not a separate app.
function applyTool() {
  const tool = activeTool()
  const isPro = tool.panels === 'all'

  for (const id of PANEL_IDS) {
    el(id).hidden = !(isPro || ALWAYS_PANELS.includes(id) || tool.panels.includes(id))
  }

  // Open the panel the tool is actually for. Saving used to be open by default,
  // which meant arriving at the watermark tool with the watermark controls
  // collapsed and a long Saving panel expanded — the opposite of what is
  // wanted. The full editor is different: nothing there is "the" tool, and its
  // save controls need to be reachable, so Saving stays open.
  if (isPro) {
    el('panel-saving').open = true
  } else {
    for (const id of PANEL_IDS) {
      if (id === 'panel-files') continue
      el(id).open = tool.panels.includes(id)
    }
    // Except where the tool's own controls live inside Saving.
    if (tool.primary === 'split' || tool.primary === 'extract') el('panel-saving').open = true
  }

  for (const id of PAGE_ACTION_IDS) {
    el(id).hidden = !(tool.pageActions === 'all' || tool.pageActions.includes(id))
  }

  // A tool that acts on exactly one page hides the controls that select many,
  // and gives its own action the weight of a primary button so it is not the
  // last grey thing on the right of a long row.
  for (const id of MULTI_SELECT_IDS) el(id).hidden = Boolean(tool.singlePage)
  el('redact').classList.toggle('action-primary', Boolean(tool.singlePage))

  const note = tool.note ?? ''
  el('tool-note').textContent = note
  el('tool-note').hidden = note === '' || onLanding()

  // Signatures are not ready; keep the panel out of the full editor too.
  el('panel-signatures').hidden = true

  // Settings whose panels this tool does not show are not in effect. The
  // model gates its own getters on this, so the exporter and the previews
  // follow it automatically.
  const SETTING_PANELS = {
    'panel-watermark': 'watermark',
    'panel-numbering': 'numbering',
    'panel-password': 'password',
  }
  model.setExposedSettings(
    isPro ? null : new Set(tool.panels.map((id) => SETTING_PANELS[id]).filter(Boolean)),
  )

  // The split controls only make sense in the full editor or the split tool.
  el('split-block').hidden = !(isPro || tool.primary === 'split')
  el('extract').hidden = !(isPro || tool.primary === 'extract')

  el('tool-name').textContent = onLanding() ? '' : tool.name
  // The workspace carries a one-line reminder of what it is for; a quick tool
  // does not need one, and the header stays quiet without it.
  el('tool-subtitle').textContent = onLanding() ? '' : (tool.subtitle ?? '')

  el('primary-action').textContent = tool.primaryLabel
  el('open-pro').hidden = onLanding() || isPro
  el('dropzone-tool').textContent = onLanding() ? '' : tool.name
  el('dropzone-hint').textContent = tool.hint ?? ''

  // A tool that works on photographs should not tell you to drop a PDF.
  const wantsPhotos = tool.panels !== 'all' && tool.panels.includes('panel-photos')
  el('dropzone-heading').textContent = wantsPhotos ? 'Drop a PDF or a photo' : 'Drop PDFs here'
  el('photo-empty-button').classList.toggle('primary-file', wantsPhotos)
}

// Remembered so a tool's defaults are applied when you arrive at it, not on
// every redraw — otherwise turning the watermark off would turn itself back on.
let lastToolId = null

function applyRoute() {
  clearError()

  // Each of the three non-tool pages is drawn from the address bar, so the
  // back button and a bookmarked #legal both land in the right place.
  drawLanding()

  const id = currentToolId()
  if (id !== lastToolId) {
    lastToolId = id
    applyToolDefaults(getTool(id))
  }

  applyTool()
  refreshControls()
}

// A single-purpose tool should arrive ready to do its job. Only fills in what
// has not been set, so a saved preset always wins.
function applyToolDefaults(tool) {
  if (!tool?.defaults) return

  const { watermark, photoPageSize } = tool.defaults

  if (watermark) {
    // Switching it on is this tool's whole point, and the panel is open so it
    // is visible. The wording is only filled in if the user has not chosen
    // their own — "DRAFT" is the untouched default.
    const current = el('watermark-text').value.trim()
    if (!current || current === 'DRAFT') {
      el('watermark-text').value = watermark.text
      el('watermark-size').value = watermark.size
      el('watermark-angle').value = watermark.angle
      el('watermark-opacity').value = Math.round(watermark.opacity * 100)
      el('watermark-tiled').checked = watermark.tiled
    }
    el('watermark-enabled').checked = true
    el('panel-watermark').open = true
    readWatermark()
  }

  if (photoPageSize) el('photo-page-size').value = photoPageSize
}

function refreshControls() {
  const hasPages = !model.isEmpty()
  const selected = model.selectionCount()
  const hasSelection = selected > 0

  el('undo').disabled = !model.canUndo()
  el('redo').disabled = !model.canRedo()
  el('select-all').disabled = !hasPages
  el('select-none').disabled = !hasSelection
  el('select-odd').disabled = !hasPages
  el('select-even').disabled = !hasPages
  el('select-invert').disabled = !hasPages
  el('range-select').disabled = !hasPages
  el('range-input').disabled = !hasPages

  // Show what is selected in the same language the box accepts, so a
  // selection made by clicking can be read, adjusted and retyped.
  if (document.activeElement !== el('range-input')) {
    el('range-input').value = formatPageRanges(model.getSelectedPositions())
  }
  el('rotate-left').disabled = !hasSelection
  el('rotate-right').disabled = !hasSelection
  el('duplicate').disabled = !hasSelection
  el('delete').disabled = !hasSelection
  el('label-apply').disabled = !hasSelection
  el('label-clear').disabled = !hasSelection
  // Signing needs an image loaded and exactly one page chosen.
  el('sign-open').disabled = selected !== 1 || !signatures.hasSignatures()
  el('sign-remove-pages').disabled = !hasSelection

  el('signature-hint').textContent =
    !signatures.hasSignatures() ? 'Add a signature image to begin.'
    : selected === 0 ? 'Select the page to sign — click a thumbnail.'
    : selected > 1 ? 'Select a single page to place a signature; you can then copy it to the rest.'
    : ''

  drawSignatureList()

  // Positioning by hand needs one page to show, and text to show on it.
  el('label-place').disabled = selected !== 1

  el('bookmark-add').disabled = !hasSelection
  el('bookmark-add-sub').disabled = !hasSelection

  el('bookmark-hint').textContent =
    !hasSelection ? 'Select a page first — click a thumbnail.'
    : selected > 1 ? `Will name all ${selected} selected pages. Use {n} in the title to number them.`
    : ''
  el('primary-action').disabled =
    !hasPages || (activeTool().primary === 'extract' && !hasSelection)

  // Only where the device can actually hand a file to another app — phones and
  // tablets, mostly. On a desktop the button would do nothing useful.
  el('share-action').hidden = !canShareFiles()
  el('share-action').disabled = !hasPages
  el('extract').disabled = !hasSelection
  el('split').disabled = !hasPages

  // Both work on one page at a time — a box drawn on one page means nothing
  // on another, and the viewer shows a single page.
  el('redact').disabled = selected !== 1
  el('view').disabled = selected !== 1

  // Three exclusive views: pick a tool, add files, work on them.
  const landing = onLanding()
  el('app-landing').hidden = !landing

  // On a page where nothing is loaded and no tool is chosen, the working
  // controls are noise. The header keeps the brand, the navigation and the
  // badge saying where the work happens.
  for (const id of ['status', 'undo', 'redo', 'primary-action', 'open-pro']) {
    el(id).classList.toggle('hide-on-landing', landing)
  }
  document.querySelector('.top-actions').classList.toggle('landing', landing)

  // Site navigation belongs on the pages where you are choosing something. In
  // a workspace the header is for the document, and the logo still goes home.
  document.querySelector('#site-nav').classList.toggle('hide-in-workspace', !landing)
  document.querySelector('#nav-toggle').classList.toggle('hide-in-workspace', !landing)
  el('app-empty').hidden = landing || hasPages
  el('app-workspace').hidden = landing || !hasPages
  placeMobileBar()

  const singlePage = Boolean(activeTool().singlePage)
  el('selection-summary').textContent =
    selected === 0 ? (singlePage ? 'Click one page' : 'Click a page to select it')
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

  el('flatten-options').hidden = !model.getFlatten().enabled

  // Say plainly what saving will do to a protected file.
  el('password-state').textContent = !hasPages
    ? 'Add a PDF. If it is protected you will be asked for its password.'
    : model.anySourceProtected()
      ? (model.getProtection().enabled
          ? 'This file was opened with a password. Saving will replace it with the one below.'
          : 'This file was opened with a password. Saving now will REMOVE it.')
      : (model.getProtection().enabled
          ? 'Saving will protect the file with the password below.'
          : 'This file has no password. Tick the box to add one.')

  el('output-name').placeholder = hasPages ? defaultOutputName(model.getSources()) : 'combined'

  // A visible count of what is loaded, which opens the file list. The panel
  // existed from the start and people were not finding it.
  const fileCount = model.getSources().size
  el('files-chip').hidden = !hasPages
  el('files-chip').textContent = fileCount === 1 ? '1 file' : `${fileCount} files`

  if (hasPages) {
    const redacted = model.getPages().filter((p) => p.redactions.length > 0).length
    const parts = [`${pageCount} pages · ${fileCount} file(s)`]
    if (redacted > 0) parts.push(`${redacted} redacted`)
    setStatus(parts.join(' · '))
  } else {
    // This used to be left alone, so after undoing a load the bar still
    // claimed "774 pages · 1 file" over an empty screen.
    setStatus('No PDFs loaded yet.')
  }

  // Undo can un-load a file. If that just happened, say how to get it back
  // rather than presenting a blank drop zone as if nothing had occurred.
  if (!hasPages && model.canRedo()) {
    el('dropzone-hint').textContent = 'You just removed a file. Press Redo to bring it back.'
  }
}

model.subscribe(() => {
  drawGrid()
  drawFileList()
  drawFileStrip()
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

// Ask for a password, once, for one file. Resolves to the password or null if
// the user gives up. The value is used and discarded — never stored, never
// remembered, never sent.
function askForPassword(fileName, retry) {
  const dialog = document.querySelector('#password-dialog')
  const input = el('password-input')

  el('password-note').textContent = retry
    ? `That password did not open "${fileName}". Try again?`
    : `"${fileName}" needs a password to open.`
  input.value = ''

  return new Promise((resolve) => {
    const finish = (value) => {
      el('password-ok').removeEventListener('click', ok)
      el('password-cancel').removeEventListener('click', cancel)
      input.removeEventListener('keydown', onKey)
      dialog.close()
      resolve(value)
    }

    const ok = () => finish(input.value)
    const cancel = () => finish(null)
    const onKey = (event) => { if (event.key === 'Enter') { event.preventDefault(); ok() } }

    el('password-ok').addEventListener('click', ok)
    el('password-cancel').addEventListener('click', cancel)
    input.addEventListener('keydown', onKey)

    dialog.showModal()
    input.focus()
  })
}

// Open a file, asking for a password if it turns out to need one. Returns the
// page count and the password that worked, or null if the user gave up.
async function openWithPassword(id, bytes, fileName) {
  let password
  let retry = false

  for (;;) {
    try {
      return { pageCount: await openSource(id, bytes, password), password }
    } catch (error) {
      const problem = passwordProblem(error)
      if (!problem) throw error

      password = await askForPassword(fileName, retry)
      if (password === null) return null
      retry = true
    }
  }
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
      const opened = await openWithPassword(id, bytes, file.name)
      if (!opened) {
        // In the banner, not the status line: the empty-state message rewrites
        // the status line straight away, so someone who cancelled was left
        // looking at "No PDFs loaded yet" with no idea why.
        showError(`Skipped "${file.name}" — no password given. Add it again to try a password.`)
        continue
      }

      // Keep whatever navigation the document already had.
      const existing = await readOutline(id)
      model.addSource(id, file.name, bytes, opened.pageCount, existing)
      if (opened.password) model.setSourcePassword(id, opened.password)

      if (existing.length > 0) {
        setStatus(`${file.name} — kept ${existing.length} existing bookmark(s)`)
      }

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

// --- photographs -----------------------------------------------------------

// Pictures are turned into a PDF straight away and handed to the same code
// path as any other file, so everything downstream — thumbnails, reordering,
// bookmarks, redaction, export — works without knowing about photographs.
async function loadPhotos(files) {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return

  clearError()
  setStatus(`Reading ${images.length} photo(s)...`)

  try {
    const chosen = el('photo-page-size').value
    const bytes = await pdfFromImages(images, {
      pageSize: chosen === 'match' ? null : PAGE_SIZES[chosen],
      onProgress: (done, total) => setStatus(`Converting photo ${done} of ${total}...`),
    })

    const id = model.reserveSourceId()
    const pageCount = await openSource(id, bytes)
    const name = images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '') : `Photos (${images.length})`
    model.addSource(id, `${name}.pdf`, bytes, pageCount)

    for (const page of model.getPages()) {
      if (page.sourceId !== id) continue
      await renderThumbnail(page.sourceId, page.pageIndex)
      drawGrid()
    }

    setStatus(`Added ${pageCount} page(s) from photos`)
  } catch (error) {
    setStatus('Could not read those photos.')
    showError(error.message)
    console.error(error)
  }

  refreshControls()
}

for (const input of [el('photo-input'), el('photo-input-empty')]) {
  input.addEventListener('change', async () => {
    const files = [...input.files]
    input.value = ''
    await loadPhotos(files)
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

  const dropped = [...event.dataTransfer.files]
  await loadFiles(dropped.filter((f) => f.type === 'application/pdf'))
  await loadPhotos(dropped.filter((f) => f.type.startsWith('image/')))
})

// ---------------------------------------------------------------------------
// Page operations
// ---------------------------------------------------------------------------

el('undo').addEventListener('click', model.undo)
el('redo').addEventListener('click', model.redo)
el('select-all').addEventListener('click', model.selectAll)
el('select-none').addEventListener('click', model.clearSelection)
el('select-odd').addEventListener('click', model.selectOdd)
el('select-even').addEventListener('click', model.selectEven)
el('select-invert').addEventListener('click', model.invertSelection)

function applyTypedRange() {
  const positions = parsePageRanges(el('range-input').value, model.getPages().length)
  model.selectPositions(positions)
}

el('range-select').addEventListener('click', applyTypedRange)
el('range-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); applyTypedRange() }
})
el('rotate-left').addEventListener('click', () => model.rotateSelected(-90))
el('rotate-right').addEventListener('click', () => model.rotateSelected(90))
el('duplicate').addEventListener('click', model.duplicateSelected)
el('delete').addEventListener('click', model.deleteSelected)
el('redact').addEventListener('click', () => openRedactor(model.getSelectedIds()[0]))
el('view').addEventListener('click', () => openViewer(model.getSelectedIds()[0]))

function labelPlacement() {
  const exact = el('label-exact').checked
  return {
    position: el('label-position').value,
    size: Number(el('label-size').value),
    mode: exact ? 'exact' : 'preset',
    margin: Number(el('label-margin').value),
    // Stored as fractions, which is what the exporter and the preview both use.
    x: Number(el('label-x').value) / 100,
    y: Number(el('label-y').value) / 100,
  }
}

el('label-apply').addEventListener('click', () => {
  model.setLabelOnSelected(el('label-text').value.trim(), labelPlacement())
})

el('label-clear').addEventListener('click', () => model.setLabelOnSelected('', labelPlacement()))

// The preset position and its margin mean nothing once an exact point is set.
for (const name of ['label-exact', 'label-x', 'label-y', 'label-margin']) {
  el(name).addEventListener('input', () => {
    const exact = el('label-exact').checked
    el('label-exact-fields').hidden = !exact
    el('label-place-row').hidden = !exact
    el('label-position').disabled = exact
    el('label-margin').disabled = exact
    remember()
  })
}

el('label-place').addEventListener('click', () => {
  const text = el('label-text').value.trim() || 'Label'
  openPlacer(
    {
      pageId: model.getSelectedIds()[0],
      text,
      size: Number(el('label-size').value),
      start: { x: Number(el('label-x').value) / 100, y: Number(el('label-y').value) / 100 },
    },
    ({ x, y }) => {
      // Feed the dragged position back into the number fields, so it can be
      // nudged afterwards and saved into a preset like anything else.
      el('label-x').value = Math.round(x * 1000) / 10
      el('label-y').value = Math.round(y * 1000) / 10
      remember()
      model.setLabelOnSelected(el('label-text').value.trim(), labelPlacement())
    },
  )
})

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
      exact: el('label-exact').checked,
      margin: Number(el('label-margin').value),
      x: Number(el('label-x').value),
      y: Number(el('label-y').value),
    },
    metadata: model.getMetadata(),
    flatten: model.getFlatten(),
  }
}

// restoreEnabled: a named preset the user applies on purpose restores its
// switches. The settings remembered from last time do NOT — text, size and
// style come back, but nothing is silently switched on. A watermark enabled
// once was being restored days later, in another tool, with nothing on screen
// to say so.
function applySettings(settings, { restoreEnabled = true } = {}) {
  if (!settings) return

  const { numbering, watermark, label, metadata, flatten } = settings

  if (numbering) {
    el('numbering-enabled').checked = restoreEnabled && Boolean(numbering.enabled)
    el('numbering-style').value = numbering.style
    el('numbering-prefix').value = numbering.prefix
    el('numbering-start').value = numbering.start
    el('numbering-padding').value = numbering.padding
    el('numbering-position').value = numbering.position
    el('numbering-size').value = numbering.size
    el('numbering-margin').value = numbering.margin ?? 12.7
  }

  if (watermark) {
    el('watermark-enabled').checked = restoreEnabled && Boolean(watermark.enabled)
    el('watermark-text').value = watermark.text
    el('watermark-size').value = watermark.size
    el('watermark-angle').value = watermark.angle
    el('watermark-opacity').value = Math.round(watermark.opacity * 100)
    el('watermark-tiled').checked = Boolean(watermark.tiled)
  }

  if (flatten) {
    // Flattening destroys the text layer; it must never come back on by itself.
    el('flatten-enabled').checked = restoreEnabled && Boolean(flatten.enabled)
    el('flatten-dpi').value = flatten.dpi
    el('flatten-format').value = flatten.format ?? 'png'
  }

  if (label) {
    el('label-text').value = label.text ?? ''
    el('label-position').value = label.position ?? 'bottom-right'
    el('label-size').value = label.size ?? 12
    el('label-exact').checked = Boolean(label.exact)
    el('label-margin').value = label.margin ?? 12.7
    el('label-x').value = label.x ?? 50
    el('label-y').value = label.y ?? 50
    el('label-exact-fields').hidden = !label.exact
    el('label-place-row').hidden = !label.exact
    el('label-position').disabled = Boolean(label.exact)
    el('label-margin').disabled = Boolean(label.exact)
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
    margin: Number(el('numbering-margin').value),
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
    format: el('flatten-format').value,
  })
}

function remember() {
  presets.rememberLastUsed(readSettings())
}

for (const name of ['enabled', 'style', 'prefix', 'start', 'padding', 'position', 'size', 'margin']) {
  el(`numbering-${name}`).addEventListener('input', () => { readNumbering(); remember() })
}

for (const name of ['enabled', 'text', 'size', 'angle', 'opacity', 'tiled']) {
  el(`watermark-${name}`).addEventListener('input', () => { readWatermark(); remember() })
}

for (const name of ['flatten-enabled', 'flatten-dpi', 'flatten-format']) {
  el(name).addEventListener('input', () => { readFlatten(); remember() })
}

for (const name of ['meta-title', 'meta-author']) {
  el(name).addEventListener('input', () => { readMetadata(); remember() })
}

for (const name of ['label-text', 'label-position', 'label-size']) {
  el(name).addEventListener('input', remember)
}

el('output-name').addEventListener('input', () => model.setOutputName(el('output-name').value))

// --- protecting the saved file ---------------------------------------------

function readProtection() {
  const enabled = el('protect-enabled').checked
  el('protect-field').hidden = !enabled
  model.setProtection({ enabled, password: el('protect-password').value })
  // setProtection does not notify — that would redraw the grid on every
  // keystroke — so the panel's explanation of what saving will do needs a
  // nudge here.
  refreshControls()
}

for (const name of ['protect-enabled', 'protect-password']) {
  el(name).addEventListener('input', readProtection)
}

// --- signatures ------------------------------------------------------------

function drawSignatureList() {
  const list = el('signature-list')
  list.replaceChildren(...signatures.listSignatures().map((sig) => {
    const row = document.createElement('li')
    row.className = 'signature-row'

    const preview = document.createElement('img')
    preview.src = sig.url
    preview.alt = ''

    const name = document.createElement('span')
    name.className = 'file-name'
    name.textContent = sig.name
    name.title = sig.name

    const used = document.createElement('span')
    used.className = 'file-meta'
    const pages = model.pagesUsingSignature(sig.id)
    used.textContent = pages === 0 ? 'not placed' : `on ${pages} page${pages === 1 ? '' : 's'}`

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      signatures.removeSignature(sig.id)
      drawSignatureList()
      refreshControls()
      drawGrid()
    })

    row.append(preview, name, used, remove)
    return row
  }))
}

el('signature-input').addEventListener('change', async () => {
  const input = el('signature-input')
  const file = input.files[0]
  input.value = ''
  if (!file) return

  clearError()
  try {
    await signatures.addSignature(file, { removeBackground: el('signature-transparent').checked })
    setStatus(`Added signature "${file.name}"`)
  } catch (error) {
    showError(error.message)
    console.error(error)
  }
  drawSignatureList()
  refreshControls()
})

el('sign-open').addEventListener('click', () => openSigner(model.getSelectedIds()[0]))
el('sign-remove-pages').addEventListener('click', model.clearSignaturesOnSelected)

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

const describeSize = (n) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

const chosenName = () => model.getOutputName().trim() || defaultOutputName(model.getSources())

// Everything the builder needs, in one place.
function exportOptions(pages, firstNumber, totalPages) {
  return {
    pages,
    sources: model.getSources(),
    numbering: model.getNumbering(),
    watermark: model.getWatermark(),
    rasterize: rasterizeRedacted,
    signatures: new Map(signatures.listSignatures().map((sig) => [sig.id, sig])),
    metadata: model.getMetadata(),
    // Encryption must be the LAST thing done to the file. Flattening re-opens
    // the built file to render its pages, which is impossible once it is
    // locked — so when a flatten is coming, the password is applied by that
    // step instead (see finish()), not here.
    protection: model.getFlatten().enabled ? null : model.getProtection(),
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
    format: flatten.format,
    onProgress: (page, total) => setStatus(`Flattening page ${page} of ${total}...`),
  })

  // Carry the bookmarks across, positioned within this set of pages.
  const bookmarks = pages.flatMap((page, pageIndex) =>
    page.bookmarks.map((b) => ({ ...b, pageIndex })),
  )

  return buildFlattened(images, model.getMetadata(), bookmarks, model.getProtection())
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
    setStatus(`Saved ${name} — ${describeSize(bytes.length)}`)
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

    // Positions of the entries that will be top level in the saved file.
    const topLevel = model.getBookmarks().filter((b) => b.effectiveLevel === 1).map((b) => b.position)
    const starts = splitStarts(all, mode, model.isSelected, topLevel)

    if (starts.length < 2) {
      // This has to go in the banner, not the status line: refreshControls
      // rewrites the status with the document summary the moment the save
      // finishes, so the explanation vanished and pressing Split appeared to
      // do nothing at all.
      showError(
        mode === 'bookmarks'
          ? 'Nothing to split. This document has fewer than two top-level bookmarks, '
            + 'so there is nowhere to cut it. Add bookmarks, or split one file per page.'
          : 'Nothing to split. Select the pages where a new file should start.',
      )
      return
    }

    // Splitting at bookmarks names each file after its bookmark, which is far
    // more use than part-001 when the pieces are separate documents.
    const titleAt = new Map(
      model.getBookmarks().filter((b) => b.effectiveLevel === 1).map((b) => [b.position, b.title]),
    )

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

      const title = mode === 'bookmarks' ? titleAt.get(from) : null
      files.push({
        name: safeFileName(
          title
            ? `${String(part + 1).padStart(2, '0')} ${title}`
            : `${base}-${String(part + 1).padStart(3, '0')}`,
        ),
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

el('share-action').addEventListener('click', () => {
  runSave(el('share-action'), 'Preparing to share', async () => {
    const pages = model.getPages()
    const numbering = model.getNumbering()
    const bytes = await finish(await buildPdf(
      exportOptions(pages, numbering.start, numbering.start + pages.length - 1),
    ), pages)

    try {
      await shareBytes(bytes, safeFileName(chosenName()), 'Try FresherPDFs.com')
      setStatus('Shared.')
    } catch (error) {
      // Dismissing the share sheet counts as an error; that is not a failure.
      if (error.name === 'AbortError') return setStatus('Sharing cancelled.')
      throw error
    }
  })
})

// Double-clicking a page opens the viewer; redaction is reached from there or
// from the toolbar.
el('error-dismiss').addEventListener('click', clearError)
el('home-link').addEventListener('click', goToLanding)

// The security explainer, reachable from the landing page and from the chip
// in the top bar while you are working.
const securityDialog = document.querySelector('#security-dialog')
el('secure-chip').addEventListener('click', () => securityDialog.showModal())

// The front pages draw their own "How local processing works" links and open
// the dialog themselves, so there is no fixed button to bind here.

el('files-chip').addEventListener('click', () => {
  const panel = el('panel-files')
  panel.open = true
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
})
el('security-close').addEventListener('click', () => securityDialog.close())
el('open-pro').addEventListener('click', () => goToTool('pro'))

// The address bar is the single source of truth for which tool is open, so
// the back button and bookmarked links work without any extra code.
window.addEventListener('hashchange', applyRoute)

setupDragDrop(openViewer)
setupRedactor()
setupSearch()
setupViewer(openRedactor)
setupSigner()
setupPlacer()
setupFileList()
setupBookmarks(openViewer)
drawFileList()
drawFileStrip()
drawBookmarks()

// Restore whatever settings were in use last time, then fall back to reading
// the untouched defaults out of the page.
// --- the phone's action bar -------------------------------------------------
//
// Narrow screens put the actions that matter within thumb reach. The existing
// buttons are MOVED into the bar and moved back, rather than copied, so there
// is exactly one of each and every listener on them survives untouched.

const MOBILE_BAR_IDS = ['undo', 'redo', 'share-action', 'primary-action']

// Each button leaves a marker behind in the header, so it can always be put
// back exactly where it was. Remembering a neighbouring BUTTON instead was the
// bug: the neighbours move too, so insertBefore threw and took the rest of
// refreshControls down with it — leaving a stale status line behind.
const mobileAnchors = new Map()

function placeMobileBar() {
  const bar = el('mobile-bar')
  const narrow = window.matchMedia('(max-width: 700px)').matches
  const working = !el('app-workspace').hidden
  const toBar = narrow && working

  for (const id of MOBILE_BAR_IDS) {
    const button = el(id)

    if (!mobileAnchors.has(id)) {
      const marker = document.createComment(`home of ${id}`)
      button.parentElement.insertBefore(marker, button)
      mobileAnchors.set(id, marker)
    }

    if (toBar) {
      if (button.parentElement !== bar) bar.append(button)
    } else if (button.parentElement === bar) {
      const marker = mobileAnchors.get(id)
      marker.parentElement.insertBefore(button, marker.nextSibling)
    }
  }

  bar.hidden = !toBar
  document.body.classList.toggle('has-mobile-bar', toBar)
}

window.addEventListener('resize', placeMobileBar)

setupLanding()
drawLanding()
applySettings(presets.recallLastUsed(), { restoreEnabled: false })
readNumbering()
readWatermark()
readMetadata()
readFlatten()
readProtection()
drawPresetList()
applyRoute()
