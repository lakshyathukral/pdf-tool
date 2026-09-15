// ---------------------------------------------------------------------------
// ocr.js — reading the words on scanned pages, and laying them over those
// pages as invisible text, so a scan can be searched, selected and copied.
//
// The reader is Tesseract, English only, running on this device. Its worker,
// engine and language data are served by this site (see
// scripts/copy-ocr-assets.mjs); left to its defaults, tesseract.js would fetch
// them from a third-party CDN.
//
// Chosen on evidence: on English test pages with known text, Tesseract was the
// most consistent and the fastest of the open-source readers tried, and unlike
// the alternative it did not silently drop whole lines (docs/open-decisions.md).
// ---------------------------------------------------------------------------

import { createWorker, OEM, PSM } from 'tesseract.js'
import {
  PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, setTextRenderingMode, TextRenderingMode, showText,
} from '@cantoo/pdf-lib'
import { forEachScannedPage } from './render.js'

const asset = (path) => new URL(`ocr/${path}`, document.baseURI).href

// Below this confidence a page is read a second time, treating it as scattered
// text. That is what reads ruled tables; the more confident reading is kept.
const RETRY_BELOW = 75
// Pages read with less confidence than this are named in the result, so they
// can be checked by eye.
const WORTH_CHECKING_BELOW = 60

let workerPromise = null

function reader() {
  workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: asset('worker.min.js'),
    corePath: asset('core'),
    langPath: asset('lang'),
    workerBlobURL: false,
    gzip: true,
  }).then(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    return worker
  })
  // A failed start must not stay cached, or every later attempt fails too.
  workerPromise.catch(() => { workerPromise = null })
  return workerPromise
}

function wordsOf(data) {
  const words = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text?.trim()) words.push({ text: word.text.trim(), bbox: word.bbox })
        }
      }
    }
  }
  return words
}

async function read(worker, canvas) {
  const once = async (mode) => {
    await worker.setParameters({ tessedit_pageseg_mode: mode })
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
    return { confidence: data.confidence ?? 0, words: wordsOf(data) }
  }
  const first = await once(PSM.SINGLE_BLOCK)
  if (first.confidence >= RETRY_BELOW) return first
  const second = await once(PSM.SPARSE_TEXT)
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
  return second.confidence > first.confidence ? second : first
}

// Helvetica can only write Latin characters. Anything else is dropped from the
// invisible layer rather than stopping the whole file.
function encodable(font, text) {
  try {
    return font.encodeText(text)
  } catch {
    const latin = text.replace(/[^\x20-\x7E -ÿ]/g, '')
    if (!latin) return null
    try { return font.encodeText(latin) } catch { return null }
  }
}

// Lay each word over the pixels it was read from. The text matrix runs along
// the word's own baseline and up its own height, and stretches the word to its
// exact width, so selecting text highlights the right words — on rotated pages
// too, since toPdf already accounts for the rotation.
export function addTextLayer(page, font, words, toPdf) {
  const fontKey = page.node.newFontDictionary(font.name, font.ref)
  const operators = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
  let placed = 0

  for (const { text, bbox } of words) {
    const encoded = encodable(font, text)
    if (!encoded) continue

    const [bx, by] = toPdf(bbox.x0, bbox.y1)   // bottom left
    const [rx, ry] = toPdf(bbox.x1, bbox.y1)   // bottom right
    const [tx, ty] = toPdf(bbox.x0, bbox.y0)   // top left
    const width = Math.hypot(rx - bx, ry - by)
    const height = Math.hypot(tx - bx, ty - by)
    if (width < 0.5 || height < 0.5) continue

    const natural = font.widthOfTextAtSize(text, height)
    if (!natural) continue
    const stretch = width / natural
    const [ux, uy] = [(rx - bx) / width, (ry - by) / width]
    const [vx, vy] = [(tx - bx) / height, (ty - by) / height]

    operators.push(
      setFontAndSize(fontKey, height),
      setTextMatrix(ux * stretch, uy * stretch, vx, vy, bx, by),
      showText(encoded),
    )
    placed++
  }

  operators.push(endText(), popGraphicsState())
  if (placed > 0) page.pushOperators(...operators)
  return placed
}

// Make every scanned page of a finished PDF searchable.
// A word read from the picture that sits on text the page already has, so
// adding it again would make it appear twice when searched or copied.
function alreadyWritten(word, existingText) {
  const x = (word.bbox.x0 + word.bbox.x1) / 2
  const y = (word.bbox.y0 + word.bbox.y1) / 2
  const slack = (word.bbox.y1 - word.bbox.y0) / 2
  return existingText.some((box) =>
    x >= box.left - slack && x <= box.right + slack && y >= box.top - slack && y <= box.bottom + slack)
}

export async function makeSearchable(bytes, { protection = null, onProgress } = {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const summary = { total: pages.length, scanned: 0, alreadyText: 0, words: 0, worthChecking: [] }

  let worker = null

  await forEachScannedPage(bytes, {
    onPage: async ({ pageIndex, total, hasText, canvas, existingText, toPdf }) => {
      if (hasText) {
        summary.alreadyText++
        return
      }
      if (!worker) {
        onProgress?.({ stage: 'starting' })
        worker = await reader()
      }
      onProgress?.({ stage: 'reading', page: pageIndex + 1, total })

      const result = await read(worker, canvas)
      const newWords = result.words.filter((word) => !alreadyWritten(word, existingText))
      if (newWords.length === 0 && existingText.length > 0) {
        summary.alreadyText++
        return
      }
      summary.scanned++
      summary.words += addTextLayer(pages[pageIndex], font, newWords, toPdf)
      if (result.confidence < WORTH_CHECKING_BELOW) summary.worthChecking.push(pageIndex + 1)
    },
  })

  // A password goes on last: text cannot be added to a file once it is locked.
  if (protection?.enabled && protection.password) {
    doc.encrypt({ userPassword: protection.password, ownerPassword: protection.password })
  }

  return { bytes: await doc.save(), summary }
}
