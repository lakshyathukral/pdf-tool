import { describe, it, expect } from 'vitest'
import { parsePageRanges, formatPageRanges } from '../src/ranges.js'

// Positions are 0-based internally; these read in page numbers for legibility.
const pages = (text, total = 20) => parsePageRanges(text, total).map((i) => i + 1)

describe('parsePageRanges', () => {
  it('reads a list of ranges and single pages', () => {
    expect(pages('1-5, 12, 18-20')).toEqual([1, 2, 3, 4, 5, 12, 18, 19, 20])
  })

  it('tolerates stray spaces and empty items', () => {
    expect(pages(' 4 - 7 ')).toEqual([4, 5, 6, 7])
    expect(pages('1-3,,5')).toEqual([1, 2, 3, 5])
  })

  it('reads a backwards range rather than rejecting it', () => {
    expect(pages('10-8')).toEqual([8, 9, 10])
  })

  it('accepts an en-dash, which is what Word autocorrect produces', () => {
    expect(pages('2–4')).toEqual([2, 3, 4])
  })

  it('handles open-ended ranges at either end', () => {
    expect(pages('18-')).toEqual([18, 19, 20])
    expect(pages('-3')).toEqual([1, 2, 3])
  })

  it('trims to the document rather than erroring', () => {
    expect(pages('18-999')).toEqual([18, 19, 20])
  })

  it('returns nothing for input that means nothing', () => {
    expect(pages('')).toEqual([])
    expect(pages('abc')).toEqual([])
  })

  it('never repeats a page when ranges overlap', () => {
    expect(pages('1-5, 3-7')).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('formatPageRanges', () => {
  it('collapses runs and leaves singles alone', () => {
    expect(formatPageRanges([0, 1, 2, 4, 7, 8, 9])).toBe('1-3, 5, 8-10')
  })

  it('sorts before formatting', () => {
    expect(formatPageRanges([5, 3, 1])).toBe('2, 4, 6')
  })

  it('is empty for an empty selection', () => {
    expect(formatPageRanges([])).toBe('')
  })

  it('round-trips through the parser', () => {
    const text = '1-3, 7, 9-10'
    expect(formatPageRanges(parsePageRanges(text, 20))).toBe(text)
  })
})
