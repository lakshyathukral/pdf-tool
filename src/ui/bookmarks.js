// ---------------------------------------------------------------------------
// ui/bookmarks.js — the bookmark tree: what will appear in Acrobat's
// navigation panel.
//
// A bookmark belongs to a PAGE, not to a page number. So reordering pages
// reorders the bookmarks with them, and inserting a document in the middle
// does not send every later entry to the wrong place — which is the thing
// that makes this tedious in Acrobat.
//
// Numbering bookmarks works exactly as it does for text added on pages: a
// word, what comes before the number, a style, and where to start. It used to
// be a hidden {n} code, which still works for anyone who knew it.
// ---------------------------------------------------------------------------

import * as model from '../model.js'
import { formatCounter, numberedText, parseCounter } from '../textmarks.js'

const list = document.querySelector('#bookmark-list')
const empty = document.querySelector('#bookmark-empty')
const $ = (id) => document.querySelector(`#${id}`)

let onJump = () => {}

// The bookmark being renamed, as "pageId:index", or null.
let renaming = null

let auto = { word: 'Annexure', prefix: 'P-', style: '1', start: 1 }

const numbering = () => $('bookmark-auto').open

function startRenaming(key) {
  renaming = key
  drawBookmarks()
}

function renameField(entry, key) {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'bookmark-rename'
  input.value = entry.title
  input.setAttribute('aria-label', 'Bookmark title')

  const finish = (save) => {
    if (renaming !== key) return
    renaming = null
    const title = input.value.trim()
    if (save && title && title !== entry.title) model.renameBookmark(entry.pageId, entry.index, title)
    else drawBookmarks()
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true) }
    else if (event.key === 'Escape') { event.preventDefault(); finish(false) }
  })
  input.addEventListener('blur', () => finish(true))
  requestAnimationFrame(() => { input.focus(); input.select() })
  return input
}

function makeRow(entry) {
  const row = document.createElement('li')
  // Indent by the level the entry will ACTUALLY have in the saved file, not the
  // one that was asked for — otherwise the panel shows nesting the PDF will not.
  row.className = `bookmark-row level-${entry.effectiveLevel}`

  const key = `${entry.pageId}:${entry.index}`

  const page = document.createElement('span')
  page.className = 'bookmark-page'
  page.textContent = `p.${entry.position + 1}`

  if (renaming === key) {
    row.append(renameField(entry, key), page)
    return row
  }

  const jump = document.createElement('button')
  jump.type = 'button'
  jump.className = 'bookmark-jump'
  jump.textContent = entry.title
  jump.title = `Page ${entry.position + 1} — click to view`
  jump.addEventListener('click', () => onJump(entry.pageId))
  jump.addEventListener('dblclick', () => startRenaming(key))

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
  into.disabled = entry.level >= model.maxBookmarkLevel()
  into.addEventListener('click', () => model.nudgeBookmarkLevel(entry.pageId, entry.index, 1))

  // Renaming was a double-click nobody would find. Now it is a button, the
  // same as editing text already added to pages.
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'bookmark-edit'
  edit.textContent = 'Edit'
  edit.title = 'Rename this bookmark'
  edit.setAttribute('aria-label', `Rename ${entry.title}`)
  edit.addEventListener('click', () => startRenaming(key))

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'bookmark-remove'
  remove.textContent = '×'
  remove.title = 'Remove this bookmark'
  remove.setAttribute('aria-label', `Remove ${entry.title}`)
  remove.addEventListener('click', () => model.removeBookmark(entry.pageId, entry.index))

  row.append(jump, page, out, into, edit, remove)
  return row
}

// --- automatic numbering -----------------------------------------------------

function drawNumbering() {
  const on = numbering()
  $('bookmark-title-field').hidden = on
  $('bookmark-auto-note').hidden = !on

  for (const button of $('bookmark-style').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === auto.style))
  }
  if (!on) return

  const pages = model.getPages()
  const chosen = model.getSelectedPages()
  const rows = chosen.slice(0, 5).map((page, i) => {
    const li = document.createElement('li')
    const b = document.createElement('b')
    b.textContent = numberedText(auto, auto.start + i)
    const span = document.createElement('span')
    span.textContent = `Page ${pages.indexOf(page) + 1}`
    li.append(b, span)
    return li
  })

  if (chosen.length > 5) {
    const more = document.createElement('li')
    more.className = 'more'
    more.textContent = `…and ${chosen.length - 5} more, up to ${numberedText(auto, auto.start + chosen.length - 1)}`
    rows.push(more)
  }
  if (chosen.length === 0) {
    const none = document.createElement('li')
    none.className = 'more'
    none.textContent = 'Click the pages to bookmark. Each gets the next number, in page order.'
    rows.push(none)
  }
  $('bookmark-sequence').replaceChildren(...rows)
}

function readAuto() {
  const start = parseCounter($('bookmark-start').value, auto.style)
  $('bookmark-start').setAttribute('aria-invalid', String(start === null))
  auto = { ...auto, word: $('bookmark-word').value, prefix: $('bookmark-prefix').value, start: start ?? auto.start }
}

function showStart() {
  $('bookmark-start').value = formatCounter(auto.start, auto.style)
  $('bookmark-start').inputMode = auto.style === '1' ? 'numeric' : 'text'
  $('bookmark-start').setAttribute('aria-invalid', 'false')
}

export function drawBookmarks() {
  const entries = model.getBookmarks()
  empty.hidden = entries.length > 0
  list.replaceChildren(...entries.map(makeRow))
  drawNumbering()
}

export function setupBookmarks(jumpToPage) {
  onJump = jumpToPage

  const titleField = $('bookmark-title')

  // Adding at level 1 or level 2 is the whole interaction: a bookmark, or a
  // sub-bookmark under whatever precedes it.
  const add = (level) => {
    const chosen = model.getSelectedPages()
    if (chosen.length === 0) return

    if (numbering()) {
      model.addBookmarks(chosen.map((page, i) => ({ pageId: page.id, title: numberedText(auto, auto.start + i) })), level)
      return
    }

    const title = titleField.value.trim()
    if (!title) return

    // Adding never replaces: a page can carry a section heading and the first
    // document under it at the same time.
    if (chosen.length === 1) model.addBookmark(chosen[0].id, title, level)
    else model.bookmarkSelected(title, level)

    titleField.value = ''
  }

  $('bookmark-add').addEventListener('click', () => add(1))
  $('bookmark-add-sub').addEventListener('click', () => add(2))

  // Enter in the title field adds a top-level bookmark.
  titleField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); add(1) }
  })

  $('bookmark-auto').addEventListener('toggle', drawNumbering)
  for (const id of ['bookmark-word', 'bookmark-prefix', 'bookmark-start']) {
    $(id).addEventListener('input', () => { readAuto(); drawNumbering() })
  }
  $('bookmark-style').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]')
    if (!button) return
    auto.style = button.dataset.value
    showStart()
    drawNumbering()
  })

  showStart()
}
