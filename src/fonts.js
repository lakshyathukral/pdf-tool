// ---------------------------------------------------------------------------
// fonts.js — the typefaces text on pages can be written in, and their files.
//
// Every font ships with the site and loads from the same address as the page.
// Nothing is fetched from Google or anywhere else, so picking a font does not
// tell anyone what you are working on.
//
// The familiar Word fonts cannot be shipped, so each is a free look-alike:
// Tinos for Times New Roman, Carlito for Calibri, and so on.
//
// Each family comes in pieces by alphabet (latin, latin-ext, devanagari). The
// browser picks the right piece for each letter using unicode-range; the
// exporter does the same by hand, trying the pieces in the order given here.
// ---------------------------------------------------------------------------

import latinRanges from '@fontsource/tinos/unicode.json'
import devanagariRanges from '@fontsource/noto-sans-devanagari/unicode.json'

// WOFF rather than WOFF2: embedding a trimmed WOFF2 into a PDF produced a font
// the viewer could not read, and the page came out blank. WOFF embeds cleanly.
const FILES = import.meta.glob(
  '/node_modules/@fontsource/*/files/*-{latin,latin-ext,devanagari}-{400,700}-{normal,italic}.woff',
  { query: '?url', import: 'default', eager: true },
)

export const FONTS = [
  { id: 'times', name: 'Times New Roman', pkg: 'tinos', fallback: 'serif' },
  { id: 'arial', name: 'Arial', pkg: 'arimo', fallback: 'sans-serif' },
  { id: 'calibri', name: 'Calibri', pkg: 'carlito', fallback: 'sans-serif' },
  { id: 'cambria', name: 'Cambria', pkg: 'caladea', fallback: 'serif' },
  { id: 'georgia', name: 'Georgia', pkg: 'gelasio', fallback: 'serif' },
  { id: 'garamond', name: 'Garamond', pkg: 'eb-garamond', fallback: 'serif' },
  { id: 'courier', name: 'Courier New', pkg: 'cousine', fallback: 'monospace' },
  // Hindi letters first, then the Latin pieces for the digits and hyphen in
  // "अनुलग्नक पी-1", which the Devanagari piece does not contain.
  {
    id: 'hindi',
    name: 'Hindi',
    pkg: 'noto-sans-devanagari',
    fallback: 'sans-serif',
    subsets: ['devanagari', 'latin', 'latin-ext'],
    italic: false,
    sample: 'हिन्दी',
  },
]

export const DEFAULT_FONT = 'times'

export const getFont = (id) => FONTS.find((f) => f.id === id) ?? FONTS[0]
export const hasItalic = (id) => getFont(id).italic !== false
export const cssFamily = (id) => `"FP ${getFont(id).id}", ${getFont(id).fallback}`

const RANGES = {
  latin: latinRanges.latin,
  'latin-ext': latinRanges['latin-ext'],
  devanagari: devanagariRanges.devanagari,
}

function styleOf(font, bold, italic) {
  return {
    weight: bold ? 700 : 400,
    style: italic && font.italic !== false ? 'italic' : 'normal',
  }
}

// The files for one font in one weight and style, in the order to try them.
// `path` is where the file sits in the project; `url` is where the built site
// serves it from.
export function faceFiles(fontId, bold, italic) {
  const font = getFont(fontId)
  const { weight, style } = styleOf(font, bold, italic)

  const files = (font.subsets ?? ['latin', 'latin-ext']).map((subset) => {
    const path = `/node_modules/@fontsource/${font.pkg}/files/${font.pkg}-${subset}-${weight}-${style}.woff`
    return { subset, path, url: FILES[path] }
  })

  // Hindi letters typed while another font is chosen still print, in the Hindi
  // font, rather than as empty boxes. The browser picks the same face for the
  // preview, because it is registered under every family.
  if (font.id !== 'hindi') {
    const path = `/node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-${weight}-normal.woff`
    files.push({ subset: 'devanagari', path, url: FILES[path] })
  }

  return files.filter((file) => file.url)
}

// Tell the browser about every face. Nothing downloads until some text on
// screen actually uses one, so this costs nothing on a page with no text.
let registered = false

export function registerFontFaces() {
  if (registered || typeof FontFace === 'undefined') return
  registered = true

  for (const font of FONTS) {
    for (const bold of [false, true]) {
      for (const italic of font.italic === false ? [false] : [false, true]) {
        const { weight, style } = styleOf(font, bold, italic)
        for (const file of faceFiles(font.id, bold, italic)) {
          document.fonts.add(new FontFace(`FP ${font.id}`, `url("${file.url}") format("woff")`, {
            weight: String(weight),
            style,
            unicodeRange: RANGES[file.subset],
            display: 'swap',
          }))
        }
      }
    }
  }
}

// The font files' bytes, for embedding into the saved PDF.
const bytesByUrl = new Map()

export function loadFaceBytes(fontId, bold, italic) {
  return Promise.all(faceFiles(fontId, bold, italic).map((file) => {
    if (!bytesByUrl.has(file.url)) {
      const loading = fetch(file.url)
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load the ${getFont(fontId).name} font.`)
          return response.arrayBuffer()
        })
        .then((buffer) => new Uint8Array(buffer))
      // A failed load must not stay cached, or retrying could never work.
      loading.catch(() => bytesByUrl.delete(file.url))
      bytesByUrl.set(file.url, loading)
    }
    return bytesByUrl.get(file.url)
  }))
}
