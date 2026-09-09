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

// The dialog scrolls if its contents are taller than the window, and a page
// that needs scrolling cannot be boxed in one drag on a laptop screen. So the
// width is also capped by however much height is left once the dialog's own
// heading, hint and buttons (roughly 270px) have been taken out of the window.
const DIALOG_CHROME_PX = 270

export function fitStage(element, width, height) {
  const ratio = (width / height).toFixed(4)
  element.style.width = `min(${width}px, calc((92vh - ${DIALOG_CHROME_PX}px) * ${ratio}))`
  element.style.maxWidth = '100%'
  element.style.aspectRatio = `${width} / ${height}`
  element.style.height = 'auto'
}

// Before the page has been rendered we do not know its shape, so assume
// portrait A4 rather than leaving a collapsed box.
export function placeholderStage(element, width) {
  fitStage(element, width, Math.round(width * 1.414))
}
