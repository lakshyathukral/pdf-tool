// ---------------------------------------------------------------------------
// ui/landing.js — the front page: pick a tool.
// ---------------------------------------------------------------------------

import { TOOLS, SIMPLE_TOOL_IDS, goToTool } from '../tools.js'

const grid = document.querySelector('#tool-grid')
const proCard = document.querySelector('#pro-card')

function makeCard(id, tool, big = false) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = big ? 'tool-card pro' : 'tool-card'
  card.addEventListener('click', () => goToTool(id))

  const icon = document.createElement('span')
  icon.className = 'tool-icon'
  icon.textContent = tool.icon
  icon.setAttribute('aria-hidden', 'true')

  const name = document.createElement('span')
  name.className = 'tool-name'
  name.textContent = tool.name

  const blurb = document.createElement('span')
  blurb.className = 'tool-blurb'
  blurb.textContent = tool.blurb

  card.append(icon, name, blurb)
  return card
}

export function drawLanding() {
  proCard.replaceChildren(makeCard('pro', TOOLS.pro, true))
  grid.replaceChildren(...SIMPLE_TOOL_IDS.map((id) => makeCard(id, TOOLS[id])))
}
