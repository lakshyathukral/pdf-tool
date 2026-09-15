// ---------------------------------------------------------------------------
// bundle.js — turning a set of files named Annexure 1 to Annexure 10 into one
// bundle: their order, the short label on the page, and the index.
//
// No DOM, no pdf.js, no pdf-lib: plain arithmetic, shared by the model, the
// panel and the exporter.
// ---------------------------------------------------------------------------

import { numberMark } from './textmarks.js'

// "Annexure 2" before "Annexure 10", which a plain sort gets the wrong way round.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareNames = (a, b) => collator.compare(a, b)

// The words that start a label in a court bundle.
const LABEL_WORDS = 'annexure|annex|exhibit|appendix|schedule|attachment|enclosure|tab|document|doc'

// "Annexure P-2 - Sale deed" -> "Annexure P-2". null when the name is already
// just a label, or does not start with one.
const LABEL = new RegExp(
  `^((?:${LABEL_WORDS})(?![a-z])\\.?\\s*(?:[a-z]{1,3}\\s*-\\s*)?(?:\\d+[a-z]?|[ivxlc]+|[a-z]{1,2})(?![a-z0-9])(?!\\s*-\\s*\\d))[\\s\\-_:.,()]+(\\S.*)$`,
  'i',
)

export function shortLabel(title) {
  const match = String(title ?? '').trim().match(LABEL)
  return match ? match[1].replace(/\s+/g, ' ').trim() : null
}

// What goes on the page for a file: its short label, or the whole name.
export const pageText = (title, mode) => (mode === 'short' && shortLabel(title)) || title

// [1, 2, 3, 5] -> "1-3, 5". Labels (page numbers as printed) run with them.
export function describeRanges(entries) {
  const runs = []
  for (const entry of entries) {
    const last = runs.at(-1)
    if (last && entry.position === last.end.position + 1) last.end = entry
    else runs.push({ start: entry, end: entry })
  }
  return runs
    .map(({ start, end }) => (start === end ? start.label : `${start.label}-${end.label}`))
    .join(', ')
}

// The rows of the index, for the pages in document order.
//   pages:      the document, as the model holds it
//   isIndex:    whether a page belongs to the index itself
//   indexPages: how many pages the index will have (it may be about to grow)
//   titleOf:    a file's name as it should read
//   numbering:  the page-number settings in effect, so the index quotes the
//               numbers as printed; when off, pages are counted from 1
//   formatNumber: how the exporter writes a page number, (numbering, n, total)
export function indexRows({ pages, isIndex, indexPages, titleOf, numbering, formatNumber }) {
  // The index's own pages, at the size it is about to be.
  // An index about to be added goes at the front.
  const laidOut = []
  let placedIndex = !pages.some(isIndex)
  if (placedIndex) for (let i = 0; i < indexPages; i++) laidOut.push({ sourceId: null, numberHidden: false, index: true })
  for (const page of pages) {
    if (!isIndex(page)) laidOut.push(page)
    else if (!placedIndex) {
      placedIndex = true
      for (let i = 0; i < indexPages; i++) laidOut.push({ ...page, index: true })
    }
  }

  const labels = new Map()
  if (numbering?.enabled) {
    const counted = numbering.countHidden === false ? laidOut.filter((page) => !page.numberHidden).length : laidOut.length
    const total = numbering.start + counted - 1
    let next = numbering.start
    laidOut.forEach((page, position) => {
      const mark = numberMark(numbering, page, String(next))
      labels.set(position, formatNumber(numbering, next, total))
      if (mark || numbering.countHidden !== false) next++
    })
  }

  const rows = new Map()
  laidOut.forEach((page, position) => {
    if (page.index || isIndex(page)) return
    if (!rows.has(page.sourceId)) rows.set(page.sourceId, { title: titleOf(page.sourceId), entries: [] })
    rows.get(page.sourceId).entries.push({ position, label: labels.get(position) ?? String(position + 1) })
  })

  return [...rows.values()].map((row, i) => ({
    number: i + 1,
    title: row.title,
    pages: describeRanges(row.entries),
  }))
}
