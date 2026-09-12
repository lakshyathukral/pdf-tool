import { describe, it, expect } from 'vitest'
import { anchorFractions, anchorPoint, boxGeometry, formatCounter, numberedText, parseCounter, toHindiWords } from '../src/textmarks.js'

describe('automatic numbering', () => {
  it('counts in each style', () => {
    expect(['1', 'A', 'I', 'i'].map((style) => formatCounter(4, style))).toEqual(['4', 'D', 'IV', 'iv'])
  })

  it('carries on past Z the way a spreadsheet does', () => {
    expect(formatCounter(26, 'A')).toBe('Z')
    expect(formatCounter(27, 'A')).toBe('AA')
    expect(formatCounter(52, 'A')).toBe('AZ')
  })

  it('writes larger Roman numerals correctly', () => {
    expect(formatCounter(9, 'I')).toBe('IX')
    expect(formatCounter(14, 'i')).toBe('xiv')
    expect(formatCounter(40, 'I')).toBe('XL')
  })

  it('reads a starting point typed in the chosen style', () => {
    expect(parseCounter('C', 'A')).toBe(3)
    expect(parseCounter('aa', 'A')).toBe(27)
    expect(parseCounter('IV', 'I')).toBe(4)
    expect(parseCounter('xiv', 'i')).toBe(14)
    expect(parseCounter('12', '1')).toBe(12)
  })

  it('refuses a start that is not written in that style', () => {
    expect(parseCounter('1', 'A')).toBeNull()
    expect(parseCounter('IIII', 'I')).toBeNull()
    expect(parseCounter('C', '1')).toBeNull()
    expect(parseCounter('0', '1')).toBeNull()
    expect(parseCounter('', 'A')).toBeNull()
  })

  it('reads back everything it writes', () => {
    for (const style of ['1', 'A', 'I', 'i']) {
      for (const n of [1, 9, 26, 27, 49, 400]) expect(parseCounter(formatCounter(n, style), style)).toBe(n)
    }
  })

  it('puts the word, the part before the number, and the number together', () => {
    expect(numberedText({ word: 'Annexure', prefix: 'P-', style: '1' }, 3)).toBe('Annexure P-3')
    expect(numberedText({ word: 'Exhibit', prefix: '', style: 'A' }, 2)).toBe('Exhibit B')
    expect(numberedText({ word: '', prefix: 'R-', style: '1' }, 10)).toBe('R-10')
  })
})

describe('placing text', () => {
  it('reads the anchor as fractions across and down', () => {
    expect(anchorFractions('top-right')).toEqual([1, 0])
    expect(anchorFractions('middle-center')).toEqual([0.5, 0.5])
    expect(anchorFractions('bottom-left')).toEqual([0, 1])
  })

  it('sets a grid spot half an inch in from the edge', () => {
    const { x, y } = anchorPoint('top-right', 612, 792)
    expect(x).toBeCloseTo(1 - 36 / 612, 6)
    expect(y).toBeCloseTo(36 / 792, 6)
  })

  it('sizes the box from the text, with the baseline inside it', () => {
    const box = boxGeometry(100, 20, 0.9, -0.25)
    expect(box.width).toBeCloseTo(100 + 2 * 0.35 * 20, 6)
    expect(box.height).toBeCloseTo(1.25 * 20 + 2 * 0.12 * 20, 6)
    expect(box.baseline).toBeGreaterThan(0.9 * 20)
    expect(box.baseline).toBeLessThan(box.height)
  })
})

describe('Hindi words', () => {
  it('switches the suggested legal words', () => {
    expect(toHindiWords('Certified True Copy')).toBe('प्रमाणित सत्य प्रतिलिपि')
    expect(toHindiWords('Annexure P-3')).toBe('अनुलग्नक पी-3')
    expect(toHindiWords('CONFIDENTIAL')).toBe('गोपनीय')
  })

  it('refuses to leave English half-translated', () => {
    expect(toHindiWords('Received on 12 March')).toBeNull()
    expect(toHindiWords('Annexure to the reply')).toBeNull()
    expect(toHindiWords('')).toBeNull()
  })
})
