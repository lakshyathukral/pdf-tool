import { describe, expect, test } from 'vitest'
import { findMatches } from '../src/find.js'

// A page 600 points wide and 800 tall, to keep the arithmetic easy to read.
const W = 600
const H = 800

// Build a pdf.js-shaped text item. `x` and `y` are in PDF user space, counting
// UP from the bottom-left, which is what pdf.js reports.
function item(str, { x = 0, y = 700, size = 10, hasEOL = false } = {}) {
  return {
    str,
    width: str.length * size * 0.5,       // a plausible average character width
    height: size,
    transform: [size, 0, 0, size, x, y],
    hasEOL,
  }
}

// pdf.js hands back a heading like "Page One" as separate fragments, which is
// the whole reason this module exists.
const fragments = [
  item('Page', { x: 20, y: 700 }),
  item(' ', { x: 40, y: 700 }),
  item('One', { x: 43, y: 700 }),
  item(' ', { x: 58, y: 700 }),
  item('-', { x: 61, y: 700 }),
  item(' ', { x: 66, y: 700 }),
  item('Claim', { x: 69, y: 700 }),
]

const find = (items, needle, options) => findMatches(items, W, H, needle, options)

describe('finding a phrase', () => {
  test('finds a word that sits inside one fragment', () => {
    const matches = find(fragments, 'Claim')
    expect(matches).toHaveLength(1)
    expect(matches[0].rects).toHaveLength(1)
  })

  test('finds a phrase split across several fragments', () => {
    const matches = find(fragments, 'Page One')
    expect(matches).toHaveLength(1)

    // The box must start at the "P" and end after the "e" of One, not run to
    // the end of the line.
    const [rect] = matches[0].rects
    expect(rect.x * W).toBeCloseTo(20 - 1.5, 0)
    expect((rect.x + rect.w) * W).toBeCloseTo(58 + 1.5, 0)
  })

  test('measures a box from the top of the page, like a drawn one', () => {
    const [match] = find(fragments, 'Claim')
    const [rect] = match.rects

    // Baseline 700 with a 10pt line in an 800pt page: the top of the text is
    // 90 points down from the top edge.
    expect(rect.y * H).toBeCloseTo(800 - 710 - 1.5, 0)
    expect(rect.h * H).toBeCloseTo(10 + 3, 0)
  })

  test('ignores case unless asked not to', () => {
    expect(find(fragments, 'claim')).toHaveLength(1)
    expect(find(fragments, 'claim', { matchCase: true })).toHaveLength(0)
    expect(find(fragments, 'Claim', { matchCase: true })).toHaveLength(1)
  })

  test('finds every occurrence, not just the first', () => {
    const items = [
      item('Smith', { x: 20 }),
      item(' and ', { x: 50 }),
      item('Smith', { x: 80 }),
    ]
    expect(find(items, 'Smith')).toHaveLength(2)
  })

  test('finds overlapping occurrences', () => {
    expect(find([item('aaaa', { x: 20 })], 'aa')).toHaveLength(3)
  })

  test('returns nothing for an empty or blank search', () => {
    expect(find(fragments, '')).toEqual([])
    expect(find(fragments, '   ')).toEqual([])
    expect(find(fragments, undefined)).toEqual([])
  })

  test('returns nothing for a page with no text at all', () => {
    expect(find([], 'anything')).toEqual([])
  })

  test('treats a non-breaking space as an ordinary one', () => {
    const items = [item('Account No', { x: 20 })]
    expect(find(items, 'Account No')).toHaveLength(1)
  })

  test('does not match across a line break', () => {
    const items = [
      item('the end', { x: 20, y: 700, hasEOL: true }),
      item('of it', { x: 20, y: 680 }),
    ]
    // "end of" only looks contiguous if the line break is ignored.
    expect(find(items, 'end of')).toHaveLength(0)
    expect(find(items, 'the end')).toHaveLength(1)
  })

  test('covers a wrapped phrase with one box per line, not one giant box', () => {
    const items = [
      item('Mr John', { x: 400, y: 700 }),
      item('Smith', { x: 20, y: 680 }),
    ]
    const matches = find(items, 'Mr JohnSmith')
    expect(matches).toHaveLength(1)
    expect(matches[0].rects).toHaveLength(2)

    // Neither box may swallow the whole width of the page between the lines.
    for (const rect of matches[0].rects) expect(rect.w).toBeLessThan(0.5)
  })

  test('keeps a padded box inside the page', () => {
    const items = [item('Edge', { x: 0, y: 795 })]
    for (const rect of find(items, 'Edge')[0].rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(1)
      expect(rect.y + rect.h).toBeLessThanOrEqual(1)
    }
  })

  test('reports the surrounding words so a person can check the match', () => {
    const items = [item('Paid to Mr Smith on Tuesday', { x: 20 })]
    const [match] = find(items, 'Smith')

    expect(match.context.match).toBe('Smith')
    expect(match.context.before).toContain('Paid to Mr')
    expect(match.context.after).toContain('Tuesday')
  })

  test('survives an item with no width without producing a broken box', () => {
    const items = [
      { str: 'Odd', width: 0, height: 0, transform: [0, 0, 0, 0, 10, 700] },
      item('Name', { x: 40 }),
    ]
    const matches = find(items, 'Name')
    expect(matches).toHaveLength(1)
    for (const rect of matches[0].rects) {
      expect(Number.isFinite(rect.x)).toBe(true)
      expect(rect.w).toBeGreaterThan(0)
    }
  })
})
