// ---------------------------------------------------------------------------
// tools.js — the front doors.
//
// Every tool is the SAME editor with different parts shown. A tool definition
// says which sidebar panels appear, which page actions appear, and what the
// main button does. Nothing here duplicates any behaviour.
// ---------------------------------------------------------------------------

// Sidebar panels every tool gets: the file list, and the save controls.
export const ALWAYS_PANELS = ['panel-files', 'panel-saving']

export const TOOLS = {
  pro: {
    name: 'Full editor',
    blurb: 'Everything at once — merge, reorder, rotate, label, number, watermark, redact and split in one pass.',
    icon: '⌘',
    panels: 'all',
    pageActions: 'all',
    primary: 'save',
    primaryLabel: 'Save PDF',
  },

  'photo-watermark': {
    name: 'Add a watermark',
    blurb: 'Stamp DRAFT, CONFIDENTIAL or your own wording across a legal document, a contract, or a photographed PAN or Aadhaar.',
    icon: '▧',
    colour: '#7c3aed',
    panels: ['panel-photos', 'panel-watermark'],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'save',
    primaryLabel: 'Save watermarked file',
    hint: 'Add a PDF, or a photo — on a phone that opens the camera. The watermark is already switched on.',
    // Opening this tool should not mean setting up the thing it is named
    // after. Applied only when a watermark is not already configured, so a
    // saved preset is never overwritten.
    defaults: {
      watermark: {
        enabled: true,
        tiled: true,
        text: 'FOR VERIFICATION ONLY',
        size: 22,
        opacity: 0.32,
        angle: 45,
      },
      // An ID card is not A4. Matching the photo avoids a small card marooned
      // in the middle of a sheet of white.
      photoPageSize: 'match',
    },
  },

  photos: {
    name: 'Photos to PDF',
    blurb: 'Photograph documents with your phone and turn them into a PDF.',
    icon: '⛶',
    colour: '#b45309',
    colour: '#0891b2',
    panels: ['panel-photos'],
    pageActions: ['select-all', 'select-none', 'delete', 'view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Add photos — on a phone this offers the camera. Drag pages to reorder.',
  },

  merge: {
    name: 'Merge PDFs',
    blurb: 'Combine several files into one. Drag the pages to change the order.',
    icon: '⊕',
    colour: '#2563eb',
    panels: [],
    pageActions: ['select-all', 'select-none', 'delete', 'view'],
    primary: 'save',
    primaryLabel: 'Save merged PDF',
    hint: 'Add two or more PDFs. Drag pages to reorder, then save.',
  },

  organise: {
    name: 'Reorder & delete pages',
    blurb: 'Drag pages into the order you want. Remove the ones you do not need.',
    icon: '⇅',
    colour: '#4f46e5',
    panels: [],
    pageActions: ['select-all', 'select-none', 'duplicate', 'delete', 'view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Drag pages to reorder. Select any you want to delete.',
  },

  rotate: {
    name: 'Rotate pages',
    blurb: 'Turn sideways or upside-down pages the right way up.',
    icon: '↻',
    colour: '#0d9488',
    panels: [],
    pageActions: ['select-all', 'select-none', 'rotate-left', 'rotate-right', 'view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Select the pages to turn, then use Rotate left or Rotate right.',
  },

  bookmarks: {
    name: 'Bookmark a bundle',
    blurb: 'Merge documents and add the navigation panel Acrobat shows down the side.',
    icon: '☰',
    colour: '#c2410c',
    panels: ['panel-bookmarks'],
    pageActions: ['select-all', 'select-none', 'delete', 'view'],
    primary: 'save',
    primaryLabel: 'Save bookmarked PDF',
    hint: 'Each file you add is bookmarked automatically. Select a page to add more.',
  },

  sign: {
    name: 'Sign a document',
    blurb: 'Drop a picture of your signature onto a page — or onto every page.',
    icon: '✍',
    colour: '#65a30d',
    // Disabled for now: the placement and background removal are not good
    // enough to put in front of anyone. The code is all still here.
    comingSoon: true,
    panels: ['panel-signatures'],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'save',
    primaryLabel: 'Save signed PDF',
    hint: 'Add a signature image, click the page to sign, then place it.',
  },

  numbering: {
    name: 'Number the pages',
    blurb: 'Bates numbering, "Page 1 of 10", or plain numbers.',
    icon: '№',
    colour: '#0369a1',
    panels: ['panel-numbering'],
    pageActions: ['view'],
    primary: 'save',
    primaryLabel: 'Save numbered PDF',
    hint: 'Tick "Number the pages" in the sidebar, choose a style, then save.',
  },

  label: {
    name: 'Label pages',
    blurb: 'Stamp exhibit numbers or a confidentiality notice onto chosen pages.',
    icon: '🏷',
    colour: '#be123c',
    panels: ['panel-label'],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'save',
    primaryLabel: 'Save labelled PDF',
    hint: 'Select the pages to mark, type the label, then add it.',
  },

  extract: {
    name: 'Extract pages',
    blurb: 'Pull out just the pages you need as a new file.',
    icon: '⇥',
    colour: '#db2777',
    panels: [],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'extract',
    primaryLabel: 'Save selected pages',
    hint: 'Click the pages you want to keep, then save.',
  },

  split: {
    name: 'Split a PDF',
    blurb: 'Break one document into several files.',
    icon: '✂',
    colour: '#9333ea',
    panels: [],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'split',
    primaryLabel: 'Split',
    hint: 'Choose how to split it in the sidebar, then press Split.',
  },

  password: {
    name: 'Add or remove a password',
    blurb: 'Lock a PDF with a password, or take one off a file whose password you have.',
    icon: '⚿',
    colour: '#475569',
    panels: ['panel-password'],
    pageActions: ['view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Add a PDF. A protected one asks for its password. Then set a new password, or save without one to remove it.',
  },

  redact: {
    name: 'Redact',
    blurb: 'Black out text so it is destroyed, not just covered over.',
    icon: '█',
    colour: '#334155',
    panels: [],
    pageActions: ['select-none', 'view', 'redact'],
    primary: 'save',
    primaryLabel: 'Save redacted PDF',
    hint: 'Click one page, press Redact, then drag boxes over what must go.',
  },

  ocr: {
    name: 'PDF scan and OCR',
    blurb: 'Turn a scanned or photographed document into searchable text — on your device, like everything else here.',
    icon: 'Aa',
    colour: '#9333ea',
    // Listed so people know it is coming; nothing behind it yet.
    comingSoon: true,
    panels: [],
    pageActions: ['view'],
    primary: 'save',
    primaryLabel: 'Save searchable PDF',
    hint: 'Coming soon.',
  },
}

// The order they appear on the landing page. Pro sits apart from the rest.
export const SIMPLE_TOOL_IDS = [
  'merge', 'photo-watermark', 'photos', 'bookmarks', 'organise', 'rotate', 'extract', 'split',
  'numbering', 'label', 'redact', 'password',
  // Not ready yet, so they go last.
  'sign', 'ocr',
]

export const getTool = (id) => TOOLS[id] ?? null

// A tool that is listed but not ready. Its card shows, greyed, so people can
// see it is on the way rather than wondering whether it exists.
export const isComingSoon = (id) => Boolean(TOOLS[id]?.comingSoon)

// The tool named in the address bar, e.g. .../#watermark. Empty means the
// landing page. Using the hash means every tool has its own bookmarkable link
// without needing a server that knows about routes.
export const currentToolId = () => location.hash.replace('#', '')

export const goToTool = (id) => { location.hash = id }
export const goToLanding = () => { location.hash = '' }
