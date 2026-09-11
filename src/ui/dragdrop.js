// ---------------------------------------------------------------------------
// ui/dragdrop.js — drag to reorder, including dragging a whole selection.
// ---------------------------------------------------------------------------

import * as model from '../model.js'

const container = document.querySelector('#thumbnails')

let draggingIds = null
let dropTarget = null
let lastClickedId = null

function setDropTarget(tile) {
  if (dropTarget === tile) return
  dropTarget?.classList.remove('drop-target')
  dropTarget = tile
  dropTarget?.classList.add('drop-target')
}

function endDrag() {
  for (const el of container.querySelectorAll('.dragging')) el.classList.remove('dragging')
  setDropTarget(null)
  draggingIds = null
}

export function setupDragDrop(onOpenPage) {
  // Listeners live on the CONTAINER, not on tiles: the grid rebuilds itself on
  // every change, so per-tile listeners would need re-attaching each time.
  container.addEventListener('dragstart', (event) => {
    const tile = event.target.closest('.tile')
    if (!tile) return

    const pageId = tile.dataset.pageId

    // Dragging a selected page moves the whole selection; dragging an
    // unselected one moves just that page.
    draggingIds = model.isSelected(pageId) ? model.getSelectedIds() : [pageId]

    for (const id of draggingIds) {
      container.querySelector(`[data-page-id="${id}"]`)?.classList.add('dragging')
    }

    event.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag unless some data is set here.
    event.dataTransfer.setData('text/plain', pageId)
  })

  container.addEventListener('dragover', (event) => {
    if (!draggingIds) return

    // The browser's default is to REFUSE the drop. Without this line the drop
    // event never fires, with no error anywhere.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    setDropTarget(event.target.closest('.tile'))
  })

  container.addEventListener('drop', (event) => {
    event.preventDefault()

    const tile = event.target.closest('.tile')
    if (!tile || !draggingIds) return

    const toPosition = Number(tile.dataset.position)
    const ids = draggingIds

    endDrag()
    model.movePages(ids, toPosition)
  })

  // Fires whether the drag succeeded or was abandoned, so cleanup lives here.
  container.addEventListener('dragend', endDrag)

  // Double-click opens the page for redaction — the same thing the toolbar
  // button does, but where the user is already looking.
  container.addEventListener('dblclick', (event) => {
    if (event.target.closest('.tile-delete')) return
    const tile = event.target.closest('.tile')
    if (tile) onOpenPage(tile.dataset.pageId)
  })

  // --- selection by clicking -------------------------------------------------
  container.addEventListener('click', (event) => {
    // The × on a page deletes that page alone, without touching the selection.
    const remove = event.target.closest('.tile-delete')
    if (remove) {
      event.stopPropagation()
      model.deletePages([remove.closest('.tile').dataset.pageId])
      return
    }

    const tile = event.target.closest('.tile')
    if (!tile) return model.clearSelection()

    const pageId = tile.dataset.pageId

    // Shift extends from the last tile clicked; a plain click toggles one.
    if (event.shiftKey && lastClickedId) model.selectRangeTo(pageId, lastClickedId)
    else model.toggleSelection(pageId)

    lastClickedId = pageId
  })
}
