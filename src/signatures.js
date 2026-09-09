// ---------------------------------------------------------------------------
// signatures.js — the signature images themselves.
//
// Kept apart from the model for the same reason source PDFs are: they are
// large, they never change once added, and copying them into every undo
// snapshot would be wasteful. The model stores only WHERE a signature goes.
// ---------------------------------------------------------------------------

// id -> { id, name, bytes, mime, width, height, url }
const signatures = new Map()
let nextId = 1

export const listSignatures = () => [...signatures.values()]
export const getSignature = (id) => signatures.get(id)
export const hasSignatures = () => signatures.size > 0

// Load an image file, measure it, and keep the bytes for export.
export async function addSignature(file, { removeBackground = true } = {}) {
  const id = `sig${nextId++}`
  const url = URL.createObjectURL(file)

  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not read "${file.name}" as an image.`))
    img.src = url
  })

  // A photo of a signature on paper has an opaque background, which would
  // cover whatever it is placed over. Knocking the near-white pixels out makes
  // it behave like ink on the page rather than a sticker over it.
  const processed = removeBackground
    ? await knockOutBackground(image)
    : { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type }

  URL.revokeObjectURL(url)

  const entry = {
    id,
    name: file.name,
    bytes: processed.bytes,
    mime: processed.mime,
    width: image.naturalWidth,
    height: image.naturalHeight,
    url: URL.createObjectURL(new Blob([processed.bytes], { type: processed.mime })),
  }

  signatures.set(id, entry)
  return entry
}

export function removeSignature(id) {
  const entry = signatures.get(id)
  if (entry) URL.revokeObjectURL(entry.url)
  signatures.delete(id)
}

// Anything lighter than this on all three channels is treated as paper.
const WHITE_CUTOFF = 205

async function knockOutBackground(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = data.data

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]

    if (r > WHITE_CUTOFF && g > WHITE_CUTOFF && b > WHITE_CUTOFF) {
      pixels[i + 3] = 0  // fully transparent
    } else {
      // Fade the edges out in proportion to how pale they are, so the ink
      // keeps soft edges instead of a hard jagged outline.
      const lightest = Math.max(r, g, b)
      if (lightest > WHITE_CUTOFF - 60) {
        pixels[i + 3] = Math.round(255 * (1 - (lightest - (WHITE_CUTOFF - 60)) / 60))
      }
    }
  }

  ctx.putImageData(data, 0, 0)

  // PNG, always — it is the only common format with transparency.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
}
