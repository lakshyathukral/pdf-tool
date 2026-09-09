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

  merge: {
    name: 'Merge PDFs',
    blurb: 'Combine several files into one. Drag the pages to change the order.',
    icon: '⊕',
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
    panels: ['panel-signatures'],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'save',
    primaryLabel: 'Save signed PDF',
    hint: 'Add a signature image, click the page to sign, then place it.',
  },

  watermark: {
    name: 'Add a watermark',
    blurb: 'Put DRAFT, CONFIDENTIAL or your own text across every page.',
    icon: '▨',
    panels: ['panel-watermark'],
    pageActions: ['view'],
    primary: 'save',
    primaryLabel: 'Save watermarked PDF',
    hint: 'Tick "Add a watermark" in the sidebar, then save.',
  },

  numbering: {
    name: 'Number the pages',
    blurb: 'Bates numbering, "Page 1 of 10", or plain numbers.',
    icon: '№',
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
    panels: [],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'split',
    primaryLabel: 'Split',
    hint: 'Choose how to split it in the sidebar, then press Split.',
  },

  redact: {
    name: 'Redact',
    blurb: 'Black out text so it is destroyed, not just covered over.',
    icon: '█',
    panels: [],
    pageActions: ['select-none', 'view', 'redact'],
    primary: 'save',
    primaryLabel: 'Save redacted PDF',
    hint: 'Click one page, press Redact, then drag boxes over what must go.',
  },
}

// The order they appear on the landing page. Pro sits apart from the rest.
export const SIMPLE_TOOL_IDS = [
  'merge', 'bookmarks', 'sign', 'organise', 'rotate', 'extract', 'split',
  'watermark', 'numbering', 'label', 'redact',
]

export const getTool = (id) => TOOLS[id] ?? null

// The tool named in the address bar, e.g. .../#watermark. Empty means the
// landing page. Using the hash means every tool has its own bookmarkable link
// without needing a server that knows about routes.
export const currentToolId = () => location.hash.replace('#', '')

export const goToTool = (id) => { location.hash = id }
export const goToLanding = () => { location.hash = '' }
