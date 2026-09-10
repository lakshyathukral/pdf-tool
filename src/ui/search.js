// ---------------------------------------------------------------------------
// ui/search.js — find a phrase across the whole document and redact the hits.
//
// The point of the review list is that find-and-redact must never be a single
// button. A search that quietly misses one occurrence, or blacks out a word
// that happened to appear inside a longer one, is worse than no search at all,
// because the document goes out anyway. So every match is shown in context and
// has to be ticked before anything is destroyed.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { findOnPage, pageHasText } from '../render.js'

const el = (id) => document.querySelector(`#${id}`)

// One entry per match: which page of the OUTPUT it sits on, the rectangles that
// cover it, the surrounding words, and whether the person wants it gone.
let results = []
let searching = false

// "1 box" but "2 boxes", not "2 boxs".
function describe(count, noun, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`
}

function pagesTouched(chosen) {
  return new Set(chosen.map((r) => r.pageId)).size
}

function render() {
  const list = el('search-results')
  list.replaceChildren()

  for (const [index, result] of results.entries()) {
    const item = document.createElement('li')
    item.className = 'search-hit'

    const label = document.createElement('label')

    const tick = document.createElement('input')
    tick.type = 'checkbox'
    tick.checked = result.chosen
    tick.dataset.index = String(index)
    tick.addEventListener('change', () => {
      results[index].chosen = tick.checked
      refreshApply()
    })

    const body = document.createElement('span')
    body.className = 'search-hit-body'

    const where = document.createElement('span')
    where.className = 'search-hit-where'
    where.textContent = `Page ${result.position + 1}`

    // The matched words are marked so it is obvious what would go, and what is
    // only there to show where it sits.
    const context = document.createElement('span')
    context.className = 'search-hit-context'
    context.append(
      document.createTextNode(result.context.before),
      Object.assign(document.createElement('mark'), { textContent: result.context.match }),
      document.createTextNode(result.context.after),
    )

    body.append(where, context)
    label.append(tick, body)
    item.append(label)
    list.append(item)
  }

  el('search-results-block').hidden = results.length === 0
  refreshApply()
}

function refreshApply() {
  const chosen = results.filter((r) => r.chosen)
  const button = el('search-apply')
  button.disabled = chosen.length === 0
  button.textContent = chosen.length === 0
    ? 'Redact the ticked results'
    : `Redact ${describe(chosen.length, 'result')}`

  // Redaction turns each page it touches into an image, so say so before it
  // happens rather than leaving it to be discovered in the saved file.
  el('search-warning').textContent = chosen.length === 0
    ? ''
    : `This will convert ${describe(pagesTouched(chosen), 'page')} to an image. `
      + 'Those pages stop being searchable, which is what makes the removal real.'
}

function setStatus(text) {
  el('search-status').textContent = text
}

export function clearSearch({ keepStatus = false } = {}) {
  results = []
  render()
  el('search-clear').disabled = true
  if (!keepStatus) setStatus('')
}

async function runSearch() {
  if (searching) return

  const needle = el('search-text').value.trim()
  if (needle === '') {
    clearSearch()
    setStatus('Type something to find first.')
    return
  }

  const pages = model.getPages()
  if (pages.length === 0) {
    clearSearch()
    setStatus('Add a PDF first.')
    return
  }

  searching = true
  el('search-run').disabled = true
  clearSearch({ keepStatus: true })
  setStatus(`Searching ${describe(pages.length, 'page')}…`)

  const matchCase = el('search-match-case').checked
  const found = []
  let pagesWithText = 0

  try {
    for (const [position, page] of pages.entries()) {
      // A page can appear twice in the output — duplicated, or the same source
      // page used in two places — so results are tied to the page ENTRY, not to
      // the source page, and redacting one does not silently redact the other.
      if (await pageHasText(page.sourceId, page.pageIndex)) pagesWithText += 1

      const matches = await findOnPage(page.sourceId, page.pageIndex, needle, { matchCase })
      for (const match of matches) {
        found.push({
          pageId: page.id,
          position,
          rects: match.rects,
          context: match.context,
          chosen: true,
        })
      }
    }
  } catch (error) {
    searching = false
    el('search-run').disabled = false
    setStatus(`Could not search this document: ${error.message}`)
    return
  }

  results = found
  searching = false
  el('search-run').disabled = false
  el('search-clear').disabled = found.length === 0

  if (found.length > 0) {
    setStatus(`Found ${describe(found.length, 'result')} on ${describe(pagesTouched(found), 'page')}. `
      + 'Untick anything that should stay.')
  } else if (pagesWithText === 0) {
    setStatus('No text found anywhere in this document. It is probably a scan or a '
      + 'photograph, so there are no words to search — draw the boxes by hand instead.')
  } else {
    setStatus(`No match for "${needle}".`)
  }

  render()
}

function applySearch() {
  const chosen = results.filter((r) => r.chosen)
  if (chosen.length === 0) return

  const pageCount = pagesTouched(chosen)
  const added = model.addRedactions(
    chosen.map((r) => ({ pageId: r.pageId, rects: r.rects })),
  )

  clearSearch()
  el('search-text').value = ''
  setStatus(`Redacted ${describe(added, 'box', 'boxes')} across ${describe(pageCount, 'page')}. `
    + 'Check the pages, then save. Undo takes the whole search back.')
}

export function setupSearch() {
  el('search-run').addEventListener('click', runSearch)
  el('search-clear').addEventListener('click', () => clearSearch())
  el('search-apply').addEventListener('click', applySearch)

  el('search-select-all').addEventListener('click', () => {
    for (const result of results) result.chosen = true
    render()
  })

  el('search-select-none').addEventListener('click', () => {
    for (const result of results) result.chosen = false
    render()
  })

  // Enter in the box searches, which is what anyone will try first.
  el('search-text').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      runSearch()
    }
  })

  // Results describe the document as it was when the search ran. If the pages
  // move or a file is removed, the positions in the list are no longer true, so
  // they are dropped rather than left to point at the wrong place.
  model.subscribe(() => {
    if (results.length === 0) return
    const live = new Set(model.getPages().map((p) => p.id))
    if (results.some((r) => !live.has(r.pageId))) {
      clearSearch()
      setStatus('The document changed, so those results were cleared. Search again.')
    }
  })
}
