// ---------------------------------------------------------------------------
// images.js — photographs into a PDF.
//
// Each picture becomes a page. The result is handed to the rest of the app as
// an ordinary PDF, so reordering, bookmarks, redaction and export all work on
// it without knowing photographs were ever involved.
// ---------------------------------------------------------------------------

import { PDFDocument } from '@cantoo/pdf-lib'

// Page sizes in PDF points (72 per inch).
export const PAGE_SIZES = {
  a4: { name: 'A4', width: 595.28, height: 841.89 },
  letter: { name: 'Letter', width: 612, height: 792 },
}

// A phone photograph is far more detail than a document page needs, and a
// dozen of them at full resolution makes a PDF nobody can email.
const MAX_EDGE = 2200
const JPEG_QUALITY = 0.85

// Draw the picture to a canvas, which does three jobs at once: it applies the
// rotation recorded by the camera, it converts formats the PDF cannot hold
// (an iPhone's HEIC), and it shrinks the image to a sensible size.
async function normalise(file) {
  let bitmap
  try {
    // from-image honours the EXIF orientation, so a photo taken sideways is
    // not stored sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`"${file.name}" could not be read as an image.`)
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  // JPEG has no transparency; without this a PNG with a clear background
  // would come out black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error(`"${file.name}" was too large to process.`)

  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

// Where the picture sits on the page: as large as it can be without being
// stretched, centred, with the page turned to match a landscape photo.
function layout(image, pageSize) {
  if (!pageSize) {
    // "Match the photo": the page IS the picture, at 72 dpi-equivalent points.
    return { pageWidth: image.width, pageHeight: image.height, x: 0, y: 0, width: image.width, height: image.height }
  }

  const landscape = image.width > image.height
  const pageWidth = landscape ? pageSize.height : pageSize.width
  const pageHeight = landscape ? pageSize.width : pageSize.height

  const scale = Math.min(pageWidth / image.width, pageHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale

  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  }
}

export async function pdfFromImages(files, { pageSize = PAGE_SIZES.a4, onProgress } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setProducer('')
  doc.setCreator('')

  let done = 0
  for (const file of files) {
    const image = await normalise(file)
    const embedded = await doc.embedJpg(image.bytes)
    const box = layout(image, pageSize)

    const page = doc.addPage([box.pageWidth, box.pageHeight])
    page.drawImage(embedded, { x: box.x, y: box.y, width: box.width, height: box.height })

    onProgress?.(++done, files.length)
  }

  return doc.save()
}
