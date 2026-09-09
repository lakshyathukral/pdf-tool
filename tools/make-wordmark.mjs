// Turn the wordmark into SVG outlines.
//
// A logo set in a font only looks right on machines that have that font.
// Converting it to paths makes it identical everywhere — and, unlike loading a
// webfont, costs no network request, which matters on a page that promises
// not to make any.
import fs from 'node:fs'
import opentype from 'opentype.js'

const SIZE = 100          // arbitrary; the SVG is scaled by its viewBox
const [file, indexArg] = process.argv.slice(2)

const bytes = fs.readFileSync(file)
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))

// Two words, two colours, so they need separate paths — placed by advancing
// the second by the width of the first.
const first = 'Fresher'
const second = 'PDFs'
const gap = font.getAdvanceWidth(first, SIZE)

const pathA = font.getPath(first, 0, 0, SIZE)
const pathB = font.getPath(second, gap, 0, SIZE)

const boxes = [pathA.getBoundingBox(), pathB.getBoundingBox()]
const minX = Math.min(...boxes.map((b) => b.x1))
const minY = Math.min(...boxes.map((b) => b.y1))
const maxX = Math.max(...boxes.map((b) => b.x2))
const maxY = Math.max(...boxes.map((b) => b.y2))

const pad = 2
const view = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2]
  .map((n) => Math.round(n * 100) / 100)
  .join(' ')

// opentype's own toPathData emits NaN for some commands — the commands
// themselves are fine, its serialiser is not — and SVG abandons a path at the
// first unparseable number, so the wordmark rendered only its first glyph or
// two. Writing the data out here is a dozen lines and cannot go wrong quietly.
const n = (v) => {
  if (!Number.isFinite(v)) throw new Error(`non-finite coordinate: ${v}`)
  return String(Math.round(v * 10) / 10)
}

function toPathData(path) {
  return path.commands
    .map((c) => {
      switch (c.type) {
        case 'M': return `M${n(c.x)} ${n(c.y)}`
        case 'L': return `L${n(c.x)} ${n(c.y)}`
        case 'Q': return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
        case 'C': return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
        case 'Z': return 'Z'
        default: throw new Error(`unknown path command: ${c.type}`)
      }
    })
    .join('')
}

console.log(JSON.stringify({
  index: Number(indexArg ?? 0),
  viewBox: view,
  aspect: Math.round(((maxX - minX + pad * 2) / (maxY - minY + pad * 2)) * 100) / 100,
  ink: toPathData(pathA),
  brass: toPathData(pathB),
}, null, 0))
