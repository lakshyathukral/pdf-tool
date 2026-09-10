// ---------------------------------------------------------------------------
// find.js — locating a phrase in a page's text.
//
// A PDF does not store words. It stores runs of glyphs at positions, and a
// heading like "Page One - Claim" comes back from pdf.js as seven separate
// items: "Page", " ", "One", " ", "-", " ", "Claim". So a phrase has to be
// stitched back together before it can be searched for, and each match then
// mapped back to the items it covers in order to know where it sits.
//
// Deliberately pure: it takes plain text items and returns plain rectangles,
// with no pdf.js and no DOM, so the awkward part can be tested directly.
// ---------------------------------------------------------------------------

// A pdf.js text item is { str, width, height, transform: [a, b, c, d, e, f] }
// where e and f are the x and y of the item's baseline in PDF user space, which
// counts UP from the bottom-left. Everything this app stores counts DOWN from
// the top-left, so y is flipped at the end.

// Boxes are grown by this many points on each side. Position within an item is
// estimated from its average character width — a PDF does not record where each
// glyph sits — so a little padding stops a descender or an italic sticking out.
const PAD = 1.5

// Characters that should not stop a phrase from matching. A PDF may hold a
// non-breaking space or a soft hyphen where a reader sees an ordinary one.
function normalise(text, matchCase) {
  const flattened = text
    .replace(/ /g, ' ')     // non-breaking space
    .replace(/­/g, '')      // soft hyphen, invisible where it does not break
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
  return matchCase ? flattened : flattened.toLowerCase()
}

// Join the items into one string, remembering which item each character came
// from and how far into that item it sat.
function joinItems(items) {
  let text = ''
  const map = []

  for (const [index, item] of items.entries()) {
    const str = item.str ?? ''
    for (let offset = 0; offset < str.length; offset++) map.push({ index, offset })
    text += str

    // pdf.js marks the end of a visual line. Without a break here, the last
    // word of one line and the first of the next would run together and match
    // phrases that are not really there.
    if (item.hasEOL) {
      map.push({ index, offset: str.length })
      text += '\n'
    }
  }

  return { text, map }
}

// The rectangle covering characters [from, to) of one item, in PDF user space.
function boxForRun(item, from, to) {
  const str = item.str ?? ''
  if (str.length === 0) return null

  const [scaleX, , , , x, y] = item.transform
  const perChar = (item.width ?? 0) / str.length
  const height = item.height || Math.abs(scaleX) || 0
  if (!Number.isFinite(perChar) || !Number.isFinite(x) || !Number.isFinite(y)) return null

  const start = Math.max(0, Math.min(from, str.length))
  const end = Math.max(start, Math.min(to, str.length))

  return {
    left: x + perChar * start,
    right: x + perChar * end,
    bottom: y,
    top: y + height,
  }
}

// One match can straddle several items and, when a phrase wraps, several lines.
// Runs on the same line are merged into one rectangle; a new line starts a new
// one, so a wrapped phrase is covered by a box per line rather than one giant
// rectangle swallowing everything in between.
function mergeIntoLines(boxes) {
  const lines = []

  for (const box of boxes) {
    // Same line if the baselines are within half a line height of each other.
    const tolerance = Math.max(1, (box.top - box.bottom) * 0.5)
    const line = lines.find((l) => Math.abs(l.bottom - box.bottom) <= tolerance)

    if (line) {
      line.left = Math.min(line.left, box.left)
      line.right = Math.max(line.right, box.right)
      line.top = Math.max(line.top, box.top)
      line.bottom = Math.min(line.bottom, box.bottom)
    } else {
      lines.push({ ...box })
    }
  }

  return lines
}

/**
 * Find every occurrence of `needle` in one page's text items.
 *
 * `pageWidth` and `pageHeight` are the page's size in PDF points. Returned
 * rectangles are fractions of the page measured from the TOP-left, the same
 * convention as a hand-drawn redaction box, so the two are interchangeable.
 *
 * Each match carries `rects` — usually one, more when the phrase wraps across
 * a line — and `context`, the surrounding words, so a person can see what they
 * are about to destroy before agreeing to it.
 */
export function findMatches(items, pageWidth, pageHeight, needle, { matchCase = false } = {}) {
  const phrase = (needle ?? '').trim()
  if (phrase === '' || !pageWidth || !pageHeight) return []

  const { text, map } = joinItems(items)
  const haystack = normalise(text, matchCase)
  const pin = normalise(phrase, matchCase)
  if (pin === '') return []

  const matches = []
  let at = haystack.indexOf(pin)

  while (at !== -1) {
    // Group the matched characters by the item they came from, so each item is
    // measured once rather than once per character.
    const runs = new Map()
    for (let i = at; i < at + pin.length; i++) {
      const entry = map[i]
      if (!entry) continue
      const run = runs.get(entry.index)
      if (run) {
        run.from = Math.min(run.from, entry.offset)
        run.to = Math.max(run.to, entry.offset + 1)
      } else {
        runs.set(entry.index, { from: entry.offset, to: entry.offset + 1 })
      }
    }

    const boxes = []
    for (const [index, run] of runs) {
      const box = boxForRun(items[index], run.from, run.to)
      if (box && box.right > box.left) boxes.push(box)
    }

    if (boxes.length > 0) {
      const rects = mergeIntoLines(boxes).map((line) => ({
        x: (line.left - PAD) / pageWidth,
        y: (pageHeight - line.top - PAD) / pageHeight,
        w: (line.right - line.left + PAD * 2) / pageWidth,
        h: (line.top - line.bottom + PAD * 2) / pageHeight,
      }))

      matches.push({
        rects: rects.map(clampRect).filter((r) => r.w > 0 && r.h > 0),
        context: contextAround(text, at, pin.length),
      })
    }

    // +1 rather than +length, so overlapping occurrences are all found.
    at = haystack.indexOf(pin, at + 1)
  }

  return matches.filter((m) => m.rects.length > 0)
}

// Keep a padded box inside the page.
function clampRect(rect) {
  const x = Math.max(0, Math.min(1, rect.x))
  const y = Math.max(0, Math.min(1, rect.y))
  return {
    x,
    y,
    w: Math.max(0, Math.min(1 - x, rect.w)),
    h: Math.max(0, Math.min(1 - y, rect.h)),
  }
}

// The matched words with a little either side, for the review list.
export function contextAround(text, at, length, span = 28) {
  const before = text.slice(Math.max(0, at - span), at)
  const middle = text.slice(at, at + length)
  const after = text.slice(at + length, at + length + span)

  const tidy = (s) => s.replace(/\s+/g, ' ')
  return {
    before: (at > span ? '…' : '') + tidy(before),
    match: tidy(middle),
    after: tidy(after) + (at + length + span < text.length ? '…' : ''),
  }
}
