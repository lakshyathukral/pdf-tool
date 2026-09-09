import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { buildPdf, buildOutline, formatPageNumber } from '../src/export.js'
import { textOfEachPage, rotations, outline, positionOf, centreOf, metadata, open } from './helpers/read-pdf.js'

const five = await readFile(new URL('./fixtures/five-pages.pdf', import.meta.url))
const three = await readFile(new URL('./fixtures/three-pages.pdf', import.meta.url))

const sources = new Map([
  ['s1', { id: 's1', name: 'five-pages.pdf', bytes: five }],
  ['s2', { id: 's2', name: 'three-pages.pdf', bytes: three }],
])

const page = (sourceId, pageIndex, extra = {}) => ({
  id: `${sourceId}-${pageIndex}`,
  sourceId,
  pageIndex,
  rotation: 0,
  stamps: [],
  redactions: [],
  bookmarks: [],
  signatures: [],
  ...extra,
})

const numberingOff = { enabled: false, style: 'bates', prefix: '', start: 1, padding: 4, position: 'bottom-right', size: 10 }
const watermarkOff = { enabled: false, text: '', size: 60, opacity: 0.15, angle: 45 }

const build = (pages, options = {}) =>
  buildPdf({
    pages,
    sources,
    numbering: numberingOff,
    watermark: watermarkOff,
    rasterize: async () => { throw new Error('rasterize should not be needed here') },
    ...options,
  })

describe('assembling pages', () => {
  it('merges two files in the order given', async () => {
    const out = await build([page('s2', 0), page('s1', 4), page('s1', 0)])
    const text = await textOfEachPage(out)
    expect(text[0]).toContain('Alpha')
    expect(text[1]).toContain('Page Five')
    expect(text[2]).toContain('Page One')
  })

  it('duplicates a page without duplicating the file', async () => {
    const out = await build([page('s1', 0), page('s1', 0)])
    const text = await textOfEachPage(out)
    expect(text).toHaveLength(2)
    expect(text[0]).toEqual(text[1])
  })

  it('applies rotation on top of whatever the page already had', async () => {
    const out = await build([
      page('s1', 0, { rotation: 0 }),
      page('s1', 1, { rotation: 90 }),
      page('s1', 2, { rotation: 180 }),
      page('s1', 3, { rotation: 270 }),
    ])
    expect(await rotations(out)).toEqual([0, 90, 180, 270])
  })
})

describe('page numbering', () => {
  it('formats every style', () => {
    const n = { ...numberingOff, prefix: 'ABC-', padding: 5 }
    expect(formatPageNumber({ ...n, style: 'bates' }, 3, 10)).toBe('ABC-00003')
    expect(formatPageNumber({ ...n, style: 'plain' }, 3, 10)).toBe('3')
    expect(formatPageNumber({ ...n, style: 'page' }, 3, 10)).toBe('Page 3')
    expect(formatPageNumber({ ...n, style: 'page-of' }, 3, 10)).toBe('Page 3 of 10')
    expect(formatPageNumber({ ...n, style: 'dashes' }, 3, 10)).toBe('- 3 -')
  })

  it('numbers pages in final order and lands where asked', async () => {
    const out = await build([page('s1', 4), page('s1', 0)], {
      numbering: { ...numberingOff, enabled: true, prefix: 'ABC-', start: 100, padding: 5 },
    })
    const text = await textOfEachPage(out)
    expect(text[0]).toContain('ABC-00100')
    expect(text[1]).toContain('ABC-00101')
    expect(await positionOf(out, 1, /ABC-/)).toEqual({ horizontal: 'right', vertical: 'bottom' })
  })

  it('keeps the number in the reader’s bottom-right on a rotated page', async () => {
    // The case that breaks if the rotation maths is wrong: drawing
    // coordinates ignore the display rotation.
    const out = await build([page('s1', 0, { rotation: 90 })], {
      numbering: { ...numberingOff, enabled: true, style: 'plain' },
    })
    expect(await positionOf(out, 1, /^1$/)).toEqual({ horizontal: 'right', vertical: 'bottom' })
  })
})

describe('label placement', () => {
  it('sits in the chosen corner by default', async () => {
    const out = await build([page('s1', 0, {
      stamps: [{ text: 'EXHIBIT A', position: 'top-left', size: 14 }],
    })])
    expect(await positionOf(out, 1, /EXHIBIT A/)).toEqual({ horizontal: 'left', vertical: 'top' })
  })

  it('moves further in when the margin is increased', async () => {
    const near = await build([page('s1', 0, {
      stamps: [{ text: 'NEAR', position: 'top-left', size: 12, margin: 5 }],
    })])
    const far = await build([page('s1', 0, {
      stamps: [{ text: 'FAR', position: 'top-left', size: 12, margin: 60 }],
    })])
    const a = await centreOf(near, 1, /NEAR/)
    const b = await centreOf(far, 1, /FAR/)
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeGreaterThan(a.y)   // further down from the top
  })

  it('lands at an exact fraction of the page when asked', async () => {
    const out = await build([page('s1', 0, {
      stamps: [{ text: 'PINNED', position: 'top-left', size: 12, mode: 'exact', x: 0.25, y: 0.75 }],
    })])
    const centre = await centreOf(out, 1, /PINNED/)
    expect(centre.x).toBeGreaterThan(0.25)
    expect(centre.x).toBeLessThan(0.45)
    expect(centre.y).toBeCloseTo(0.75, 1)
  })

  it('keeps an exact placement correct on a rotated page', async () => {
    const out = await build([page('s1', 0, {
      rotation: 90,
      stamps: [{ text: 'PINNED', position: 'top-left', size: 12, mode: 'exact', x: 0.2, y: 0.2 }],
    })])
    const centre = await centreOf(out, 1, /PINNED/)
    expect(centre.y).toBeCloseTo(0.2, 1)
  })
})

describe('watermark', () => {
  it('is centred, on rotated pages too', async () => {
    const out = await build([page('s1', 0), page('s1', 1, { rotation: 90 })], {
      watermark: { enabled: true, text: 'CONFIDENTIAL', size: 40, opacity: 0.2, angle: 45 },
    })
    // Within a couple of per cent of the middle, on both pages.
    for (const pageNumber of [1, 2]) {
      const centre = await centreOf(out, pageNumber, /CONFIDENTIAL/)
      expect(centre.x).toBeCloseTo(0.5, 1)
      expect(centre.y).toBeCloseTo(0.5, 1)
    }
  })

  it('repeats nine times when tiled', async () => {
    const out = await build([page('s1', 0)], {
      watermark: { enabled: true, text: 'DRAFT', size: 20, opacity: 0.2, angle: 45, tiled: true },
    })
    const pdf = await open(out)
    const items = (await (await pdf.getPage(1)).getTextContent()).items
    expect(items.filter((t) => t.str.includes('DRAFT'))).toHaveLength(9)
  })
})

describe('bookmarks', () => {
  it('writes a nested outline that points at the right pages', async () => {
    const out = await build([
      page('s1', 0, { bookmarks: [{ title: 'A. Pleadings', level: 1 }, { title: 'A1. Particulars', level: 2 }] }),
      page('s1', 1),
      page('s1', 2, { bookmarks: [{ title: 'A2. Defence', level: 2 }] }),
      page('s2', 0, { bookmarks: [{ title: 'B. Statements', level: 1 }] }),
    ])
    expect(await outline(out)).toEqual([
      '1:A. Pleadings@1',
      '2:A1. Particulars@1',
      '2:A2. Defence@3',
      '1:B. Statements@4',
    ])
  })

  it('survives unicode in titles', async () => {
    const out = await build([page('s1', 0, { bookmarks: [{ title: 'Exhibit “Ø” — café', level: 1 }] })])
    expect(await outline(out)).toEqual(['1:Exhibit “Ø” — café@1'])
  })

  it('drops entries with no title or an impossible page', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.addPage([600, 800])
    const written = buildOutline(doc, [
      { pageIndex: 0, title: 'Keep', level: 1 },
      { pageIndex: 0, title: '   ', level: 1 },
      { pageIndex: 99, title: 'Out of range', level: 1 },
    ])
    expect(written).toBe(1)
  })
})

describe('metadata', () => {
  it('does not carry the source file’s own title or author across', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const seed = await PDFDocument.load(five)
    seed.setTitle('PRIVILEGED - internal draft')
    seed.setAuthor('Someone Private')
    const seeded = await seed.save()

    const out = await buildPdf({
      pages: [page('sx', 0)],
      sources: new Map([['sx', { id: 'sx', name: 'seeded.pdf', bytes: seeded }]]),
      numbering: numberingOff,
      watermark: watermarkOff,
      rasterize: async () => { throw new Error('n/a') },
    })

    const meta = await metadata(out)
    expect(meta.raw).not.toContain('PRIVILEGED')
    expect(meta.raw).not.toContain('Someone Private')
  })

  it('leaves no trace of the library that made it', async () => {
    const out = await build([page('s1', 0)])
    const meta = await metadata(out)
    expect(meta.raw).not.toContain('Hopding')
    expect(meta.producer).toBe('')
  })

  it('writes a title and author when asked', async () => {
    const out = await build([page('s1', 0)], { metadata: { title: 'Bundle A', author: 'Thukral' } })
    const meta = await metadata(out)
    expect(meta.title).toBe('Bundle A')
    expect(meta.author).toBe('Thukral')
  })
})

describe('passwords', () => {
  const locked = readFileSync(new URL('./fixtures/locked.pdf', import.meta.url))

  it('opens a protected source and copies its pages', async () => {
    const out = await buildPdf({
      pages: [page('lk', 0), page('lk', 1)],
      sources: new Map([['lk', { id: 'lk', name: 'locked.pdf', bytes: locked, password: 'letmein' }]]),
      numbering: numberingOff,
      watermark: watermarkOff,
      rasterize: async () => { throw new Error('n/a') },
    })
    const text = await textOfEachPage(out)
    expect(text[0]).toContain('Page One')
    expect(text[1]).toContain('Page Two')
  })

  it('saves without a password, which is how one is removed', async () => {
    const out = await buildPdf({
      pages: [page('lk', 0)],
      sources: new Map([['lk', { id: 'lk', name: 'locked.pdf', bytes: locked, password: 'letmein' }]]),
      numbering: numberingOff,
      watermark: watermarkOff,
      rasterize: async () => { throw new Error('n/a') },
    })
    expect(Buffer.from(out).toString('latin1')).not.toContain('/Encrypt')
    // Readable with no password at all.
    expect((await textOfEachPage(out))[0]).toContain('Page One')
  })

  it('puts a password on the saved file when asked', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const out = await build([page('s1', 0)], {
      protection: { enabled: true, password: 'newpass' },
    })

    expect(Buffer.from(out).toString('latin1')).toContain('/Encrypt')
    await expect(PDFDocument.load(out)).rejects.toThrow()
    const opened = await PDFDocument.load(out, { password: 'newpass' })
    expect(opened.getPageCount()).toBe(1)
  })

  it('ignores an empty password rather than producing a file nobody can open', async () => {
    const out = await build([page('s1', 0)], { protection: { enabled: true, password: '' } })
    expect(Buffer.from(out).toString('latin1')).not.toContain('/Encrypt')
  })
})

describe('redaction', () => {
  it('replaces a redacted page with an image and leaves the rest as text', async () => {
    // A 1x1 PNG standing in for a rasterised page.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64')

    const out = await build(
      [page('s1', 0, { redactions: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.1 }] }), page('s1', 1)],
      { rasterize: async () => ({ bytes: new Uint8Array(png), width: 612, height: 792 }) },
    )

    const text = await textOfEachPage(out)
    expect(text[0]).toBe('')            // nothing left to extract
    expect(text[1]).toContain('Page Two')
  })
})
