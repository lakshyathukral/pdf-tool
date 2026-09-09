// ---------------------------------------------------------------------------
// ui/bookmarks.js — the bookmark tree: what will appear in Acrobat's
// navigation panel.
//
// A bookmark belongs to a PAGE, not to a page number. So reordering pages
// reorders the bookmarks with them, and inserting a document in the middle
// does not send every later entry to the wrong place — which is the thing
// that makes this tedious in Acrobat.
// ---------------------------------------------------------------------------

import * as model from '../model.js'

const list = document.querySelector('#bookmark-list')
const empty = document.querySelector('#bookmark-empty')

let onJump = () => {}

function makeRow(entry) {
  const row = document.createElement('li')
  // Indent by the level the entry will ACTUALLY have in the saved file, not the
  // one that was asked for — otherwise the panel shows nesting the PDF will not.
  row.className = `bookmark-row level-${entry.effectiveLevel}`

  const jump = document.createElement('button')
  jump.type = 'button'
  jump.className = 'bookmark-jump'
  jump.textContent = entry.title
  jump.title = `Page ${entry.position + 1} — click to view, double-click to rename`
  jump.addEventListener('click', () => onJump(entry.pageId))

  // Double-click a title to rename it in place.
  jump.addEventListener('dblclick', () => {
    const next = prompt('Rename bookmark', entry.title)
    if (next !== null) model.renameBookmark(entry.pageId, entry.index, next)
  })

  const page = document.createElement('span')
  page.className = 'bookmark-page'
  page.textContent = `p.${entry.position + 1}`

  const out = document.createElement('button')
  out.type = 'button'
  out.textContent = '←'
  out.title = 'Move up a level'
  out.disabled = entry.level === 1
  out.addEventListener('click', () => model.nudgeBookmarkLevel(entry.pageId, entry.index, -1))

  const into = document.createElement('button')
  into.type = 'button'
  into.textContent = '→'
  into.title = 'Make this a sub-bookmark'
  into.disabled = entry.level === 3
  into.addEventListener('click', () => model.nudgeBookmarkLevel(entry.pageId, entry.index, 1))

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.textContent = '✕'
  remove.title = 'Remove this bookmark'
  remove.addEventListener('click', () => model.removeBookmark(entry.pageId, entry.index))

  row.append(jump, page, out, into, remove)
  return row
}

export function drawBookmarks() {
  const entries = model.getBookmarks()
  empty.hidden = entries.length > 0
  list.replaceChildren(...entries.map(makeRow))
}

export function setupBookmarks(jumpToPage) {
  onJump = jumpToPage

  const titleField = document.querySelector('#bookmark-title')

  // Adding at level 1 or level 2 is the whole interaction: a bookmark, or a
  // sub-bookmark under whatever precedes it.
  const add = (level) => {
    const title = titleField.value.trim()
    if (!title) return

    const selected = model.getSelectedIds()
    if (selected.length === 0) return

    // Adding never replaces: a page can carry a section heading and the first
    // document under it at the same time.
    if (selected.length === 1) model.addBookmark(selected[0], title, level)
    else model.bookmarkSelected(title, level)

    titleField.value = ''
  }

  document.querySelector('#bookmark-add').addEventListener('click', () => add(1))
  document.querySelector('#bookmark-add-sub').addEventListener('click', () => add(2))

  // Enter in the title field adds a top-level bookmark.
  titleField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); add(1) }
  })
}
