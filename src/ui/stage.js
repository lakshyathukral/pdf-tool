// ---------------------------------------------------------------------------
// ui/stage.js — sizing the page view inside a dialog.
//
// Pages were rendered at a fixed pixel width, which ran off the side of a
// phone. Setting a maximum width with an aspect ratio instead lets the browser
// shrink the whole thing to fit while keeping the page's proportions.
//
// Everything drawn on top — redaction boxes, signature placements — is
// positioned in per cent, so it scales along with the page for free.
// ---------------------------------------------------------------------------

export function fitStage(element, width, height) {
  element.style.width = `${width}px`
  element.style.maxWidth = '100%'
  element.style.aspectRatio = `${width} / ${height}`
  element.style.height = 'auto'
}

// Before the page has been rendered we do not know its shape, so assume
// portrait A4 rather than leaving a collapsed box.
export function placeholderStage(element, width) {
  fitStage(element, width, Math.round(width * 1.414))
}
