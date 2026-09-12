import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { buildPdf, buildOutline, formatPageNumber } from '../src/export.js'
import { textOfEachPage, rotations, outline, positionOf, centreOf, metadata, open } from './helpers/read-pdf.js'
import { faceFiles } from '../src/fonts.js'

// The browser fetches font files; here they are read straight from disk.
const loadFaces = (font, bold, italic) =>
  Promise.all(faceFiles(font, bold, italic).map((file) => readFile(new URL(`..${file.path}`, import.meta.url))))

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
    loadFaces,
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

describe('text on pages', () => {
  const mark = (extra = {}) => ({
    group: 't1',
    text: 'Annexure P-1',
    x: 0.9,
    y: 0.05,
    anchor: 'top-right',
    size: 14,
    font: 'times',
    bold: true,
    italic: false,
    colour: 'black',
    box: 'none',
    ...extra,
  })

  it('sits in the corner the grid put it in', async () => {
    const out = await build([page('s1', 0, {
      stamps: [mark({ text: 'EXHIBIT A', anchor: 'top-left', x: 0.06, y: 0.05 })],
    })])
    expect(await positionOf(out, 1, /EXHIBIT A/)).toEqual({ horizontal: 'left', vertical: 'top' })
  })

  it('grows away from the edge it is anchored to, so longer text stays on the page', async () => {
    const short = await build([page('s1', 0, { stamps: [mark({ text: 'P-1' })] })])
    const long = await build([page('s1', 0, { stamps: [mark({ text: 'Annexure P-1 Certified True Copy' })] })])
    const a = await centreOf(short, 1, /P-1/)
    const b = await centreOf(long, 1, /Certified/)
    expect(b.x).toBeLessThan(a.x)
    expect(a.x).toBeLessThan(0.9)
  })

  it('puts its middle on the point given when anchored in the middle', async () => {
    const out = await build([page('s1', 0, {
      stamps: [mark({ text: 'PINNED', anchor: 'middle-center', x: 0.25, y: 0.75, box: 'outline' })],
    })])
    const centre = await centreOf(out, 1, /PINNED/)
    expect(centre.x).toBeCloseTo(0.25, 1)
    expect(centre.y).toBeCloseTo(0.75, 1)
  })

  it('keeps its place on a rotated page', async () => {
    const out = await build([page('s1', 0, {
      rotation: 90,
      stamps: [mark({ text: 'PINNED', anchor: 'middle-center', x: 0.2, y: 0.2, box: 'filled' })],
    })])
    const centre = await centreOf(out, 1, /PINNED/)
    expect(centre.x).toBeCloseTo(0.2, 1)
    expect(centre.y).toBeCloseTo(0.2, 1)
  })

  it('carries several pieces of text on one page', async () => {
    const out = await build([page('s1', 0, {
      stamps: [
        mark({ text: 'Annexure P-1' }),
        mark({ group: 't2', text: 'Certified True Copy', anchor: 'bottom-right', x: 0.9, y: 0.95, font: 'arial', colour: 'blue' }),
      ],
    })])
    const [text] = await textOfEachPage(out)
    expect(text).toContain('Annexure P-1')
    expect(text).toContain('Certified True Copy')
  })

  it('writes Hindi with a number after it', async () => {
    const out = await build([page('s1', 0, {
      stamps: [mark({ text: 'अनुलग्नक पी-1', font: 'hindi' })],
    })])
    const [text] = await textOfEachPage(out)
    expect(text).toContain('-1')
  })

  it('says so plainly if it is not given any fonts', async () => {
    await expect(build([page('s1', 0, { stamps: [mark()] })], { loadFaces: null }))
      .rejects.toThrow(/fonts/)
  })
})

describe('page numbers placed on the page', () => {
  it('sit where the numbering says, move on one page, and can be left off another', async () => {
    const numbering = { ...numberingOff, enabled: true, prefix: 'NUM-', anchor: 'top-left' }
    const out = await build([
      page('s1', 0),
      page('s1', 1, { numberSpot: { anchor: 'bottom-right', x: 0.9, y: 0.95 } }),
      page('s1', 2, { numberHidden: true }),
      page('s1', 3),
    ], { numbering })

    expect(await positionOf(out, 1, /NUM-0001/)).toEqual({ horizontal: 'left', vertical: 'top' })
    expect(await positionOf(out, 2, /NUM-0002/)).toEqual({ horizontal: 'right', vertical: 'bottom' })
    expect(await positionOf(out, 3, /NUM-0003/)).toBeNull()
    // The hidden page still took its turn in the count.
    expect(await positionOf(out, 4, /NUM-0004/)).toEqual({ horizontal: 'left', vertical: 'top' })
  })

  it('still reads settings saved with only a corner', async () => {
    const numbering = { ...numberingOff, enabled: true, prefix: 'OLD-', position: 'top-right' }
    const out = await build([page('s1', 0)], { numbering })
    expect(await positionOf(out, 1, /OLD-0001/)).toEqual({ horizontal: 'right', vertical: 'top' })
  })
})

describe('page numbers in other styles, and after hidden pages', () => {
  it('writes the words in Hindi when the Hindi font is chosen', () => {
    expect(formatPageNumber({ ...numberingOff, style: 'page-of', font: 'hindi' }, 2, 7)).toBe('पृष्ठ 2 / 7')
    expect(formatPageNumber({ ...numberingOff, style: 'page', font: 'hindi' }, 2, 7)).toBe('पृष्ठ 2')
    expect(formatPageNumber({ ...numberingOff, style: 'page-of', font: 'times' }, 2, 7)).toBe('Page 2 of 7')
  })

  it('writes Roman numerals', () => {
    expect(formatPageNumber({ ...numberingOff, style: 'roman-lower' }, 4, 10)).toBe('iv')
    expect(formatPageNumber({ ...numberingOff, style: 'roman-upper' }, 9, 10)).toBe('IX')
  })

  it('can start counting after pages whose number is hidden', async () => {
    const numbering = { ...numberingOff, enabled: true, prefix: 'NUM-', countHidden: false }
    const out = await build([
      page('s1', 0, { numberHidden: true }),
      page('s1', 1),
      page('s1', 2),
    ], { numbering })
    const text = await textOfEachPage(out)
    expect(text[0]).not.toContain('NUM-')
    expect(text[1]).toContain('NUM-0001')
    expect(text[2]).toContain('NUM-0002')
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

  it('can be left off one page, in any of the fonts', async () => {
    const out = await build([page('s1', 0, { watermarkHidden: true }), page('s1', 1)], {
      watermark: { enabled: true, text: 'CONFIDENTIAL', size: 40, opacity: 0.2, angle: 45, font: 'georgia', colour: 'red', bold: true },
    })
    const text = await textOfEachPage(out)
    expect(text[0]).not.toContain('CONFIDENTIAL')
    expect(text[1]).toContain('CONFIDENTIAL')
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
