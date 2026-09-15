// ---------------------------------------------------------------------------
// scan-worker.js — turning a photo of a page into something like a scan.
//
// Runs in a worker because OpenCV is heavy: finding and flattening a page from
// a phone photo takes long enough to freeze a page on a phone otherwise.
// Nothing leaves the device: OpenCV is loaded from this site, and every pixel
// is processed here.
//
// The steps and their settings were tuned on a test set of 48 phone photos of
// pages with known text (see docs/open-decisions.md):
//   find the page  — the largest four-cornered outline in a downscaled copy
//   flatten        — undo the camera angle, at the photo's own resolution
//   clean          — lightly denoise, then divide out the uneven lighting
//   black & white  — a threshold that adapts to each area of the page
// ---------------------------------------------------------------------------

import cvModule from '@techstark/opencv-js'

let cvPromise = null

// OpenCV 5 finishes starting up after it loads; wait for it.
function openCv() {
  cvPromise ??= (async () => {
    if (cvModule instanceof Promise) return cvModule
    if (cvModule.Mat) return cvModule
    await new Promise((resolve) => { cvModule.onRuntimeInitialized = resolve })
    return cvModule
  })()
  return cvPromise
}

const DETECT_LONG_SIDE = 900
const MIN_WIDTH = 1654       // about 200 dpi across an A4 page
const MAX_WIDTH = 2480       // about 300 dpi; more only makes files heavier
const TRIM = 0.012           // shave the page edge, which reads as a stray line

// Free every OpenCV matrix made during a step, however it ends.
function withMats(cv, work) {
  const made = []
  const keep = (mat) => { made.push(mat); return mat }
  try {
    return work(keep)
  } finally {
    for (const mat of made) if (!mat.isDeleted()) mat.delete()
  }
}

function rgbaMat(cv, keep, width, height, buffer) {
  const mat = keep(new cv.Mat(height, width, cv.CV_8UC4))
  mat.data.set(new Uint8Array(buffer))
  return mat
}

// Top-left, top-right, bottom-right, bottom-left.
function order(points) {
  const sum = points.map((p) => p[0] + p[1])
  const diff = points.map((p) => p[1] - p[0])
  const at = (values, pick) => points[values.indexOf(pick(...values))]
  return [at(sum, Math.min), at(diff, Math.min), at(sum, Math.max), at(diff, Math.max)]
}

function detect(cv, { width, height, buffer }) {
  return withMats(cv, (keep) => {
    const src = rgbaMat(cv, keep, width, height, buffer)
    const scale = DETECT_LONG_SIDE / Math.max(width, height)
    const small = keep(new cv.Mat())
    cv.resize(src, small, new cv.Size(Math.round(width * scale), Math.round(height * scale)), 0, 0, cv.INTER_AREA)

    const gray = keep(new cv.Mat())
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    const edges = keep(new cv.Mat())
    cv.Canny(gray, edges, 40, 120)
    const kernel = keep(cv.Mat.ones(5, 5, cv.CV_8U))
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2)

    const contours = new cv.MatVector()
    const hierarchy = keep(new cv.Mat())
    try {
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      const area = small.rows * small.cols
      const shapes = []
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i)
        shapes.push({ c, a: cv.contourArea(c) })
      }
      shapes.sort((x, y) => y.a - x.a)

      for (const { c } of shapes.slice(0, 6)) {
        const hull = keep(new cv.Mat())
        cv.convexHull(c, hull, false, true)
        const approx = keep(new cv.Mat())
        cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true)
        if (approx.rows === 4 && cv.contourArea(approx) > 0.2 * area) {
          const points = []
          for (let j = 0; j < 4; j++) points.push([approx.data32S[j * 2] / scale, approx.data32S[j * 2 + 1] / scale])
          for (const s of shapes) s.c.delete()
          return order(points)
        }
      }
      for (const s of shapes) s.c.delete()
      return null
    } finally {
      contours.delete()
    }
  })
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function process(cv, { width, height, buffer, corners, look, outWidth }) {
  return withMats(cv, (keep) => {
    const src = rgbaMat(cv, keep, width, height, buffer)
    const [tl, tr, br, bl] = corners
    const pageW = Math.max(distance(tl, tr), distance(bl, br))
    const pageH = Math.max(distance(tl, bl), distance(tr, br))
    const w = Math.round(outWidth ?? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pageW)))
    const h = Math.round(pageH * (w / pageW))

    const from = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [...tl, ...tr, ...br, ...bl]))
    const to = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]))
    const matrix = keep(cv.getPerspectiveTransform(from, to))
    const flat = keep(new cv.Mat())
    cv.warpPerspective(src, flat, matrix, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar())

    const t = Math.round(w * TRIM)
    const page = keep(flat.roi(new cv.Rect(t, t, w - 2 * t, h - 2 * t)).clone())

    let out = page
    if (look !== 'original') {
      const gray = keep(new cv.Mat())
      cv.cvtColor(page, gray, cv.COLOR_RGBA2GRAY)
      // A light denoise first, so the paper's grain is not mistaken for ink.
      if (typeof cv.fastNlMeansDenoising === 'function') {
        const quiet = keep(new cv.Mat())
        cv.fastNlMeansDenoising(gray, quiet, 7, 7, 21)
        quiet.copyTo(gray)
      }
      // The page's lighting, found by spreading the paper over the ink; the
      // page divided by it comes out evenly lit, shadows and all.
      const background = keep(new cv.Mat())
      cv.dilate(gray, background, keep(cv.Mat.ones(7, 7, cv.CV_8U)))
      cv.medianBlur(background, background, 41)
      const evened = keep(new cv.Mat())
      cv.divide(gray, background, evened, 255)

      const result = keep(new cv.Mat())
      if (look === 'bw') {
        cv.GaussianBlur(evened, evened, new cv.Size(3, 3), 0)
        cv.adaptiveThreshold(evened, result, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 15)
      } else {
        cv.normalize(evened, result, 0, 255, cv.NORM_MINMAX)
      }
      out = keep(new cv.Mat())
      cv.cvtColor(result, out, cv.COLOR_GRAY2RGBA)
    }

    const pixels = new Uint8ClampedArray(out.data)   // a copy, safe to transfer
    return { width: out.cols, height: out.rows, buffer: pixels.buffer }
  })
}

self.onmessage = async ({ data }) => {
  const { id, type } = data
  try {
    const cv = await openCv()
    if (type === 'ready') return self.postMessage({ id, ok: true })
    if (type === 'detect') return self.postMessage({ id, ok: true, corners: detect(cv, data) })
    if (type === 'process') {
      const result = process(cv, data)
      return self.postMessage({ id, ok: true, ...result }, [result.buffer])
    }
    throw new Error(`Unknown request: ${type}`)
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) })
  }
}
