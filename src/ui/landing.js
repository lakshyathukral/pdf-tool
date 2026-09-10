// ---------------------------------------------------------------------------
// ui/landing.js — the three pages that are not a tool: the front page, the
// full list of tools, and the legal page.
//
// All three are drawn into one container from the address bar, so a link like
// #legal is bookmarkable and the back button works without any extra code.
//
// Nothing here touches a PDF. It picks a tool and gets out of the way.
// ---------------------------------------------------------------------------

import {
  TOOLS, SIMPLE_TOOL_IDS, FEATURED_TOOL_IDS, LEGAL_TOOL_IDS,
  CATEGORIES, toolsInCategory, goToTool, isComingSoon,
} from '../tools.js'
import { toolArt, heroScene } from './illustrations.js'

const root = document.querySelector('#app-landing')

// The claim, in one place, so it can never drift between pages. Every word of
// it is verified: no document ever reaches the network, there is no account,
// and nothing about a document is written to storage.
const PROMISE = 'Your files never leave your device.'
const PROMISE_SUB = 'Processed locally in your browser. No uploads. No account.'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function openPrivacy() {
  document.querySelector('#security-dialog').showModal()
}

// --- tool cards -------------------------------------------------------------

// One card shape, two sizes. `large` is for the handful on the front page.
function toolCard(id, { large = false } = {}) {
  const tool = TOOLS[id]
  const soon = isComingSoon(id)

  const card = el('button', large ? 'tcard large' : 'tcard')
  card.type = 'button'
  card.dataset.tool = id
  card.dataset.category = tool.category ?? ''
  card.style.setProperty('--art-accent', tool.colour ?? 'var(--cobalt)')

  const art = el('span', 'tcard-art')
  art.innerHTML = toolArt(id)
  art.setAttribute('aria-hidden', 'true')

  const name = el('span', 'tcard-name', tool.name)
  const phrase = el('span', 'tcard-phrase', tool.phrase ?? '')

  card.append(art, name, phrase)

  if (soon) {
    // The badge sits in the corner rather than inside the title, where a long
    // name pushed it on top of itself.
    card.classList.add('soon')
    card.disabled = true
    card.append(el('span', 'tcard-soon', 'Coming soon'))
  } else {
    card.addEventListener('click', () => goToTool(id))
  }

  return card
}

function toolGrid(ids, { large = false } = {}) {
  const grid = el('div', large ? 'tgrid large' : 'tgrid')
  grid.append(...ids.map((id) => toolCard(id, { large })))
  return grid
}

// The workspace gets its own card shape: wider, darker-edged, and carrying a
// call to action, so it reads as a different kind of thing from a quick tool.
function controlRoomCard() {
  const tool = TOOLS.pro
  const card = el('button', 'croom-card')
  card.type = 'button'
  card.addEventListener('click', () => goToTool('pro'))

  const art = el('span', 'croom-art')
  art.innerHTML = toolArt('pro')
  art.setAttribute('aria-hidden', 'true')

  const words = el('span', 'croom-words')
  words.append(
    el('span', 'croom-name', tool.name),
    el('span', 'croom-phrase', tool.phrase),
    el('span', 'croom-cta', 'Open Control Room'),
  )

  card.append(art, words)
  return card
}

// --- shared pieces ----------------------------------------------------------

// The three claims, stated as facts rather than sold.
function proofRow() {
  const row = el('ul', 'proof')
  for (const claim of ['No uploads', 'No account', 'No file storage']) {
    const item = el('li')
    item.append(el('span', 'proof-tick', '✓'), document.createTextNode(claim))
    row.append(item)
  }
  return row
}

function privacyNote() {
  const note = el('p', 'privacy-note')
  note.append(el('span', 'dot'), document.createTextNode(PROMISE + ' '))
  const link = el('button', 'linky', 'How local processing works')
  link.type = 'button'
  link.addEventListener('click', openPrivacy)
  note.append(link)
  return note
}

function steps(items) {
  const list = el('ol', 'steps')
  for (const [i, text] of items.entries()) {
    const step = el('li')
    step.append(el('span', 'step-n', String(i + 1)), el('span', 'step-t', text))
    list.append(step)
  }
  return list
}

function section(title, { note = '', dark = false } = {}) {
  const node = el('section', dark ? 'band dark' : 'band')
  if (title) node.append(el('h2', 'band-title', title))
  if (note) node.append(el('p', 'band-note', note))
  return node
}

// --- the front page ---------------------------------------------------------

function renderHome() {
  const page = el('div', 'page')

  // Hero.
  const hero = el('section', 'hero')
  const words = el('div', 'hero-words')
  words.append(
    el('h1', 'hero-title', PROMISE),
    el('p', 'hero-sub', 'Edit, organise and protect PDFs directly in your browser.'),
  )

  const actions = el('div', 'hero-actions')
  const cta = el('button', 'btn primary', 'Choose a tool')
  cta.type = 'button'
  cta.addEventListener('click', () => { location.hash = 'tools' })
  const how = el('button', 'linky', 'How local processing works')
  how.type = 'button'
  how.addEventListener('click', openPrivacy)
  actions.append(cta, how)

  words.append(actions, proofRow())

  const art = el('div', 'hero-scene')
  art.innerHTML = heroScene()
  art.setAttribute('aria-hidden', 'false')

  hero.append(words, art)
  page.append(hero)

  // Popular tools, led by the workspace.
  const popular = section('Popular tools')
  popular.append(controlRoomCard(), toolGrid(FEATURED_TOOL_IDS.slice(0, 6), { large: true }))
  page.append(popular)

  // The legal band.
  const legal = section('Sensitive documents. Kept local.', { dark: true })
  legal.append(el('p', 'band-note',
    'Prepare bundles, annexures, indexes and redactions without uploading files.'))

  const bundle = el('div', 'bundle-art')
  bundle.innerHTML = bundleScene()
  bundle.setAttribute('aria-hidden', 'true')

  const legalList = el('ul', 'legal-list')
  for (const [name, id] of [
    ['Build a bundle', 'merge'],
    ['Bookmarks and index', 'bookmarks'],
    ['Bates numbering', 'numbering'],
    ['Label annexures', 'label'],
  ]) {
    const item = el('li')
    const link = el('button', 'legal-link', name)
    link.type = 'button'
    link.addEventListener('click', () => goToTool(id))
    item.append(link)
    legalList.append(item)
  }

  const legalCta = el('button', 'btn ghost', 'Explore legal PDF tools')
  legalCta.type = 'button'
  legalCta.addEventListener('click', () => { location.hash = 'legal' })

  const legalBody = el('div', 'band-split')
  const legalWords = el('div')
  legalWords.append(legalList, legalCta)
  legalBody.append(legalWords, bundle)
  legal.append(legalBody)
  page.append(legal)

  // How it goes.
  const flow = section('Three steps, every time')
  flow.append(steps(['Choose a tool', 'Add your documents', 'Download your PDF']))
  page.append(flow)

  return page
}

// A bundle of tabbed documents. Generic tabs only: no court, no authority, no
// implication that this is anyone's official anything.
function bundleScene() {
  const tabs = ['INDEX', 'ANNEXURE A', 'EXHIBIT', 'AGREEMENT']

  // The tab is sized to its word. A fixed width clipped the longer ones.
  const rows = tabs
    .map((label, i) => {
      const w = Math.max(42, label.length * 5.4 + 14)
      return `
      <g transform="translate(0 ${i * 26})">
        <rect x="8" y="14" width="142" height="22" rx="3" fill="var(--art-paper)"
              stroke="currentColor" stroke-width="2"/>
        <rect x="140" y="17" width="${w}" height="16" rx="3" fill="var(--art-accent)"
              opacity="${1 - i * 0.14}"/>
        <text x="${140 + w / 2}" y="28.2" text-anchor="middle" font-size="7.5" font-weight="700"
              letter-spacing="0.4" fill="var(--navy)"
              font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>
      </g>`
    })
    .join('')

  return `<svg viewBox="0 0 232 132" role="img" aria-label="A bundle of tabbed documents">
    ${rows}
  </svg>`
}

// --- all tools --------------------------------------------------------------

function renderTools() {
  const page = el('div', 'page')

  const hero = el('section', 'hero narrow')
  const words = el('div', 'hero-words')
  words.append(
    el('p', 'eyebrow', 'ALL TOOLS'),
    el('h1', 'hero-title', 'One clear job at a time.'),
    el('p', 'hero-sub', 'Choose a tool. Your files stay on your device while you work.'),
    privacyNote(),
  )
  hero.append(words)
  page.append(hero)

  // The workspace, offered before the list of single jobs, for anyone who
  // needs more than one of them.
  const feature = el('section', 'croom-feature')
  const featureWords = el('div', 'croom-feature-words')
  featureWords.append(
    el('p', 'eyebrow', 'YOUR FULL WORKSPACE'),
    el('h2', 'croom-feature-title', 'Need more than one tool?'),
    el('p', 'croom-feature-note',
      'Open PDF Control Room to organise and prepare your document in one workspace.'),
  )

  const featureList = el('ul', 'croom-features')
  for (const item of TOOLS.pro.features) {
    const li = el('li')
    li.append(el('span', 'proof-tick', '✓'), document.createTextNode(item))
    featureList.append(li)
  }
  featureWords.append(featureList)

  const featureCta = el('button', 'btn primary', 'Open Control Room')
  featureCta.type = 'button'
  featureCta.addEventListener('click', () => goToTool('pro'))
  featureWords.append(featureCta)

  const featureArt = el('div', 'croom-feature-art')
  featureArt.innerHTML = toolArt('pro')
  featureArt.setAttribute('aria-hidden', 'true')

  feature.append(featureWords, featureArt)
  page.append(feature)

  // Search and filters.
  const finder = el('div', 'finder')

  const search = el('input', 'search')
  search.type = 'search'
  search.id = 'tool-search'
  search.placeholder = 'Find a PDF tool'
  search.setAttribute('aria-label', 'Find a PDF tool')

  const filters = el('div', 'filters')
  filters.setAttribute('role', 'group')
  filters.setAttribute('aria-label', 'Filter tools by kind')

  const buttons = []
  for (const { id, name } of [{ id: 'all', name: 'All' }, ...CATEGORIES]) {
    const button = el('button', 'chip', name)
    button.type = 'button'
    button.dataset.filter = id
    button.setAttribute('aria-pressed', String(id === 'all'))
    if (id === 'all') button.classList.add('on')
    buttons.push(button)
    filters.append(button)
  }

  finder.append(search, filters)
  page.append(finder)

  // Every working tool, grouped.
  const listing = el('div', 'listing')
  for (const category of CATEGORIES) {
    const ids = toolsInCategory(category.id).filter((id) => !isComingSoon(id))
    if (ids.length === 0) continue

    const group = el('section', 'group')
    group.dataset.category = category.id
    group.append(el('h2', 'group-title', category.name), toolGrid(ids))
    listing.append(group)
  }

  // Anything not ready is still shown, so nothing silently disappears.
  const soon = SIMPLE_TOOL_IDS.filter(isComingSoon)
  if (soon.length > 0) {
    const group = el('section', 'group soon-group')
    group.dataset.category = 'soon'
    group.append(el('h2', 'group-title', 'Not ready yet'), toolGrid(soon))
    listing.append(group)
  }

  page.append(listing)

  const empty = el('p', 'finder-empty', 'No tool matches that. Try a different word.')
  empty.hidden = true
  page.append(empty)

  // Filtering happens here rather than by redrawing, so focus is never lost
  // from the search box while someone is still typing.
  const apply = () => {
    const term = search.value.trim().toLowerCase()
    const active = filters.querySelector('.chip.on')?.dataset.filter ?? 'all'
    let shown = 0

    for (const card of listing.querySelectorAll('.tcard')) {
      const tool = TOOLS[card.dataset.tool]
      const haystack = `${tool.name} ${tool.phrase ?? ''} ${tool.blurb ?? ''}`.toLowerCase()
      const matches = term === '' || haystack.includes(term)
      const inCategory = active === 'all' || card.dataset.category === active
      const visible = matches && inCategory
      card.hidden = !visible
      if (visible) shown += 1
    }

    for (const group of listing.querySelectorAll('.group')) {
      group.hidden = [...group.querySelectorAll('.tcard')].every((c) => c.hidden)
    }

    empty.hidden = shown > 0
  }

  search.addEventListener('input', apply)
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) {
        const on = other === button
        other.classList.toggle('on', on)
        other.setAttribute('aria-pressed', String(on))
      }
      apply()
    })
  }

  // Legal callout.
  const callout = el('section', 'callout')
  callout.append(
    el('h2', 'callout-title', 'Preparing a legal bundle?'),
    el('p', 'callout-note', 'Explore tools for indexes, Bates numbers, annexures and redactions.'),
  )
  const calloutCta = el('button', 'btn primary', 'Explore legal PDF tools')
  calloutCta.type = 'button'
  calloutCta.addEventListener('click', () => { location.hash = 'legal' })
  callout.append(calloutCta)
  page.append(callout)

  return page
}

// --- legal ------------------------------------------------------------------

function renderLegal() {
  const page = el('div', 'page')

  const hero = el('section', 'hero')
  const words = el('div', 'hero-words')
  words.append(
    el('p', 'eyebrow', 'FRESHER PDFS FOR LEGAL'),
    el('h1', 'hero-title', 'Prepare legal documents with confidence.'),
    el('p', 'hero-sub',
      'Build tidy filing bundles, organise annexures and protect sensitive material '
      + 'without uploading files.'),
  )

  const cta = el('button', 'btn primary', 'Choose a legal tool')
  cta.type = 'button'
  cta.addEventListener('click', () => goToTool('merge'))
  const actions = el('div', 'hero-actions')
  actions.append(cta)
  words.append(actions, privacyNote())

  const art = el('div', 'hero-scene bundle-art')
  art.innerHTML = bundleScene()
  art.setAttribute('aria-hidden', 'true')

  hero.append(words, art)
  page.append(hero)

  const tools = section('Tools for a filing bundle')
  tools.append(toolGrid(LEGAL_TOOL_IDS))
  page.append(tools)

  // The workspace, framed for a bundle.
  const room = el('section', 'croom-block')
  const roomWords = el('div')
  roomWords.append(
    el('p', 'eyebrow', 'ONE WORKSPACE'),
    el('h2', 'croom-feature-title', 'Prepare the whole bundle in Control Room.'),
    el('p', 'croom-feature-note',
      'Arrange pages, add bookmarks, apply Bates numbers, label annexures and review '
      + 'the final PDF before download.'),
  )
  const roomCta = el('button', 'btn primary', 'Open PDF Control Room')
  roomCta.type = 'button'
  roomCta.addEventListener('click', () => goToTool('pro'))
  roomWords.append(roomCta)

  const roomArt = el('div', 'croom-feature-art')
  roomArt.innerHTML = toolArt('pro')
  roomArt.setAttribute('aria-hidden', 'true')

  room.append(roomWords, roomArt)
  page.append(room)

  const flow = section('From loose documents to a clear bundle.')
  const scene = el('div', 'flow-art')
  scene.innerHTML = bundleFlow()
  scene.setAttribute('aria-hidden', 'true')
  flow.append(scene, steps(['Arrange', 'Index', 'Number', 'Download']))
  page.append(flow)

  return page
}

// Loose papers on the left, one finished bundle on the right.
function bundleFlow() {
  const names = ['PETITION', 'AFFIDAVIT', 'ANNEXURE A', 'AGREEMENT']
  // Sized so the longest name still sits inside its page.
  const loose = names
    .map((label, i) => `
      <g transform="translate(${i * 46} ${i % 2 ? 8 : 0}) rotate(${i % 2 ? 4 : -4} 28 34)">
        <rect x="6" y="10" width="44" height="52" rx="3" fill="var(--art-paper)"
              stroke="currentColor" stroke-width="2"/>
        <text x="28" y="39" text-anchor="middle" font-size="5" font-weight="700"
              fill="currentColor" opacity="0.75" letter-spacing="0.2"
              font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>
      </g>`)
    .join('')

  return `<svg viewBox="0 0 350 80" role="img"
       aria-label="Loose documents becoming one case bundle">
    ${loose}
    <path d="M216 40h34" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" opacity="0.5"/>
    <path d="M244 34l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <g transform="translate(268 0)">
      <rect x="6" y="6" width="52" height="64" rx="4" fill="var(--art-paper)"
            stroke="currentColor" stroke-width="2.5"/>
      <rect x="52" y="14" width="22" height="10" rx="2" fill="var(--art-accent)"/>
      <rect x="52" y="30" width="18" height="10" rx="2" fill="var(--art-accent)" opacity="0.7"/>
      <rect x="52" y="46" width="20" height="10" rx="2" fill="var(--art-accent)" opacity="0.5"/>
      <text x="32" y="42" text-anchor="middle" font-size="7" font-weight="700"
            fill="currentColor" font-family="ui-sans-serif, system-ui, sans-serif">CASE</text>
      <text x="32" y="52" text-anchor="middle" font-size="7" font-weight="700"
            fill="currentColor" font-family="ui-sans-serif, system-ui, sans-serif">BUNDLE</text>
    </g>
  </svg>`
}

// --- routing ----------------------------------------------------------------

const PAGE_RENDERERS = { tools: renderTools, legal: renderLegal }

export function drawLanding() {
  const id = location.hash.replace('#', '')
  const render = PAGE_RENDERERS[id] ?? renderHome
  root.replaceChildren(render())
  root.scrollTop = 0
}

export function setupLanding() {
  document.querySelector('#nav-privacy').addEventListener('click', openPrivacy)

  // On a phone the links collapse behind a menu button. Closing on any choice
  // means the menu never stays open over the page someone just asked for.
  const toggle = document.querySelector('#nav-toggle')
  const nav = document.querySelector('#site-nav')

  const setOpen = (open) => {
    nav.classList.toggle('open', open)
    toggle.setAttribute('aria-expanded', String(open))
  }

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')))
  nav.addEventListener('click', (event) => {
    if (event.target.closest('.nav-link')) setOpen(false)
  })
  window.addEventListener('hashchange', () => setOpen(false))
}
