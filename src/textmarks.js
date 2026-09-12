// ---------------------------------------------------------------------------
// textmarks.js — the arithmetic behind "Add text on pages", shared by the
// preview and the exporter so what you see is what prints.
//
// No DOM, no pdf-lib. A text mark on a page looks like:
//   { group, text, x, y, anchor, size, font, bold, italic, colour, box }
//
// x and y are fractions of the page as displayed, from the top-left, and say
// where the ANCHOR point of the text's box sits. For 'top-right' that is the
// box's top-right corner — so "Annexure P-10" grows leftwards, away from the
// edge, and stays on the page where "Annexure P-9" was.
// size is in points. box is 'none', 'outline' or 'filled'.
// ---------------------------------------------------------------------------

export const ANCHORS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

// [across, down] as 0, 0.5 or 1.
export function anchorFractions(anchor = 'top-right') {
  const [vertical, horizontal] = anchor.split('-')
  return [
    horizontal === 'left' ? 0 : horizontal === 'center' ? 0.5 : 1,
    vertical === 'top' ? 0 : vertical === 'middle' ? 0.5 : 1,
  ]
}

// Half an inch in from the edge, the same as a page number.
const EDGE_POINTS = 36

// Where a corner of the grid puts the text on a page of the given size.
export function anchorPoint(anchor, pointsWide, pointsHigh) {
  const [ax, ay] = anchorFractions(anchor)
  const mx = Math.min(0.2, EDGE_POINTS / pointsWide)
  const my = Math.min(0.2, EDGE_POINTS / pointsHigh)
  return {
    x: ax === 0 ? mx : ax === 1 ? 1 - mx : 0.5,
    y: ay === 0 ? my : ay === 1 ? 1 - my : 0.5,
  }
}

export const COLOURS = {
  black: { name: 'Black', css: '#000000', rgb: [0, 0, 0] },
  // A watermark's usual colour: it should sit behind the words, not shout.
  grey: { name: 'Grey', css: '#666666', rgb: [0.4, 0.4, 0.4] },
  blue: { name: 'Blue', css: '#1d3f9e', rgb: [29 / 255, 63 / 255, 158 / 255] },
  red: { name: 'Red', css: '#b91c1c', rgb: [185 / 255, 28 / 255, 28 / 255] },
}

export const colourOf = (name) => COLOURS[name] ?? COLOURS.black

// The box's proportions, in ems. The preview's stylesheet uses the same
// numbers (.text-mark in style.css), so change both or neither.
export const LINE_HEIGHT = 1.25
export const PAD_X = 0.35
export const PAD_Y = 0.12

export const borderWidth = (size) => Math.max(0.75, size * 0.07)

// The box around one line of text, in points. ascent and descent are the
// font's own, as fractions of its size (descent is negative). A browser
// centres the letters within the line exactly this way, which is why the
// baseline is worked out like this rather than as "one size down from the top".
export function boxGeometry(textWidth, size, ascent, descent) {
  const line = LINE_HEIGHT * size
  return {
    width: textWidth + 2 * PAD_X * size,
    height: line + 2 * PAD_Y * size,
    baseline: PAD_Y * size + (line - (ascent - descent) * size) / 2 + ascent * size,
    inset: PAD_X * size,
  }
}

// --- automatic numbering ---------------------------------------------------

export const NUMBER_STYLES = ['1', 'A', 'I', 'i']

const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export function formatCounter(n, style = '1') {
  if (!Number.isInteger(n) || n < 1) return String(n)

  if (style === 'A') {
    // After Z comes AA, as in a spreadsheet, so a long bundle never runs out.
    let letters = ''
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
      letters = String.fromCharCode(65 + ((k - 1) % 26)) + letters
    }
    return letters
  }

  if (style === 'I' || style === 'i') {
    let roman = ''
    let k = n
    for (const [value, symbol] of ROMAN) {
      while (k >= value) { roman += symbol; k -= value }
    }
    return style === 'i' ? roman.toLowerCase() : roman
  }

  return String(n)
}

// The opposite of formatCounter: what someone typed in "Start at", read in the
// chosen style, so a lettered list can start at "C" rather than at 3. Returns
// null for anything that is not a number in that style.
export function parseCounter(typed, style = '1') {
  const value = String(typed ?? '').trim()
  if (value === '') return null

  if (style === 'A') {
    if (!/^[A-Za-z]+$/.test(value)) return null
    let n = 0
    for (const letter of value.toUpperCase()) n = n * 26 + (letter.charCodeAt(0) - 64)
    return n
  }

  if (style === 'I' || style === 'i') {
    if (!/^[IVXLCDM]+$/i.test(value)) return null
    const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
    const digits = [...value.toUpperCase()].map((c) => numerals[c])
    const n = digits.reduce((sum, d, i) => sum + (d < (digits[i + 1] ?? 0) ? -d : d), 0)
    // "IIII" or "VX" add up to something, but are not how anyone writes it.
    return n >= 1 && formatCounter(n, 'I') === value.toUpperCase() ? n : null
  }

  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n >= 1 ? n : null
}

// "Annexure" and "P-" with 3 gives "Annexure P-3". Either part may be empty.
export function numberedText({ word = '', prefix = '', style = '1' }, n) {
  return [word.trim(), `${prefix.trim()}${formatCounter(n, style)}`].filter(Boolean).join(' ')
}

// --- page numbers ------------------------------------------------------------

// Page numbers are drawn exactly like added text, so they get the same fonts,
// boxes and dragging. What differs: the words come from the page's place in
// the document, and each page can move its number or leave it off.
export const PAGE_NUMBER = 'page-number'

export function numberMark(numbering, page, text) {
  if (page.numberHidden) return null
  const own = page.numberSpot
  return {
    group: PAGE_NUMBER,
    text,
    // Settings saved before numbers could be placed only had a corner.
    anchor: own?.anchor ?? numbering.anchor ?? numbering.position ?? 'bottom-right',
    x: own ? own.x : numbering.x ?? null,
    y: own ? own.y : numbering.y ?? null,
    size: numbering.size ?? 10,
    font: numbering.font ?? 'arial',
    bold: Boolean(numbering.bold),
    italic: Boolean(numbering.italic),
    colour: numbering.colour ?? 'black',
    box: numbering.box ?? 'none',
  }
}

// A mark without an x and y sits at its grid spot, worked out for the size of
// the page it is on — so a number stays half an inch in on any page size.
export function resolveSpot(mark, pointsWide, pointsHigh) {
  if (Number.isFinite(mark.x) && Number.isFinite(mark.y)) return mark
  return { ...mark, ...anchorPoint(mark.anchor, pointsWide, pointsHigh) }
}

// How many of these pages use up a number. All of them, unless hidden pages
// are set not to count — so numbering can start at 1 after a cover page.
export function countedPages(numbering, pages) {
  return numbering.countHidden === false ? pages.filter((page) => !page.numberHidden).length : pages.length
}

export const lastPageNumber = (numbering, pages) => numbering.start + countedPages(numbering, pages) - 1

// --- Hindi words ---------------------------------------------------------------

// A font cannot translate: choosing Hindi for "Certified True Copy" still
// shows English. These are the words the site itself suggests, in the form
// used in Indian court documents, so one tap can switch them.
const HINDI_WORDS = [
  [/\bcertified true copy\b/gi, 'प्रमाणित सत्य प्रतिलिपि'],
  [/\bwithout prejudice\b/gi, 'बिना किसी पूर्वाग्रह के'],
  [/\bfor verification only\b/gi, 'केवल सत्यापन हेतु'],
  [/\bconfidential\b/gi, 'गोपनीय'],
  [/\bannexure\b/gi, 'अनुलग्नक'],
  [/\bexhibit\b/gi, 'प्रदर्श'],
  [/\bdraft\b/gi, 'मसौदा'],
  [/\bcopy\b/gi, 'प्रतिलिपि'],
  [/\bpage\b/gi, 'पृष्ठ'],
  [/\bP-/g, 'पी-'],
  [/\bR-/g, 'आर-'],
]

// The words in Hindi, or null if any English would be left over: half-English,
// half-Hindi reads worse than either.
export function toHindiWords(text) {
  const original = String(text ?? '')
  let out = original
  for (const [pattern, hindi] of HINDI_WORDS) out = out.replace(pattern, hindi)
  return out !== original && !/[A-Za-z]/.test(out) ? out : null
}

export const hasHindiLetters = (text) => /[ऀ-ॿ]/.test(String(text ?? ''))
