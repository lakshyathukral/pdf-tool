// ---------------------------------------------------------------------------
// ui/illustrations.js — the drawn icon set.
//
// One system, not fourteen drawings. Every tool is the same sheet of paper with
// something happening to it: a stack, a tab, a stamp, a lock. That is what makes
// a grid of them read as one family rather than a pile of clip art.
//
// Rules held to throughout:
//   * a 64×64 square, so every icon occupies the same optical weight
//   * outlines in `currentColor`, so a card can tint the whole drawing
//   * one accent, taken from --art-accent, so the category colours the scene
//   * paper is filled with --art-paper so overlapping sheets read as solid
//   * strokes joined and capped round, which is what keeps it friendly
//
// Everything here is a string of SVG. No DOM, no model, no pdf.js.
// ---------------------------------------------------------------------------

// A sheet of paper with a folded corner. The fold is what makes it read as
// paper rather than a rectangle, so it is never omitted.
function sheet(x, y, { w = 30, h = 40, rotate = 0, fold = 9 } = {}) {
  const transform = rotate ? ` transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})"` : ''
  return `<g${transform}>
    <path d="M${x} ${y + 3}a3 3 0 0 1 3-3h${w - fold - 3}l${fold} ${fold}v${h - fold - 3}a3 3 0 0 1-3 3H${x + 3}a3 3 0 0 1-3-3z"
          fill="var(--art-paper)" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M${x + w - fold} ${y}v${fold}h${fold}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
  </g>`
}

// Ruled lines, to say "there are words on this" without drawing words.
function lines(x, y, widths, { gap = 6, colour = 'currentColor', opacity = 0.35 } = {}) {
  return widths
    .map((w, i) => `<line x1="${x}" y1="${y + i * gap}" x2="${x + w}" y2="${y + i * gap}"
      stroke="${colour}" stroke-width="2.4" stroke-linecap="round" opacity="${opacity}"/>`)
    .join('')
}

const svg = (body, extra = '') =>
  `<svg class="art" viewBox="0 0 64 64" aria-hidden="true" ${extra}>${body}</svg>`

// --- the tools ------------------------------------------------------------

const ART = {
  // Two sheets becoming one. The back sheet is the "other file".
  merge: () => svg(`
    <g class="art-back">${sheet(6, 12, { rotate: -8 })}</g>
    ${sheet(24, 10)}
    ${lines(30, 24, [16, 16, 10])}
    <g class="art-mark">
      <circle cx="21" cy="49" r="9" fill="var(--art-accent)"/>
      <path d="M21 44.5v9M16.5 49h9" stroke="var(--art-paper)" stroke-width="2.6" stroke-linecap="round"/>
    </g>`),

  // Pages in a row, one lifted out of line and about to drop back into it.
  organise: () => svg(`
    ${sheet(4, 18, { w: 16, h: 24, fold: 6 })}
    ${sheet(42, 18, { w: 16, h: 24, fold: 6 })}
    <g class="art-lift">${sheet(23, 10, { w: 18, h: 26, fold: 6 })}</g>
    <path class="art-mark" d="M24 50h16" stroke="var(--art-accent)" stroke-width="3" stroke-linecap="round"/>
    <path class="art-mark" d="M36 46l4 4-4 4" fill="none" stroke="var(--art-accent)" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round"/>`),

  // A sheet mid-turn, with the arrow that turned it.
  rotate: () => svg(`
    <g class="art-spin">${sheet(17, 14)}${lines(23, 28, [16, 12])}</g>
    <path class="art-mark" d="M12 46a22 22 0 0 0 40-4" fill="none" stroke="var(--art-accent)"
          stroke-width="3" stroke-linecap="round"/>
    <path class="art-mark" d="M12 46l-1-7 7 2" fill="none" stroke="var(--art-accent)"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),

  // One page pulled clear of the stack.
  extract: () => svg(`
    ${sheet(6, 16, { w: 26, h: 36, fold: 8 })}
    ${lines(12, 28, [12, 12])}
    <g class="art-lift">
      ${sheet(30, 10, { w: 26, h: 36, rotate: 6, fold: 8 })}
      <g class="art-mark"><circle cx="48" cy="42" r="8" fill="var(--art-accent)"/>
      <path d="M44.5 42l2.5 2.5 4.5-5" fill="none" stroke="var(--art-paper)" stroke-width="2.6"
            stroke-linecap="round" stroke-linejoin="round"/></g>
    </g>`),

  // A cut down the middle, scissors implied by the dashes.
  split: () => svg(`
    ${sheet(8, 12, { w: 20, h: 40, fold: 7 })}
    ${sheet(36, 12, { w: 20, h: 40, fold: 7 })}
    <line class="art-mark" x1="32" y1="6" x2="32" y2="58" stroke="var(--art-accent)"
          stroke-width="3" stroke-linecap="round" stroke-dasharray="4 6"/>`),

  // A photograph becoming a page.
  photos: () => svg(`
    ${sheet(30, 14, { w: 28, h: 38, fold: 8 })}
    <g class="art-card">
      <rect x="5" y="20" width="28" height="26" rx="4" fill="var(--art-paper)"
            stroke="currentColor" stroke-width="2.4"/>
      <circle cx="13" cy="28" r="3" fill="var(--art-accent)"/>
      <path d="M8 42l7-9 6 7 4-4 6 8" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),

  // A stamp landing across the page.
  'photo-watermark': () => svg(`
    ${sheet(17, 10)}
    ${lines(23, 24, [16, 16, 10])}
    <g class="art-stamp">
      <rect x="6" y="34" width="52" height="15" rx="3.5" transform="rotate(-14 32 41)"
            fill="var(--art-accent)" opacity="0.9"/>
      <path d="M15 43h34" transform="rotate(-14 32 41)" stroke="var(--art-paper)"
            stroke-width="3" stroke-linecap="round"/>
    </g>`),

  // A luggage label clipped to the corner.
  label: () => svg(`
    ${sheet(10, 10, { w: 32, h: 42 })}
    ${lines(16, 24, [18, 18])}
    <g class="art-swing">
      <path d="M36 34h14a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H36l-6-7z" fill="var(--art-accent)"/>
      <circle cx="38" cy="41" r="2.2" fill="var(--art-paper)"/>
    </g>`),

  // A number, sitting where a page number sits.
  numbering: () => svg(`
    ${sheet(17, 8, { w: 30, h: 42 })}
    ${lines(23, 22, [16, 16, 12])}
    <g class="art-mark">
      <circle cx="32" cy="50" r="9" fill="var(--art-accent)"/>
      <text x="32" y="54.5" text-anchor="middle" font-size="12" font-weight="700"
            fill="var(--art-paper)" font-family="ui-sans-serif, system-ui, sans-serif">7</text>
    </g>`),

  // Tabs down the edge of a bundle.
  bookmarks: () => svg(`
    ${sheet(8, 10, { w: 34, h: 44 })}
    ${lines(14, 24, [18, 18, 12])}
    <g class="art-tabs">
      <rect class="art-tab" x="40" y="16" width="16" height="8" rx="2.5" fill="var(--art-accent)"/>
      <rect class="art-tab" x="40" y="28" width="12" height="8" rx="2.5" fill="var(--art-accent)" opacity="0.72"/>
      <rect class="art-tab" x="40" y="40" width="14" height="8" rx="2.5" fill="var(--art-accent)" opacity="0.5"/>
    </g>`),

  // A signature, mid-flourish.
  sign: () => svg(`
    ${sheet(10, 12, { w: 44, h: 36, fold: 8 })}
    <line x1="17" y1="40" x2="47" y2="40" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" opacity="0.35"/>
    <path class="art-write" d="M18 34c5-9 8 6 12-2s6 5 10-1 5 3 7 1" fill="none"
          stroke="var(--art-accent)" stroke-width="3" stroke-linecap="round"/>`),

  // Bars where the words were.
  redact: () => svg(`
    ${sheet(17, 10, { w: 30, h: 44 })}
    ${lines(23, 22, [18])}
    <rect class="art-bar" x="23" y="30" width="18" height="6" rx="1.5" fill="var(--art-accent)"/>
    <rect class="art-bar" x="23" y="40" width="11" height="6" rx="1.5" fill="var(--art-accent)"/>`),

  // A padlock, shackle drawn separately so it can click shut on hover.
  password: () => svg(`
    ${sheet(9, 10, { w: 30, h: 42 })}
    ${lines(15, 24, [16, 12])}
    <g class="art-lock">
      <path class="art-shackle" d="M34 40v-5a8 8 0 0 1 16 0v5" fill="none" stroke="currentColor"
            stroke-width="2.8" stroke-linecap="round"/>
      <rect x="30" y="39" width="24" height="18" rx="4" fill="var(--art-accent)"/>
      <circle cx="42" cy="48" r="2.6" fill="var(--art-paper)"/>
    </g>`),

  // The full workspace, drawn as one: thumbnails in a row with the marks the
  // room can put on them — a tab, a number badge, a bookmark, and the handle
  // that reorders them.
  pro: () => svg(`
    <rect x="3" y="9" width="58" height="46" rx="5" fill="none" stroke="currentColor"
          stroke-width="2.2" opacity="0.35"/>
    ${sheet(8, 16, { w: 14, h: 20, fold: 5 })}
    ${sheet(25, 16, { w: 14, h: 20, fold: 5 })}
    ${sheet(42, 16, { w: 14, h: 20, fold: 5 })}
    <rect class="art-tab" x="36" y="18" width="8" height="5" rx="1.5" fill="var(--art-accent)"/>
    <g class="art-mark">
      <circle cx="18" cy="34" r="4.6" fill="var(--art-accent)"/>
      <text x="18" y="36" text-anchor="middle" font-size="6" font-weight="700"
            fill="var(--art-paper)" font-family="ui-sans-serif, system-ui, sans-serif">1</text>
    </g>
    <g class="art-lift">
      <path d="M20 45h24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.4"/>
      <path d="M38 41l5 4-5 4" fill="none" stroke="var(--art-accent)" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),

  // Kept for the small square used beside the old workbench idea.
  'pro-plain': () => svg(`
    ${sheet(4, 14, { w: 22, h: 30, rotate: -6, fold: 7 })}
    ${sheet(22, 10, { w: 22, h: 30, fold: 7 })}
    ${sheet(40, 14, { w: 22, h: 30, rotate: 6, fold: 7 })}
    <g class="art-mark">
      <rect x="18" y="48" width="28" height="9" rx="4.5" fill="var(--art-accent)"/>
      <path d="M24 52.5h16" stroke="var(--art-paper)" stroke-width="2.6" stroke-linecap="round"/>
    </g>`),

  // Squeezed: the same page, pressed between two rules, arrow going down.
  compress: () => svg(`
    ${sheet(17, 14, { w: 30, h: 32, fold: 8 })}
    ${lines(23, 26, [16, 12])}
    <g class="art-squeeze">
      <path d="M12 8h40M12 54h40" stroke="currentColor" stroke-width="2.6"
            stroke-linecap="round" opacity="0.45"/>
      <path d="M32 46v8M28 50l4 4 4-4" fill="none" stroke="var(--art-accent)"
            stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),

  // A page becoming pictures: the sheet steps aside and photo cards come out.
  'to-images': () => svg(`
    ${sheet(4, 14, { w: 24, h: 34, fold: 7 })}
    ${lines(10, 26, [12, 12])}
    <g class="art-card">
      <rect x="30" y="12" width="24" height="20" rx="3" fill="var(--art-paper)"
            stroke="currentColor" stroke-width="2.4"/>
      <circle cx="36" cy="19" r="2.4" fill="var(--art-accent)"/>
      <path d="M32 29l6-7 5 5 3-3 6 5" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="36" y="34" width="24" height="20" rx="3" fill="var(--art-paper)"
            stroke="currentColor" stroke-width="2.4"/>
      <circle cx="42" cy="41" r="2.4" fill="var(--art-accent)"/>
      <path d="M38 51l6-7 5 5 3-3 6 5" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),

  // --- the steps of the process, drawn in the same paper language ----------

  // Choosing: a small shelf of tool tiles, one of them picked.
  'step-choose': () => svg(`
    <rect x="6" y="10" width="22" height="20" rx="4" fill="var(--art-paper)" stroke="currentColor" stroke-width="2.4"/>
    <rect x="36" y="10" width="22" height="20" rx="4" fill="var(--art-accent)" stroke="currentColor" stroke-width="2.4"/>
    <rect x="6" y="36" width="22" height="20" rx="4" fill="var(--art-paper)" stroke="currentColor" stroke-width="2.4"/>
    <rect x="36" y="36" width="22" height="20" rx="4" fill="var(--art-paper)" stroke="currentColor" stroke-width="2.4"/>
    <path class="art-mark" d="M41.5 20l4 4 7-8" fill="none" stroke="var(--art-paper)" stroke-width="2.8"
          stroke-linecap="round" stroke-linejoin="round"/>`),

  // Adding: a page with a plus landing on it.
  'step-add': () => svg(`
    ${sheet(17, 20, { w: 30, h: 38 })}
    ${lines(23, 36, [16, 12])}
    <g class="art-mark">
      <circle cx="32" cy="14" r="10" fill="var(--art-accent)"/>
      <path d="M32 9v10M27 14h10" stroke="var(--art-paper)" stroke-width="2.6" stroke-linecap="round"/>
    </g>`),

  // Downloading: the finished page dropping into a tray.
  'step-download': () => svg(`
    ${sheet(19, 4, { w: 26, h: 34, fold: 8 })}
    ${lines(25, 18, [14, 10])}
    <path d="M10 44v10a3 3 0 0 0 3 3h38a3 3 0 0 0 3-3V44" fill="none" stroke="currentColor"
          stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="art-mark">
      <circle cx="32" cy="46" r="9" fill="var(--art-accent)"/>
      <path d="M32 41v9M28 46.5l4 4 4-4" fill="none" stroke="var(--art-paper)" stroke-width="2.6"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),

  // Not a tool: the note about scanned pages.
  ocr: () => svg(`
    ${sheet(10, 10, { w: 34, h: 44 })}
    <g opacity="0.45">${lines(16, 24, [18, 18, 12])}</g>
    <g class="art-scan">
      <path d="M40 20h10v8M50 44v8H40M24 52H14v-8M14 28v-8h10" fill="none"
            stroke="var(--art-accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`),
}

// The one tool without a drawing gets the plain sheet, which still belongs to
// the family rather than looking like a mistake.
export function toolArt(id) {
  return (ART[id] ?? (() => svg(sheet(17, 10) + lines(23, 24, [16, 16, 10]))))()
}

// --- the hero -------------------------------------------------------------

// The whole promise in one picture: a mess on the left, a finished document on
// the right, and the tool in between doing the work.
export function heroScene() {
  return `<svg class="hero-art" viewBox="0 0 300 170" role="img"
       aria-label="A messy pile of pages becoming one neat, finished PDF">
    <g class="hero-mess">
      ${sheet(14, 44, { w: 46, h: 60, rotate: -14, fold: 12 })}
      ${sheet(30, 34, { w: 46, h: 60, rotate: 7, fold: 12 })}
      ${sheet(22, 56, { w: 46, h: 60, rotate: -3, fold: 12 })}
    </g>

    <g class="hero-arrow">
      <path d="M120 86h48" fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round" opacity="0.5"/>
      <path d="M160 78l9 8-9 8" fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    </g>

    <g class="hero-tidy">
      ${sheet(196, 36, { w: 62, h: 82, fold: 16 })}
      ${lines(210, 66, [34, 34, 24, 34], { gap: 11 })}
      <g class="hero-stamp">
        <circle cx="252" cy="112" r="19" fill="var(--art-accent)"/>
        <path d="M244 112l5.5 5.5L261 106" fill="none" stroke="var(--art-paper)"
              stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </g>
  </svg>`
}
