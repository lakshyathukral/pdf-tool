// Reading a produced PDF back the way a reader would — the only way to know an
// export is actually correct rather than merely not throwing.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const { PDFDocument } = require('@cantoo/pdf-lib')

const standardFontDataUrl = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href

export async function open(bytes, password) {
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    standardFontDataUrl,
    password,
  }).promise
}

// Whether a saved file asks for a password, and whether a given one opens it.
// The only honest way to check that "keep", "change" and "remove" did what
// they said: read the file back the way a reader would.
export async function passwordOf(bytes) {
  try {
    await open(bytes)
    return { needsPassword: false }
  } catch (error) {
    if (!/password/i.test(error?.message ?? '')) throw error
    return { needsPassword: true }
  }
}

export async function opensWith(bytes, password) {
  try {
    await open(bytes, password)
    return true
  } catch {
    return false
  }
}

export async function textOfEachPage(bytes) {
  const pdf = await open(bytes)
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const items = (await page.getTextContent()).items
    out.push(items.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim())
  }
  return out
}

export async function rotations(bytes) {
  const pdf = await open(bytes)
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) out.push((await pdf.getPage(i)).rotate)
  return out
}

// The bookmark tree, flattened to "level:title@page" so it is easy to assert.
export async function outline(bytes) {
  const pdf = await open(bytes)
  const items = await pdf.getOutline()
  if (!items) return []

  const found = []
  const walk = async (list, level) => {
    for (const item of list) {
      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      const page = dest?.[0] ? (await pdf.getPageIndex(dest[0])) + 1 : null
      found.push(`${level}:${item.title}@${page}`)
      if (item.items?.length) await walk(item.items, level + 1)
    }
  }
  await walk(items, 1)
  return found
}

// Where a piece of text sits, as a fraction of the page the reader sees.
export async function positionOf(bytes, pageNumber, match) {
  const pdf = await open(bytes)
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const item = (await page.getTextContent()).items.find((t) => match.test(t.str))
  if (!item) return null

  const [a, b, c, d, e, f] = viewport.transform
  const x = a * item.transform[4] + c * item.transform[5] + e
  const y = b * item.transform[4] + d * item.transform[5] + f
  return {
    horizontal: x < viewport.width / 3 ? 'left' : x > (viewport.width * 2) / 3 ? 'right' : 'centre',
    vertical: y < viewport.height / 3 ? 'top' : y > (viewport.height * 2) / 3 ? 'bottom' : 'middle',
  }
}

// The CENTRE of a piece of text, as a fraction of the page.
//
// positionOf reports where text STARTS — its baseline anchor. For large
// rotated text like a watermark the anchor sits well away from the middle, so
// asserting on it would fail on correct output. This walks half the text's
// width along its own baseline and half its height perpendicular to that.
export async function centreOf(bytes, pageNumber, match) {
  const pdf = await open(bytes)
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const item = (await page.getTextContent()).items.find((t) => match.test(t.str))
  if (!item) return null

  const [a, b] = item.transform
  const length = Math.hypot(a, b)
  const alongX = a / length
  const alongY = b / length
  const halfHeight = item.height / 2

  const cx = item.transform[4] + (item.width / 2) * alongX - halfHeight * alongY
  const cy = item.transform[5] + (item.width / 2) * alongY + halfHeight * alongX

  const [t0, t1, t2, t3, t4, t5] = viewport.transform
  return {
    x: (t0 * cx + t2 * cy + t4) / viewport.width,
    y: (t1 * cx + t3 * cy + t5) / viewport.height,
  }
}

export async function metadata(bytes) {
  // updateMetadata:false so reading the file does not rewrite it — pdf-lib
  // stamps its own Producer on load otherwise, which quietly fakes a pass.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return {
    title: doc.getTitle(),
    author: doc.getAuthor(),
    producer: doc.getProducer(),
    raw: Buffer.from(bytes).toString('latin1'),
  }
}
