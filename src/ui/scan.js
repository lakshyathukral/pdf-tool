// ---------------------------------------------------------------------------
// ui/scan.js — "Tidy up your photos": crop, straighten and clean phone photos
// of documents before they become pages.
//
// Every photo that comes in goes through here, so Photos to PDF, Add a
// watermark and Add photos in the Control Room all get the same treatment.
// Pages of a PDF that turn out to be photos come through here too, from the
// OCR panel, since a straight, clean page reads far better.
// The work happens in scan-worker.js; this file is the screen.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id)

const PROCESS_LONG_SIDE = 2600   // photos are worked on at this size at most
const PREVIEW_WIDTH = 760
const LOOK_TILE_WIDTH = 220
const READING_WIDTH = 1400       // wide enough to read, small enough to be quick
const LOOKS = ['original', 'clean', 'bw']
const LOUPE_ZOOM = 3
const LOUPE_SIZE = 120            // on screen, in CSS pixels (see .scan-loupe)

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

function whiteCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  return canvas
}

// At most PROCESS_LONG_SIDE on its longer side, on white.
function fitted(source, width, height) {
  const scale = Math.min(1, PROCESS_LONG_SIDE / Math.max(width, height))
  const canvas = whiteCanvas(Math.round(width * scale), Math.round(height * scale))
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function readPhoto(file) {
  // from-image honours the camera's orientation, so a sideways shot is upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = fitted(bitmap, bitmap.width, bitmap.height)
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

async function processPhoto(photo, { look = photo.look, outWidth } = {}) {
  const data = pixels(photo.canvas)
  const result = await call('process', {
    width: data.width, height: data.height, buffer: data.data.buffer,
    corners: photo.corners, look, outWidth,
  }, [data.data.buffer])
  return toCanvas(result)
}

// The last look at a picture where no page was found: what the drawing itself
// looked like, which tells a blank or broken page apart from a faint edge.
export let lastPicture = null

async function findCorners(canvas) {
  const data = pixels(canvas)
  const { corners, picture } = await call('detect', { width: data.width, height: data.height, buffer: data.data.buffer }, [data.data.buffer])
  if (!corners) {
    lastPicture = picture
    // Nothing was drawn at all: some browser builds fail to draw a picture
    // inside a PDF. Worth knowing when working out why nothing was found.
    window.__blankPage = picture?.variation === 0
  }
  return corners
}

const polygonArea = (points) => Math.abs(points.reduce((sum, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length]
  return sum + x * ny - nx * y
}, 0)) / 2

// Whether a page of a PDF is a photo of a document rather than a scan: its
// edges can be found, and the paper does not fill the picture. A flatbed scan
// fills it edge to edge.
export async function looksLikePhoto(canvas) {
  const corners = await findCorners(canvas)
  if (!corners) return false
  return polygonArea(corners) < 0.88 * canvas.width * canvas.height
}

// --- the screen ---------------------------------------------------------------

const dialog = () => $('scan-dialog')
let photos = []
let index = 0
let previewToken = 0
let drag = null
let options = {}

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
  if (img.dataset.for !== photo.key) {
    img.src = photo.canvas.toDataURL('image/jpeg', 0.85)
    img.dataset.for = photo.key
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
  // The same number for the stylesheet, which limits the height on a phone.
  stage.style.setProperty('--ratio', (photo.canvas.width / photo.canvas.height).toFixed(4))

  $('scan-note').textContent = describe(photo)
  $('scan-counter').textContent = photos.length > 1 ? `${options.noun ?? 'Photo'} ${index + 1} of ${photos.length}` : ''
  $('scan-prev').hidden = photos.length < 2
  $('scan-next').hidden = photos.length < 2
  $('scan-prev').disabled = index === 0
  $('scan-next').disabled = index === photos.length - 1
  $('scan-all-looks').hidden = photos.length < 2
  $('scan-reset').disabled = photo.found === null

  for (const button of $('scan-looks').querySelectorAll('button')) {
    const look = button.dataset.look
    button.setAttribute('aria-pressed', String(look === photo.look))
    const tile = button.querySelector('img')
    if (!photo.tiles[look]) tile.removeAttribute('src')
    else if (tile.getAttribute('src') !== photo.tiles[look]) tile.src = photo.tiles[look]
    button.querySelector('.scan-best').hidden = photo.reading?.best !== look
  }
  drawReadingNote(photo)
  $('scan-apply').textContent = options.applyLabel?.(photos.length)
    ?? (photos.length === 1 ? 'Add this page' : `Add ${photos.length} pages`)
}

function drawReadingNote(photo) {
  const note = $('scan-reading')
  const reading = photo.reading
  $('scan-check-reading').hidden = Boolean(reading)
  if (!reading) note.textContent = ''
  else if (reading.checking) note.textContent = 'Checking which look reads best…'
  else if (reading.failed) note.textContent = 'Could not check how well it reads. Any look can still be used.'
  else if (reading.best) note.textContent = `${lookName(reading.best)} reads best for this page.`
  else note.textContent = 'No words could be read in any look.'
}

const lookName = (look) => ({ original: 'Original', clean: 'Clean', bw: 'Black and white' })[look]

// The look tiles and the larger result, redrawn whenever the edges change.
async function drawPreview() {
  const token = ++previewToken
  const photo = photos[index]
  const box = $('scan-result')
  box.classList.add('working')
  try {
    const canvas = await processPhoto(photo, { outWidth: PREVIEW_WIDTH })
    if (token !== previewToken) return
    $('scan-result-image').src = canvas.toDataURL('image/jpeg', 0.8)
    box.classList.remove('working')

    for (const look of LOOKS) {
      if (photo.tiles[look]) continue
      const tile = await processPhoto(photo, { look, outWidth: LOOK_TILE_WIDTH })
      if (token !== previewToken) return
      photo.tiles[look] = tile.toDataURL('image/jpeg', 0.8)
      drawStage()
    }

    if (options.bestForReading && !photo.reading) await checkReading(photo, token)
  } catch (error) {
    if (token !== previewToken) return
    box.classList.remove('working')
    $('scan-note').textContent = `The preview could not be made: ${error.message}`
  }
}

// Read the page in each look and say which reads best. With bestForReading on,
// that look is chosen, unless one was already picked by hand.
async function checkReading(photo, token = previewToken) {
  photo.reading = { checking: true }
  drawStage()
  try {
    const { readingScore } = await import('../ocr.js')
    const scores = {}
    for (const look of LOOKS) {
      const canvas = await processPhoto(photo, { look, outWidth: READING_WIDTH })
      if (!photo.reading?.checking) return   // the edges moved: start again later
      scores[look] = await readingScore(canvas)
    }
    if (!photo.reading?.checking) return
    const best = LOOKS.reduce((a, b) => (scores[b] > scores[a] ? b : a))
    photo.reading = { scores, best: scores[best] > 0 ? best : null }
    if (photo.reading.best && !photo.pickedLook) {
      photo.look = photo.reading.best
      if (photo === photos[index] && token === previewToken) drawPreviewOfLook(photo)
    }
  } catch (error) {
    console.error(error)
    photo.reading = { failed: true }
  }
  if (photo === photos[index]) drawStage()
}

async function drawPreviewOfLook(photo) {
  const canvas = await processPhoto(photo, { outWidth: PREVIEW_WIDTH })
  if (photo === photos[index]) $('scan-result-image').src = canvas.toDataURL('image/jpeg', 0.8)
}

// Edges changed: every look and the reading need doing again.
function edgesChanged(photo) {
  photo.tiles = {}
  photo.reading = null
  drawStage()
  drawPreview()
}

async function detectPhoto(photo) {
  const corners = await findCorners(photo.canvas)
  photo.found = Boolean(corners)
  photo.detected = corners ?? wholeImage(photo.canvas)
  photo.corners = photo.detected.map((p) => [...p])
  // Not a document, as far as can be told: leave the photo looking like a photo.
  if (!photo.pickedLook) photo.look = corners ? 'clean' : 'original'
}

function show(i) {
  index = Math.max(0, Math.min(photos.length - 1, i))
  drawStage()
  if (photos[index].found !== null) drawPreview()
}

// --- turning a photo a quarter turn ------------------------------------------------

// Clockwise: a point (x, y) lands at (height - y, x), and the corner that was
// bottom left becomes top left.
function rotatePhoto(photo) {
  const { canvas } = photo
  const turned = whiteCanvas(canvas.height, canvas.width)
  const ctx = turned.getContext('2d')
  ctx.translate(canvas.height, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(canvas, 0, 0)

  const move = ([x, y]) => [canvas.height - y, x]
  const turn = ([tl, tr, br, bl]) => [move(bl), move(tl), move(tr), move(br)]
  photo.canvas = turned
  photo.corners = turn(photo.corners)
  photo.detected = turn(photo.detected)
  photo.key = `${photo.key.split('@')[0]}@${(Number(photo.key.split('@')[1] ?? 0) + 1) % 4}`
}

// --- dragging a corner, with a magnifier ------------------------------------------

function pointFromEvent(event) {
  const svg = $('scan-outline')
  const box = svg.getBoundingClientRect()
  const photo = photos[index]
  return [
    Math.max(0, Math.min(photo.canvas.width, ((event.clientX - box.left) / box.width) * photo.canvas.width)),
    Math.max(0, Math.min(photo.canvas.height, ((event.clientY - box.top) / box.height) * photo.canvas.height)),
  ]
}

// A round close-up of the photo around the corner being dragged, drawn above
// and to the side of the finger so the finger does not hide it.
function drawLoupe(point) {
  const loupe = $('scan-loupe')
  const photo = photos[index]
  const stage = $('scan-stage').getBoundingClientRect()
  const shown = stage.width / photo.canvas.width        // screen pixels per photo pixel
  const size = loupe.width
  // The photo pixels that fit in the loupe, three times closer than the stage.
  const across = LOUPE_SIZE / LOUPE_ZOOM / shown
  const half = across / 2

  const ctx = loupe.getContext('2d')
  ctx.save()
  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#d6d3d1'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(photo.canvas, point[0] - half, point[1] - half, across, across, 0, 0, size, size)

  // The outline and the exact spot.
  const toLoupe = ([x, y]) => [((x - point[0]) / across + 0.5) * size, ((y - point[1]) / across + 0.5) * size]
  ctx.strokeStyle = '#2a5db0'
  ctx.lineWidth = 3
  ctx.beginPath()
  photo.corners.forEach((corner, i) => {
    const [x, y] = toLoupe(corner)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.stroke()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(size / 2 - 18, size / 2); ctx.lineTo(size / 2 + 18, size / 2)
  ctx.moveTo(size / 2, size / 2 - 18); ctx.lineTo(size / 2, size / 2 + 18)
  ctx.stroke()
  ctx.strokeStyle = '#be123c'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = '#2a5db0'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  ctx.stroke()

  // Placed as a fraction of the stage: up and away from the corner being
  // dragged, flipped when that would run off the photo.
  const fx = point[0] / photo.canvas.width
  const fy = point[1] / photo.canvas.height
  const loupeFraction = LOUPE_SIZE / stage.width
  const gap = 0.06
  let left = fx < 0.5 ? fx + gap : fx - gap - loupeFraction
  let top = fy - gap - loupeFraction * (stage.width / stage.height)
  if (top < 0) top = fy + gap
  left = Math.max(0, Math.min(1 - loupeFraction, left))
  loupe.style.left = `${left * 100}%`
  loupe.style.top = `${top * 100}%`
  loupe.hidden = false
}

function setUpHandles() {
  const svg = $('scan-outline')
  svg.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('circle')
    if (!handle) return
    drag = Number(handle.dataset.corner)
    svg.setPointerCapture(event.pointerId)
    event.preventDefault()
    drawLoupe(photos[index].corners[drag])
  })
  svg.addEventListener('pointermove', (event) => {
    if (drag === null) return
    const point = pointFromEvent(event)
    photos[index].corners[drag] = point
    drawStage()
    drawLoupe(point)
  })
  const end = () => {
    if (drag === null) return
    drag = null
    $('scan-loupe').hidden = true
    edgesChanged(photos[index])
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
}

let resolveScan = null

function finish(result) {
  const done = resolveScan
  resolveScan = null
  previewToken++
  for (const photo of photos) if (photo.reading?.checking) photo.reading = null
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
    const photo = photos[index]
    photo.look = button.dataset.look
    photo.pickedLook = true
    drawStage()
    drawPreviewOfLook(photo).catch(() => {})
  })

  $('scan-all-looks').addEventListener('click', () => {
    for (const photo of photos) {
      photo.look = photos[index].look
      photo.pickedLook = true
    }
    drawStage()
  })

  $('scan-rotate').addEventListener('click', () => {
    const photo = photos[index]
    if (!photo) return
    rotatePhoto(photo)
    edgesChanged(photo)
  })

  $('scan-reset').addEventListener('click', () => {
    const photo = photos[index]
    if (!photo?.detected) return
    photo.corners = photo.detected.map((p) => [...p])
    edgesChanged(photo)
  })

  $('scan-check-reading').addEventListener('click', () => {
    const photo = photos[index]
    if (photo && photo.found !== null) checkReading(photo)
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
        $('scan-note').textContent = `Tidying ${(options.noun ?? 'photo').toLowerCase()} ${i + 1} of ${photos.length}…`
        const canvas = await processPhoto(photo)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
        files.push(new File([blob], photo.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
      }
      finish(files)
    } catch (error) {
      $('scan-note').textContent = `Tidying failed: ${error.message}. You can still use them as they are.`
    } finally {
      button.disabled = false
    }
  })
}

// Show the screen. items: [{ canvas, name }]. Resolves with tidied files,
// 'as-taken' to keep the originals, or null if cancelled.
//   bestForReading: check which look reads best, and choose it
//   noun, title, hint, skipLabel, applyLabel: the words, when these are
//   pages of a PDF rather than photos
async function openScanner(items, opts = {}) {
  options = opts
  photos = items.map((item, i) => ({
    ...item, key: `${Date.now()}-${i}`, corners: wholeImage(item.canvas), detected: null,
    found: null, look: 'original', pickedLook: false, tiles: {}, reading: null,
  }))
  index = 0
  resolveScan = null
  $('scan-title').textContent = opts.title ?? 'Tidy up your photos'
  $('scan-title').nextElementSibling.textContent = opts.hint
    ?? 'Drag the corners onto the edges of the page. It is straightened and cleaned up, on this device.'
  $('scan-skip').textContent = opts.skipLabel ?? 'Use photos as they are'
  $('scan-note').textContent = 'Getting the scanner ready…'
  $('scan-reading').textContent = ''
  $('scan-result-image').removeAttribute('src')
  $('scan-photo').removeAttribute('src')
  $('scan-photo').dataset.for = ''
  $('scan-apply').disabled = false

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
    $('scan-note').textContent = `The scanner could not start (${error.message}). You can still use them as they are.`
    $('scan-apply').disabled = true
  }
  return result
}

export async function scanPhotos(files, opts = {}) {
  const items = []
  for (const file of files) items.push(await readPhoto(file))
  return openScanner(items, opts)
}

// Pages of a PDF, already drawn: [{ canvas, name }].
export function scanPages(pages, opts = {}) {
  return openScanner(pages.map(({ canvas, name }) => ({ canvas: fitted(canvas, canvas.width, canvas.height), name })), opts)
}
