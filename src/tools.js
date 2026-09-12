// ---------------------------------------------------------------------------
// tools.js — the front doors.
//
// Every tool is the SAME editor with different parts shown. A tool definition
// says which sidebar panels appear, which page actions appear, and what the
// main button does. Nothing here duplicates any behaviour.
// ---------------------------------------------------------------------------

// Sidebar panels every tool gets: the file list, and the save controls.
export const ALWAYS_PANELS = ['panel-saving']

// How the tools are grouped on the front page. A category is a shelf in the
// workshop, not a taxonomy: four of them, named for what you came to do.
export const CATEGORIES = [
  { id: 'arrange', name: 'Organise' },
  { id: 'add', name: 'Add and edit' },
  { id: 'protect', name: 'Convert and protect' },
]

// The pages that are not tools. Kept apart from TOOLS so a route can never
// resolve to a workspace that does not exist.
export const PAGES = ['tools', 'legal']
export const isPage = (id) => PAGES.includes(id)

// Tools worth putting in front of someone preparing a filing bundle. Every one
// of these exists and works today; nothing here is aspirational.
export const LEGAL_TOOL_IDS = ['merge', 'bookmarks', 'numbering', 'label', 'redact', 'password']

export const TOOLS = {
  // The full workspace. Named in full where there is room, and "Control Room"
  // where there is not. Nothing about how it works changed with the name.
  pro: {
    name: 'PDF Control Room',
    shortName: 'Control Room',
    subtitle: 'Prepare your document in one place.',
    description: 'Your all-in-one workspace for preparing, organising and finishing PDFs.',
    blurb: 'Reorder pages, add annexure numbers and text, apply page numbers, watermark documents, create bookmarks and download the finished PDF.',
    phrase: 'Everything you need to prepare a document in one place.',
    icon: '⌘',
    panels: 'all',
    pageActions: 'all',
    primary: 'save',
    primaryLabel: 'Save PDF',
    // Every one of these exists today; nothing here is aspirational.
    features: [
      'Reorder pages',
      'Rotate and delete pages',
      'Add text and annexure numbers',
      'Add page numbers',
      'Watermark pages',
      'Extract and split pages',
      'Add bookmarks',
    ],
  },

  'photo-watermark': {
    name: 'Add a watermark',
    phrase: 'Make your mark',
    category: 'add',
    featured: true,
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
    phrase: 'Turn snaps into documents',
    category: 'protect',
    featured: true,
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
    phrase: 'Make one tidy file',
    category: 'arrange',
    featured: true,
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
    phrase: 'Put pages in line',
    category: 'arrange',
    featured: true,
    blurb: 'Drag pages into the order you want. Remove the ones you do not need.',
    icon: '⇅',
    colour: '#4f46e5',
    panels: [],
    pageActions: ['select-all', 'select-none', 'duplicate', 'delete', 'view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Drag pages to reorder. Press × on a page to delete it, or select several and press Delete.',
  },

  rotate: {
    name: 'Rotate pages',
    phrase: 'The right way up',
    category: 'arrange',
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
    phrase: 'Tabs down the side',
    category: 'add',
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
    phrase: 'Your name, on the page',
    category: 'add',
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
    phrase: 'Every page accounted for',
    category: 'add',
    blurb: 'Bates numbering, "Page 1 of 10", or plain numbers.',
    icon: '№',
    colour: '#0369a1',
    panels: ['panel-numbering'],
    pageActions: ['view'],
    primary: 'save',
    primaryLabel: 'Save numbered PDF',
    hint: 'Tick "Number the pages", choose a style, and place it on the page if you want it somewhere else.',
  },

  // The id stays "label" so links people have saved keep working.
  label: {
    name: 'Add text on pages',
    phrase: 'Annexure P-1, Certified True Copy',
    category: 'add',
    blurb: 'Put Annexure P-1, Exhibit A, Certified True Copy or your own words on chosen pages. Numbers can count up by themselves.',
    icon: '🏷',
    colour: '#be123c',
    panels: ['panel-label'],
    pageActions: ['select-all', 'select-none', 'view'],
    primary: 'save',
    primaryLabel: 'Save PDF',
    hint: 'Type what to write, choose the pages, then place it on the page.',
  },

  extract: {
    name: 'Extract pages',
    phrase: 'Take just what you need',
    category: 'arrange',
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
    phrase: 'One file becomes many',
    category: 'arrange',
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
    phrase: 'Lock it, or unlock it',
    category: 'protect',
    featured: true,
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
    phrase: 'Gone, not just hidden',
    category: 'protect',
    featured: true,
    blurb: 'Black out text so it is destroyed, not just covered over. Search for a name or number to find every mention.',
    icon: '█',
    colour: '#334155',
    panels: [],
    pageActions: ['view', 'redact'],
    // The redaction view covers the whole document, so choosing pages first
    // does nothing here, and the selection controls would only get in the way.
    hidesSelection: true,
    primary: 'save',
    primaryLabel: 'Save redacted PDF',
    hint: 'Open the redaction view, scroll, and drag boxes over what must go.',
    note: 'Redaction works across the whole document. Scroll through every page and drag boxes over anything that must go, or search for a name to find every mention.',
  },

  compress: {
    name: 'Make a PDF smaller',
    phrase: 'Send it without it bouncing',
    category: 'protect',
    featured: true,
    blurb: 'Shrink a heavy file so it fits in an email. Pages become pictures, so the text stops being searchable.',
    icon: '↓',
    colour: '#5c7a56',
    panels: ['panel-compress'],
    pageActions: ['view'],
    primary: 'compress',
    primaryLabel: 'Save smaller PDF',
    hint: 'Choose how small, then save.',
    // Shrinking IS flattening, so the tool turns it on and drives it.
    defaults: { compress: 'balanced' },
  },

  'to-images': {
    name: 'PDF to images',
    phrase: 'Free the pages',
    category: 'protect',
    blurb: 'Turn each page into a PNG or JPEG. More than one page comes back as a zip.',
    icon: '▦',
    colour: '#7a4a6b',
    panels: ['panel-images'],
    pageActions: ['view'],
    primary: 'images',
    primaryLabel: 'Save images',
    hint: 'Pick a format, then save. One file per page.',
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
  'numbering', 'label', 'redact', 'password', 'compress', 'to-images',
  // Not ready yet, so they go last.
  'sign', 'ocr',
]

export const getTool = (id) => TOOLS[id] ?? null

// The handful given a large card at the top of the page.
export const FEATURED_TOOL_IDS = SIMPLE_TOOL_IDS.filter((id) => TOOLS[id].featured)

export const toolsInCategory = (category) =>
  SIMPLE_TOOL_IDS.filter((id) => TOOLS[id].category === category)

// A tool that is listed but not ready. Its card shows, greyed, so people can
// see it is on the way rather than wondering whether it exists.
export const isComingSoon = (id) => Boolean(TOOLS[id]?.comingSoon)

// The tool named in the address bar, e.g. .../#watermark. Empty means the
// landing page. Using the hash means every tool has its own bookmarkable link
// without needing a server that knows about routes.
export const currentToolId = () => location.hash.replace('#', '')

export const goToTool = (id) => { location.hash = id }
export const goToLanding = () => { location.hash = '' }
