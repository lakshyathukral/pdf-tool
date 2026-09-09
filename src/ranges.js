// ---------------------------------------------------------------------------
// ranges.js — turning "1-5, 12, 20-30" into a list of pages.
//
// Pure text handling, kept on its own so it can be tested without a browser.
// ---------------------------------------------------------------------------

// Returns 0-based positions, in ascending order, with no duplicates.
// `total` is how many pages there are; anything beyond it is trimmed rather
// than rejected, so "1-999" means "everything" instead of an error.
export function parsePageRanges(text, total) {
  const positions = new Set()

  for (const part of String(text).split(/[,;]/)) {
    const piece = part.trim()
    if (!piece) continue

    // "12", "1-5", "1 - 5", "3-" (to the end), "-4" (from the start)
    const match = piece.match(/^(\d+)?\s*(?:[-–—]\s*(\d+)?)?$/)
    if (!match) continue

    const hasDash = /[-–—]/.test(piece)
    const first = match[1] ? Number(match[1]) : (hasDash ? 1 : null)
    const last = hasDash ? (match[2] ? Number(match[2]) : total) : first

    if (first === null || last === null) continue

    // "10-3" is read as 3 to 10 rather than treated as a mistake.
    const from = Math.max(1, Math.min(first, last))
    const to = Math.min(total, Math.max(first, last))

    for (let page = from; page <= to; page++) positions.add(page - 1)
  }

  return [...positions].sort((a, b) => a - b)
}

// The inverse: [0,1,2,4,7,8,9] -> "1-3, 5, 8-10". Used to show what is
// currently selected in the same language the box accepts.
export function formatPageRanges(positions) {
  const sorted = [...positions].sort((a, b) => a - b)
  if (sorted.length === 0) return ''

  const parts = []
  let runStart = sorted[0]
  let previous = sorted[0]

  for (const position of sorted.slice(1)) {
    if (position === previous + 1) {
      previous = position
      continue
    }
    parts.push(runStart === previous ? `${runStart + 1}` : `${runStart + 1}-${previous + 1}`)
    runStart = position
    previous = position
  }

  parts.push(runStart === previous ? `${runStart + 1}` : `${runStart + 1}-${previous + 1}`)
  return parts.join(', ')
}
