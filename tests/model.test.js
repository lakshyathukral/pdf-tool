import { describe, it, expect, beforeEach, vi } from 'vitest'
import { splitStarts } from '../src/export.js'

// model.js keeps its state in module scope, so each test needs a fresh copy
// rather than inheriting whatever the last one left behind. resetModules
// clears the registry so the next import re-evaluates the file.
async function freshModel() {
  vi.resetModules()
  return import('../src/model.js')
}

const bytes = new Uint8Array(64)
const titles = (model) => model.getBookmarks().map((b) => `${b.effectiveLevel}:${b.title}@${b.position + 1}`)
const order = (model) => model.getPages().map((p) => `${p.sourceId}#${p.pageIndex}`)

describe('pages', () => {
  let model
  beforeEach(async () => {
    model = await freshModel()
    const a = model.reserveSourceId()
    model.addSource(a, 'Alpha.pdf', bytes, 3)
    const b = model.reserveSourceId()
    model.addSource(b, 'Beta.pdf', bytes, 2)
  })

  it('appends each file in order', () => {
    expect(order(model)).toEqual(['s1#0', 's1#1', 's1#2', 's2#0', 's2#1'])
  })

  // Dragging backwards drops BEFORE the target, forwards drops after it —
  // the behaviour of nearly every list reorder, and deliberate here.
  it('drops before the target when dragging backwards', () => {
    model.movePages([model.getPages()[4].id], 0)
    expect(order(model)).toEqual(['s2#1', 's1#0', 's1#1', 's1#2', 's2#0'])
  })

  it('drops after the target when dragging forwards', () => {
    model.movePages([model.getPages()[0].id], 3)
    expect(order(model)).toEqual(['s1#1', 's1#2', 's2#0', 's1#0', 's2#1'])
  })

  it('moves a whole selection as one block, keeping its internal order', () => {
    const ids = [model.getPages()[3].id, model.getPages()[4].id]
    model.movePages(ids, 0)
    expect(order(model)).toEqual(['s2#0', 's2#1', 's1#0', 's1#1', 's1#2'])
  })

  it('undoes and redoes a move', () => {
    const before = order(model)
    model.movePages([model.getPages()[4].id], 0)
    model.undo()
    expect(order(model)).toEqual(before)
    model.redo()
    expect(order(model)).not.toEqual(before)
  })

  it('removes a file and everything that came from it', () => {
    model.removeSource('s1')
    expect(order(model)).toEqual(['s2#0', 's2#1'])
  })

  it('restores BOTH the pages and the file when a removal is undone', () => {
    // Undo used to restore pages pointing at a source that no longer existed,
    // which broke thumbnails and crashed export.
    model.removeSource('s1')
    model.undo()
    expect(order(model)).toEqual(['s1#0', 's1#1', 's1#2', 's2#0', 's2#1'])
    expect(model.getSource('s1')).toBeTruthy()
  })

  it('counts only the pages still in the document', () => {
    model.clearSelection()
    model.toggleSelection(model.getPages()[0].id)
    model.deleteSelected()
    expect(model.pagesFromSource('s1')).toBe(2)
  })

  it('selects odd and even the way a reader counts', () => {
    model.selectOdd()
    expect(model.getSelectedPositions()).toEqual([0, 2, 4])
    model.selectEven()
    expect(model.getSelectedPositions()).toEqual([1, 3])
    model.invertSelection()
    expect(model.getSelectedPositions()).toEqual([0, 2, 4])
  })

  it('rotates in 90 degree steps and stays within 0-359', () => {
    model.selectAll()
    model.rotateSelected(90)
    model.rotateSelected(90)
    model.rotateSelected(90)
    model.rotateSelected(90)
    expect(model.getPages().every((p) => p.rotation === 0)).toBe(true)
  })
})

describe('bookmarks', () => {
  let model
  beforeEach(async () => {
    model = await freshModel()
    const a = model.reserveSourceId()
    model.addSource(a, 'Claim.pdf', bytes, 4)
  })

  it('names the first page of each file automatically', () => {
    expect(titles(model)).toEqual(['1:Claim@1'])
  })

  it('lets a page carry a heading AND the document under it', () => {
    // This used to REPLACE the existing bookmark, destroying the parent.
    const first = model.getPages()[0].id
    model.addBookmark(first, 'A1. Particulars', 2)
    expect(titles(model)).toEqual(['1:Claim@1', '2:A1. Particulars@1'])
  })

  it('keeps a bookmark with its page when pages move', () => {
    model.addBookmark(model.getPages()[2].id, 'A2. Defence', 2)
    model.movePages([model.getPages()[2].id], 0)
    expect(titles(model)).toEqual(['1:A2. Defence@1', '1:Claim@2'])
  })

  it('shows an orphan sub-bookmark at the level it will really have', () => {
    // Nothing above it, so the exporter pulls it up — and the panel must agree.
    model.removeBookmark(model.getPages()[0].id, 0)
    model.addBookmark(model.getPages()[1].id, 'Orphan', 2)
    expect(titles(model)).toEqual(['1:Orphan@2'])
  })

  it('numbers a bulk selection with {n}', () => {
    model.clearSelection()
    for (const p of model.getPages().slice(0, 3)) model.toggleSelection(p.id)
    model.bookmarkSelected('Tab {n}', 1)
    expect(titles(model)).toContain('1:Tab 1@1')
    expect(titles(model)).toContain('1:Tab 3@3')
  })

  it('does not copy bookmarks onto a duplicated page', () => {
    model.clearSelection()
    model.toggleSelection(model.getPages()[0].id)
    model.duplicateSelected()
    expect(titles(model)).toEqual(['1:Claim@1'])
  })

  it('imports the outline a file already had, nested under its own entry', () => {
    const b = model.reserveSourceId()
    model.addSource(b, 'Statement.pdf', bytes, 3, [
      { title: 'Statement of X', level: 1, pageIndex: 0 },
      { title: 'Background', level: 2, pageIndex: 1 },
      { title: 'Detail', level: 3, pageIndex: 2 },
    ])
    expect(titles(model)).toEqual([
      '1:Claim@1',
      '1:Statement@5',
      '2:Statement of X@5',
      '3:Background@6',
      '4:Detail@7',
    ])
  })
})

describe('settings apply only where their controls are shown', () => {
  it('hides a watermark that was switched on in another tool', async () => {
    const model = await freshModel()
    model.setWatermark({ enabled: true, text: 'DRAFT' })
    model.setExposedSettings(new Set(['numbering']))
    expect(model.getWatermark().enabled).toBe(false)
    expect(model.getWatermark().text).toBe('DRAFT')   // configuration is kept
    model.setExposedSettings(null)                    // the full editor
    expect(model.getWatermark().enabled).toBe(true)
  })

  it('does the same for numbering and passwords', async () => {
    const model = await freshModel()
    model.setNumbering({ enabled: true })
    model.setProtection({ enabled: true, password: 'x' })
    model.setExposedSettings(new Set(['watermark']))
    expect(model.getNumbering().enabled).toBe(false)
    expect(model.getProtection().enabled).toBe(false)
  })
})

describe('splitStarts', () => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }))

  it('splits every page', () => {
    expect(splitStarts(pages, 'each', () => false)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('splits at the selected pages, always including the first', () => {
    const selected = new Set(['p3', 'p5'])
    expect(splitStarts(pages, 'selected', (id) => selected.has(id))).toEqual([0, 3, 5])
  })

  it('splits at top-level bookmarks', () => {
    expect(splitStarts(pages, 'bookmarks', () => false, [0, 2, 6])).toEqual([0, 2, 6])
  })

  it('still starts at page one when no bookmark is on it', () => {
    expect(splitStarts(pages, 'bookmarks', () => false, [3, 6])).toEqual([0, 3, 6])
  })

  it('gives a single piece when there is nothing to split at', () => {
    expect(splitStarts(pages, 'bookmarks', () => false, [])).toEqual([0])
  })
})
