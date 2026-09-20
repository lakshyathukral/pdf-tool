import { describe, it, expect } from 'vitest'
import { compareNames, shortLabel, pageText, describeRanges, indexRows } from '../src/bundle.js'

describe('number order', () => {
  it('puts Annexure 2 before Annexure 10', () => {
    const names = ['Annexure 1.pdf', 'Annexure 10.pdf', 'Annexure 2.pdf', 'Annexure 3 - Sale deed.pdf']
    expect([...names].sort(compareNames)).toEqual(['Annexure 1.pdf', 'Annexure 2.pdf', 'Annexure 3 - Sale deed.pdf', 'Annexure 10.pdf'])
  })
})

describe('the label in a long name', () => {
  it.each([
    ['Annexure 3 - Sale deed dated 18 August 2026', 'Annexure 3'],
    ['Annexure P-2 Legal notice', 'Annexure P-2'],
    ['Annexure A_Letter of 5 May', 'Annexure A'],
    ['Exhibit IV: Photographs', 'Exhibit IV'],
    ['annexure 10 (reply)', 'annexure 10'],
    ['Schedule 2 - Property', 'Schedule 2'],
  ])('%s -> %s', (title, label) => expect(shortLabel(title)).toBe(label))

  it.each([
    'Annexure 1',
    'Annexure P-10',
    'Exhibit A',
    'Sale deed',
    'Annexures to the plaint',
    'Documentary evidence',
  ])('%s has nothing to shorten', (title) => expect(shortLabel(title)).toBeNull())

  it('writes the label or the whole name, as chosen', () => {
    expect(pageText('Annexure 3 - Sale deed', 'short')).toBe('Annexure 3')
    expect(pageText('Annexure 3 - Sale deed', 'full')).toBe('Annexure 3 - Sale deed')
    expect(pageText('Sale deed', 'short')).toBe('Sale deed')
  })
})

describe('the index', () => {
  const at = (...positions) => positions.map((p) => ({ position: p, label: String(p + 1) }))

  it('joins pages that run on, and lists the rest', () => {
    expect(describeRanges(at(0, 1, 2))).toBe('1-3')
    expect(describeRanges(at(4))).toBe('5')
    expect(describeRanges(at(1, 2, 6))).toBe('2-3, 7')
  })

  const page = (sourceId, extra = {}) => ({ sourceId, numberHidden: false, ...extra })
  const titles = { a: 'Annexure 1', b: 'Annexure 2' }
  const base = {
    isIndex: (p) => p.sourceId === 'index',
    titleOf: (id) => titles[id],
    formatNumber: (numbering, n) => `${numbering.prefix}${n}`,
  }

  it('counts the index itself, at the length it is about to be', () => {
    const pages = [page('index'), page('a'), page('a'), page('b')]
    expect(indexRows({ ...base, pages, indexPages: 1, numbering: { enabled: false } })).toEqual([
      { number: 1, title: 'Annexure 1', pages: '2-3' },
      { number: 2, title: 'Annexure 2', pages: '4' },
    ])
    expect(indexRows({ ...base, pages, indexPages: 2, numbering: { enabled: false } })[1].pages).toBe('5')
  })

  it('quotes page numbers as they are printed', () => {
    const pages = [page('index'), page('a'), page('b'), page('b')]
    const numbering = { enabled: true, start: 1, prefix: 'ABC', countHidden: true }
    expect(indexRows({ ...base, pages, indexPages: 1, numbering }).map((r) => r.pages)).toEqual(['ABC2', 'ABC3-ABC4'])
  })
})
