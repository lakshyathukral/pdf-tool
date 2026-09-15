// ---------------------------------------------------------------------------
// ui/scan.js — "Tidy up your photos": crop, straighten and clean phone photos
// of documents before they become pages.
//
// Every photo that comes in goes through here, so Photos to PDF, Add a
// watermark and Add photos in the Control Room all get the same treatment.
// The work happens in scan-worker.js; this file is the screen.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id)

const PROCESS_LONG_SIDE = 2600   // photos are worked on at this size at most
const PREVIEW_WIDTH = 760

let worker = null
let nextId = 1
const pending = new Map()

function call(type, payload = {}, transfer = []) {
  worker ??= createWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, type, ...payload }, transfer)
  })
}

function createWorker() {
  const w = new Worker(new URL('../scan-worker.js', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }) => {
    const job = pending.get(data.id)
    if (!job) return
    pending.delete(data.id)
    if (data.ok) job.resolve(data)
    else job.reject(new Error(data.error))
  }
  w.onerror = (event) => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'The scanner could not start.'))
    pending.clear()
  }
  return w
}

// --- reading a photo ----------------------------------------------------------

async function readPhoto(file) {
  // from-image honours the camera's orientation, so a sideways shot is upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, PROCESS_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return { canvas, name: file.name }
}

const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
const wholeImage = (canvas) => [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]]

function toCanvas({ width, height, buffer }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0)
  return canvas
}

async function processPhoto(photo, { outWidth } = {}) {
  const data = pixels(photo.canvas)
  const result = await call('process', {
    width: data.width, height: data.height, buffer: data.data.buffer,
    corners: photo.corners, look: photo.look, outWidth,
  }, [data.data.buffer])
  return toCanvas(result)
}

// --- the screen ---------------------------------------------------------------

const dialog = () => $('scan-dialog')
let photos = []
let index = 0
let previewToken = 0
let drag = null

function describe(photo) {
  if (photo.found === null) return 'Looking for the page…'
  return photo.found
    ? 'Page found. Drag the corners if they are not quite on its edges.'
    : 'No page edges found, so the whole photo is kept. Drag the corners to crop it.'
}

function drawStage() {
  const photo = photos[index]
  const stage = $('scan-stage')
  const img = $('scan-photo')
  if (img.dataset.for !== String(index)) {
    img.src = photo.canvas.toDataURL('image/jpeg', 0.85)
    img.dataset.for = String(index)
  }
  const svg = $('scan-outline')
  svg.setAttribute('viewBox', `0 0 ${photo.canvas.width} ${photo.canvas.height}`)
  const pts = photo.corners.map((p) => p.join(',')).join(' ')
  svg.querySelector('polygon').setAttribute('points', pts)
  const radius = Math.max(photo.canvas.width, photo.canvas.height) * 0.018
  svg.querySelectorAll('circle').forEach((handle, i) => {
    handle.setAttribute('cx', photo.corners[i][0])
    handle.setAttribute('cy', photo.corners[i][1])
    handle.setAttribute('r', radius)
  })
  stage.style.aspectRatio = `${photo.canvas.width} / ${photo.canvas.height}`

  $('scan-note').textContent = describe(photo)
  $('scan-counter').textContent = photos.length > 1 ? `Photo ${index + 1} of ${photos.length}` : ''
  $('scan-prev').hidden = photos.length < 2
  $('scan-next').hidden = photos.length < 2
  $('scan-prev').disabled = index === 0
  $('scan-next').disabled = index === photos.length - 1
  $('scan-all-looks').hidden = photos.length < 2
  for (const button of $('scan-looks').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.look === photo.look))
  }
  $('scan-apply').textContent = photos.length === 1 ? 'Add this page' : `Add ${photos.length} pages`
}

async function drawPreview() {
  const token = ++previewToken
  const photo = photos[index]
  const box = $('scan-result')
  box.classList.add('working')
  try {
    const canvas = await processPhoto(photo, { outWidth: PREVIEW_WIDTH })
    if (token !== previewToken) return
    const img = $('scan-result-image')
    img.src = canvas.toDataURL('image/jpeg', 0.8)
    box.classList.remove('working')
  } catch (error) {
    if (token !== previewToken) return
    box.classList.remove('working')
    $('scan-note').textContent = `The preview could not be made: ${error.message}`
  }
}

async function detectPhoto(photo) {
  const data = pixels(photo.canvas)
  const { corners } = await call('detect', { width: data.width, height: data.height, buffer: data.data.buffer }, [data.data.buffer])
  photo.found = Boolean(corners)
  photo.corners = corners ?? wholeImage(photo.canvas)
  // Not a document, as far as can be told: leave the photo looking like a photo.
  photo.look = corners ? 'clean' : 'original'
}

function show(i) {
  index = Math.max(0, Math.min(photos.length - 1, i))
  drawStage()
  if (photos[index].found !== null) drawPreview()
}

function pointFromEvent(event) {
  const svg = $('scan-outline')
  const box = svg.getBoundingClientRect()
  const photo = photos[index]
  return [
    Math.max(0, Math.min(photo.canvas.width, ((event.clientX - box.left) / box.width) * photo.canvas.width)),
    Math.max(0, Math.min(photo.canvas.height, ((event.clientY - box.top) / box.height) * photo.canvas.height)),
  ]
}

function setUpHandles() {
  const svg = $('scan-outline')
  svg.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('circle')
    if (!handle) return
    drag = Number(handle.dataset.corner)
    svg.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  svg.addEventListener('pointermove', (event) => {
    if (drag === null) return
    photos[index].corners[drag] = pointFromEvent(event)
    drawStage()
  })
  const end = () => {
    if (drag === null) return
    drag = null
    drawPreview()
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
}

let resolveScan = null

function finish(result) {
  const done = resolveScan
  resolveScan = null
  dialog().close()
  done?.(result)
}

export function setupScanner() {
  setUpHandles()
  $('scan-prev').addEventListener('click', () => show(index - 1))
  $('scan-next').addEventListener('click', () => show(index + 1))

  $('scan-looks').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-look]')
    if (!button) return
    photos[index].look = button.dataset.look
    drawStage()
    drawPreview()
  })

  $('scan-all-looks').addEventListener('click', () => {
    for (const photo of photos) photo.look = photos[index].look
    drawStage()
  })

  // Keep the photos exactly as taken.
  $('scan-skip').addEventListener('click', () => finish('as-taken'))
  $('scan-cancel').addEventListener('click', () => finish(null))
  dialog().addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })

  $('scan-apply').addEventListener('click', async () => {
    const button = $('scan-apply')
    button.disabled = true
    try {
      const files = []
      for (const [i, photo] of photos.entries()) {
        $('scan-note').textContent = `Tidying photo ${i + 1} of ${photos.length}…`
        const canvas = await processPhoto(photo)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
        files.push(new File([blob], photo.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
      }
      finish(files)
    } catch (error) {
      $('scan-note').textContent = `Tidying failed: ${error.message}. You can still use the photos as they are.`
    } finally {
      button.disabled = false
    }
  })
}

// Show the screen for these photos. Resolves with tidied files, 'as-taken' to
// keep the originals, or null if cancelled.
export async function scanPhotos(files) {
  photos = []
  index = 0
  resolveScan = null
  $('scan-note').textContent = 'Getting the scanner ready…'
  $('scan-result-image').removeAttribute('src')
  $('scan-photo').removeAttribute('src')
  $('scan-photo').dataset.for = ''

  for (const file of files) {
    const photo = await readPhoto(file)
    photos.push({ ...photo, corners: wholeImage(photo.canvas), found: null, look: 'original' })
  }

  const result = new Promise((resolve) => { resolveScan = resolve })
  dialog().showModal()
  drawStage()

  try {
    await call('ready')
    for (const photo of photos) {
      await detectPhoto(photo)
      if (photo === photos[index]) {
        drawStage()
        drawPreview()
      }
    }
  } catch (error) {
    $('scan-note').textContent = `The scanner could not start (${error.message}). You can still use the photos as they are.`
    $('scan-apply').disabled = true
  }
  return result
}
