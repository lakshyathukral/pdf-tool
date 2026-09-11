import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { textOfEachPage } from '../helpers/read-pdf.js'

const FIVE_PAGES = fileURLToPath(new URL('../fixtures/five-pages.pdf', import.meta.url))
const THREE_PAGES = fileURLToPath(new URL('../fixtures/three-pages.pdf', import.meta.url))
const LOCKED = fileURLToPath(new URL('../fixtures/locked.pdf', import.meta.url))
const PHOTO_LANDSCAPE = fileURLToPath(new URL('../fixtures/photo-landscape.png', import.meta.url))
const PHOTO_PORTRAIT = fileURLToPath(new URL('../fixtures/photo-portrait.png', import.meta.url))

// Loading a PDF is the first thing every test needs, and the step that failed
// outright in Safari for a whole day.
async function load(page, files = [FIVE_PAGES]) {
  await page.goto('/#pro')
  await page.locator('#file-input').setInputFiles(files)
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
}

const tiles = (page) => page.locator('.tile')

// Only our own failures matter. The analytics beacon cannot reach its endpoint
// from a local test server, and that is not a bug in the app.
const THIRD_PARTY = [/cloudflareinsights/i]
const ours = (messages) => messages.filter((m) => !THIRD_PARTY.some((r) => r.test(m)))

// On a phone that can share files, saving opens the share sheet instead of
// downloading (Save to Files lives in there). A test browser has no share sheet
// to press, so where sharing exists it is swapped for one that just keeps the
// file, where the test can read it back.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (typeof navigator.share !== 'function') return
    navigator.share = async ({ files } = {}) => {
      const file = files?.[0]
      if (!file) return
      const bytes = new Uint8Array(await file.arrayBuffer())
      window.__shared = { name: file.name, bytes: Array.from(bytes) }
    }
  })
})

// Press whatever saves, and return the file however it arrived: a download on
// a computer, the share sheet on a phone. Tests care about the file, not the
// route it took.
async function savedFile(page, press) {
  const sharing = await page.evaluate(() => document.body.classList.contains('share-first'))

  if (!sharing) {
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await press()
    const file = await download
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
  }

  await page.evaluate(() => { window.__shared = null })
  await press()
  const handle = await page.waitForFunction(() => window.__shared, null, { timeout: 90_000 })
  const { name, bytes } = await handle.jsonValue()
  return { name, bytes: Buffer.from(bytes) }
}

const pressSave = (page) => () => page.locator('#primary-action').click()

test.describe('loading', () => {
  test('opens a PDF and renders every page', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await load(page)

    await expect(tiles(page)).toHaveCount(5)
    // The thumbnail must actually be an image, not the loading placeholder —
    // that distinction is the difference between "pdf.js ran" and "it didn't".
    await expect(page.locator('.tile img').first()).toBeVisible()
    expect(ours(errors)).toEqual([])
  })

  test('merges several files', async ({ page }) => {
    await load(page, [FIVE_PAGES, THREE_PAGES])
    await expect(tiles(page)).toHaveCount(8)
    await expect(page.locator('.file-chip')).toHaveCount(2)
  })

  test('shows the drop area before anything is loaded', async ({ page }) => {
    await page.goto('/#pro')
    await expect(page.locator('#dropzone')).toBeVisible()
    await expect(page.locator('#app-workspace')).toBeHidden()
  })
})

test.describe('photos to PDF', () => {
  test('turns pictures into pages', async ({ page }) => {
    await page.goto('/#photos')
    await page.locator('#photo-input').setInputFiles([PHOTO_LANDSCAPE, PHOTO_PORTRAIT])
    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })
    await expect(page.locator('.tile img').first()).toBeVisible()
  })

  test('turns the page sideways for a landscape photo', async ({ page }) => {
    await page.goto('/#photos')
    await page.locator('#photo-input').setInputFiles([PHOTO_LANDSCAPE])
    await expect(page.locator('.tile')).toHaveCount(1, { timeout: 30_000 })
    // Wait for the real thumbnail: the loading placeholder is portrait, so
    // measuring too early tests the placeholder rather than the page.
    await expect(page.locator('.tile img').first()).toBeVisible({ timeout: 30_000 })

    // A wide picture should produce a wide page, not a tall one with the
    // photograph shrunk into the middle of it.
    const frame = await page.locator('.tile .frame').first().boundingBox()
    expect(frame.width).toBeGreaterThan(frame.height)
  })

  test('mixes photos and PDFs in one document', async ({ page }) => {
    await load(page)
    await page.locator('#photo-input').setInputFiles([PHOTO_PORTRAIT])
    await expect(page.locator('.tile')).toHaveCount(6, { timeout: 30_000 })
    await expect(page.locator('.file-chip')).toHaveCount(2)
  })

  test('saves a PDF made only of photos', async ({ page }) => {
    await page.goto('/#photos')
    await page.locator('#photo-input').setInputFiles([PHOTO_LANDSCAPE, PHOTO_PORTRAIT])
    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })

    const file = await savedFile(page, pressSave(page))
    expect(file.name).toMatch(/\.pdf$/)
  })
})

test.describe('watermarking a photo', () => {
  test('arrives with the watermark already on', async ({ page }) => {
    await page.goto('/#photo-watermark')
    await expect(page.locator('#watermark-enabled')).toBeChecked()
    await expect(page.locator('#watermark-text')).toHaveValue('FOR VERIFICATION ONLY')
    await expect(page.locator('#watermark-tiled')).toBeChecked()
    // An ID card is not A4.
    await expect(page.locator('#photo-page-size')).toHaveValue('match')
    await expect(page.locator('#dropzone-heading')).toHaveText('Drop a PDF or a photo')
  })

  test('stamps a photograph and previews it', async ({ page }) => {
    await page.goto('/#photo-watermark')
    await page.locator('#photo-input').setInputFiles([PHOTO_LANDSCAPE])
    await expect(page.locator('.tile')).toHaveCount(1, { timeout: 30_000 })
    // Nine copies, because the default is tiled.
    await expect(page.locator('.watermark-preview')).toHaveCount(9)
  })

  test('does not overwrite a watermark that is already set', async ({ page }) => {
    // The sidebar only exists once something is loaded, so a file comes first.
    await page.goto('/#photo-watermark')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('#watermark-text').fill('MY OWN TEXT')

    // Settings are remembered, so they survive a reload of the same tool and
    // the defaults must not overwrite them.
    await page.goto('/#photo-watermark')
    await expect(page.locator('#watermark-text')).toHaveValue('MY OWN TEXT')
  })
})

test.describe('password-protected files', () => {
  test('asks for the password and opens the file', async ({ page }) => {
    await page.goto('/#pro')
    await page.locator('#file-input').setInputFiles([LOCKED])

    await expect(page.locator('#password-dialog')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#password-note')).toContainText('needs a password')

    await page.locator('#password-input').fill('letmein')
    await page.locator('#password-ok').click()

    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })
  })

  test('asks again when the password is wrong', async ({ page }) => {
    await page.goto('/#pro')
    await page.locator('#file-input').setInputFiles([LOCKED])

    await expect(page.locator('#password-dialog')).toBeVisible({ timeout: 30_000 })
    await page.locator('#password-input').fill('nope')
    await page.locator('#password-ok').click()

    await expect(page.locator('#password-note')).toContainText('did not open', { timeout: 20_000 })
    await page.locator('#password-input').fill('letmein')
    await page.locator('#password-ok').click()
    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })
  })

  test('skips the file if no password is given', async ({ page }) => {
    await page.goto('/#pro')
    await page.locator('#file-input').setInputFiles([LOCKED])
    await expect(page.locator('#password-dialog')).toBeVisible({ timeout: 30_000 })
    await page.locator('#password-cancel').click()
    await expect(page.locator('#error-text')).toContainText('no password given')
    await expect(page.locator('#dropzone')).toBeVisible()
  })

  test('the password tool explains what saving will do', async ({ page }) => {
    await page.goto('/#password')
    await expect(page.locator('#dropzone-hint')).toContainText('asks for its password')

    await page.locator('#file-input').setInputFiles([LOCKED])
    await page.locator('#password-input').fill('letmein')
    await page.locator('#password-ok').click()
    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })

    // Its own panel is open, and it says the password will be removed.
    await expect(page.locator('#panel-password')).toHaveAttribute('open', '')
    await expect(page.locator('#password-state')).toContainText('REMOVE')

    await page.locator('#protect-enabled').check()
    await expect(page.locator('#password-state')).toContainText('replace it')
  })

  test('protects AND flattens without tripping over itself', async ({ page }) => {
    test.slow()   // renders every page to an image; CI runners are not quick
    // Encrypt-then-flatten failed: flattening re-opens the built file, which
    // it cannot do once locked. The order has to be flatten, then encrypt.
    await load(page)
    await page.locator('#panel-password > summary').click()
    await page.locator('#protect-enabled').check()
    await page.locator('#protect-password').fill('hunter2')
    await page.locator('#panel-saving .sub > summary').click()
    await page.locator('#flatten-enabled').check()

    const file = await savedFile(page, pressSave(page))
    expect(file.name).toMatch(/\.pdf$/)
    await expect(page.locator('#error-banner')).toBeHidden()
  })

  test('saves a protected file when asked', async ({ page }) => {
    await load(page)
    await page.locator('#panel-password > summary').click()
    await page.locator('#protect-enabled').check()
    await expect(page.locator('#protect-field')).toBeVisible()
    await page.locator('#protect-password').fill('hunter2')

    const file = await savedFile(page, pressSave(page))
    expect(file.name).toMatch(/\.pdf$/)
  })
})

test.describe('the file strip', () => {
  test('is the one place files live, and where you add more', async ({ page }) => {
    await load(page, [FIVE_PAGES])

    // Named, counted, removable, all in one row above the pages.
    const chip = page.locator('.file-chip').first()
    await expect(chip).toContainText('five-pages.pdf')
    await expect(chip).toContainText('5 pages')

    // Adding sits with the files rather than up in the header.
    await expect(page.locator('#file-strip .strip-button.add')).toHaveCount(2)
    await expect(page.locator('.top-actions .file-button').first()).toBeHidden()

    // Grouping only appears once there is more than one file to group.
    await expect(page.locator('#group-by-file')).toBeHidden()
    await page.locator('#file-input-strip').setInputFiles([THREE_PAGES])
    await expect(page.locator('.file-chip')).toHaveCount(2)
    await expect(page.locator('#group-by-file')).toBeVisible()

    // And the count is told once, not twice.
    await expect(page.locator('#status')).toHaveText('8 pages')
  })

  test('adding from the strip loads the file', async ({ page }) => {
    await load(page, [FIVE_PAGES])
    await expect(page.locator('.tile')).toHaveCount(5)
    await page.locator('#file-input-strip').setInputFiles([THREE_PAGES])
    await expect(page.locator('.tile')).toHaveCount(8)
  })

  test('lists every loaded file above the pages, with a remove button', async ({ page }) => {
    await load(page, [FIVE_PAGES, THREE_PAGES])
    const chips = page.locator('.file-chip')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toContainText('5 pages')

    await chips.first().locator('[data-action="remove"]').click()
    await expect(chips).toHaveCount(1)
    await expect(tiles(page)).toHaveCount(3)
  })

  test('clicking a chip selects that file\'s pages', async ({ page }) => {
    await load(page, [FIVE_PAGES, THREE_PAGES])
    await page.locator('.file-chip').nth(1).locator('.chip-name').click()
    await expect(page.locator('#selection-summary')).toHaveText('3 pages selected')
  })

  test('undoing a load leaves an honest empty state', async ({ page }) => {
    // The bug: the bar kept saying "774 pages · 1 file" over an empty screen.
    await load(page)
    await page.locator('#undo').click()
    await expect(page.locator('#status')).toHaveText('No PDFs loaded yet.')
    await expect(page.locator('#dropzone')).toBeVisible()
    await expect(page.locator('#dropzone-hint')).toContainText('Redo')
    await expect(page.locator('#redo')).toBeEnabled()
    await expect(page.locator('.file-chip')).toHaveCount(0)
  })
})

test.describe('settings do not leak between tools', () => {
  test('a watermark switched on in one tool is not applied in another', async ({ page }) => {
    // The report: open a PDF in the Label tool and find DRAFT already on it.
    await page.goto('/#photo-watermark')
    await expect(page.locator('#watermark-enabled')).toBeChecked()

    // Change tool WITHOUT reloading, as clicking through the app does.
    await page.evaluate(() => { location.hash = '#label' })
    await expect(page.locator('#tool-name')).toHaveText('Label pages')

    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.watermark-preview')).toHaveCount(0)
  })

  test('a setting switched on does not come back on after a reload', async ({ page }) => {
    await load(page)
    await page.locator('#panel-watermark > summary').click()
    await page.locator('#watermark-enabled').check()
    await expect(page.locator('.watermark-preview').first()).toBeVisible()

    await page.reload()
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#watermark-enabled')).not.toBeChecked()
    await expect(page.locator('.watermark-preview')).toHaveCount(0)
  })
})

test.describe('choosing pages', () => {
  test.beforeEach(async ({ page }) => load(page))

  test('selects by clicking', async ({ page }) => {
    await tiles(page).nth(1).click()
    await expect(tiles(page).nth(1)).toHaveClass(/selected/)
    await expect(page.locator('#selection-summary')).toHaveText('1 page selected')
  })

  test('selects odd, even and inverts', async ({ page }) => {
    await page.locator('#select-odd').click()
    await expect(page.locator('#range-input')).toHaveValue('1, 3, 5')
    await page.locator('#select-even').click()
    await expect(page.locator('#range-input')).toHaveValue('2, 4')
    await page.locator('#select-invert').click()
    await expect(page.locator('#range-input')).toHaveValue('1, 3, 5')
  })

  test('selects a typed range', async ({ page }) => {
    await page.locator('#range-input').fill('2-4')
    await page.locator('#range-select').click()
    await expect(page.locator('#selection-summary')).toHaveText('3 pages selected')
  })
})

test.describe('editing pages', () => {
  test.beforeEach(async ({ page }) => load(page))

  test('deletes the selected pages', async ({ page }) => {
    await page.locator('#select-odd').click()
    await page.locator('#delete').click()
    await expect(tiles(page)).toHaveCount(2)
  })

  test('rotates and can undo it', async ({ page }) => {
    await tiles(page).first().click()
    await page.locator('#rotate-right').click()
    await expect(tiles(page).first().locator('img')).toHaveAttribute('style', /rotate\(90deg\)/)
    await page.locator('#undo').click()
    await expect(tiles(page).first().locator('img')).toHaveAttribute('style', /rotate\(0deg\)/)
  })

  test('duplicates a page', async ({ page }) => {
    await tiles(page).first().click()
    await page.locator('#duplicate').click()
    await expect(tiles(page)).toHaveCount(6)
  })
})

test.describe('marking up', () => {
  test.beforeEach(async ({ page }) => load(page))

  test('previews page numbers on the thumbnails', async ({ page }) => {
    await page.locator('#panel-numbering > summary').click()
    await page.locator('#numbering-enabled').check()
    await expect(page.locator('.badge.numbering').first()).toBeVisible()
  })

  test('previews a watermark', async ({ page }) => {
    await page.locator('#panel-watermark > summary').click()
    await page.locator('#watermark-enabled').check()
    await expect(page.locator('.watermark-preview').first()).toBeVisible()
  })

  test('adds a bookmark and a sub-bookmark on the same page', async ({ page }) => {
    await tiles(page).first().click()
    await page.locator('#bookmark-title').fill('A. Pleadings')
    await page.locator('#bookmark-add').click()
    await page.locator('#bookmark-title').fill('A1. Particulars')
    await page.locator('#bookmark-add-sub').click()

    const rows = page.locator('.bookmark-row')
    await expect(rows).toHaveCount(3)   // the automatic one, plus these two
    await expect(rows.filter({ hasText: 'A1. Particulars' })).toHaveClass(/level-2/)
  })
})

test.describe('positioning a label by dragging', () => {
  test('drags the label and keeps where it was put', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()

    await page.locator('#panel-label > summary').click()
    await page.locator('#label-text').fill('EXHIBIT A')
    await page.locator('#panel-label .sub > summary').click()
    await page.locator('#label-exact').check()
    await page.locator('#label-place').click()

    await expect(page.locator('#place-stage img')).toBeVisible({ timeout: 30_000 })
    const stage = await page.locator('#place-stage').boundingBox()

    // Click a quarter across and three quarters down.
    await page.mouse.click(stage.x + stage.width * 0.25, stage.y + stage.height * 0.75)
    await expect(page.locator('#place-readout')).toContainText('%')

    await page.locator('#place-apply').click()
    await expect(page.locator('#place-dialog')).toBeHidden()

    // The dragged position comes back into the number fields.
    const across = Number(await page.locator('#label-x').inputValue())
    const down = Number(await page.locator('#label-y').inputValue())
    expect(across).toBeGreaterThan(10)
    expect(across).toBeLessThan(40)
    expect(down).toBeGreaterThan(60)
    expect(down).toBeLessThan(90)

    // And the label previews on the thumbnail.
    await expect(page.locator('.badge.label').first()).toBeVisible()
  })

  test('the placement view fits the screen', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#panel-label > summary').click()
    await page.locator('#label-text').fill('TEST')
    await page.locator('#panel-label .sub > summary').click()
    await page.locator('#label-exact').check()
    await page.locator('#label-place').click()

    await expect(page.locator('#place-stage img')).toBeVisible({ timeout: 30_000 })
    const stage = await page.locator('#place-stage').boundingBox()
    expect(stage.width).toBeLessThanOrEqual(page.viewportSize().width)
  })
})

test.describe('which panel opens', () => {
  test('a tool opens its own panel, not Saving', async ({ page }) => {
    await page.goto('/#numbering')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('#panel-numbering')).toHaveAttribute('open', '')
    await expect(page.locator('#panel-saving')).not.toHaveAttribute('open', '')
  })

  test('a split tool opens Saving, where its controls live', async ({ page }) => {
    await page.goto('/#split')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#panel-saving')).toHaveAttribute('open', '')
  })
})

test.describe('the page viewer', () => {
  // Uses the toolbar button rather than double-click. Double-click sits on top
  // of the click-to-select handler, so under load its two clicks can land as
  // two separate selections — genuinely racy, and not what this test is about.
  test('opens a page full size and pages through it', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#view').click()
    await expect(page.locator('#viewer-dialog')).toBeVisible()
    await expect(page.locator('#viewer-counter')).toHaveText('1 of 5', { timeout: 30_000 })
    await page.locator('#viewer-next').click()
    await expect(page.locator('#viewer-counter')).toHaveText('2 of 5')
  })

  // Not run on the phone project: mobile browsers reserve double-tap for
  // zooming, so it is unreliable there by design. That is a real limitation of
  // the shortcut rather than a test problem — the toolbar button is the
  // dependable route on touch, and it is covered above.
  test('double-clicking a page opens it too', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'iphone', 'double-tap is reserved for zoom on touch')
    await load(page)
    await tiles(page).first().dblclick()
    await expect(page.locator('#viewer-dialog')).toBeVisible({ timeout: 30_000 })
  })

  test('fits inside the window rather than running off the side', async ({ page }, testInfo) => {
    await load(page)
    await tiles(page).first().dblclick()
    await expect(page.locator('#viewer-frame img')).toBeVisible({ timeout: 30_000 })

    // The bug found on a phone: a fixed 720px page on a 390px screen.
    const frame = await page.locator('#viewer-frame').boundingBox()
    const viewport = page.viewportSize()
    expect(frame.width).toBeLessThanOrEqual(viewport.width)
  })
})

// --- the redaction view --------------------------------------------------------
//
// Redaction shows every page of the document in one scrolling column, with
// search at the top. These helpers open it and draw a box near the top of a
// page, scrolled so the box is on screen whatever the window size.

async function openRedaction(page, files = [FIVE_PAGES]) {
  await load(page, files)
  await page.locator('#redact').click()
  await expect(page.locator('#redact-dialog')).toBeVisible()
  await expect(page.locator('.redact-stage img').first()).toBeVisible({ timeout: 30_000 })
}

async function dragBox(page, index = 0, top = 0.1) {
  await page.locator('#redact-scroll').evaluate((scroller, i) => {
    const stage = scroller.querySelectorAll('.redact-stage')[i]
    scroller.scrollTop = stage.offsetTop - 10
  }, index)

  const img = page.locator('.redact-stage').nth(index).locator('img')
  await expect(img).toBeVisible({ timeout: 30_000 })
  const box = await img.boundingBox()

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * top)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * (top + 0.06), { steps: 10 })
  await page.mouse.up()
}

async function findInRedaction(page, needle, { matchCase = false } = {}) {
  await page.locator('#redact-search').fill(needle)
  if (matchCase) await page.locator('#redact-match-case').check()
  await page.locator('#redact-find').click()
}

test.describe('redaction', () => {
  test('shows every page of the document in one scrolling view', async ({ page }) => {
    await openRedaction(page)
    await expect(page.locator('.redact-page')).toHaveCount(5)
    await expect(page.locator('#redact-dialog')).toContainText('Page 5')

    const scrolls = await page.locator('#redact-scroll').evaluate((s) => s.scrollHeight > s.clientHeight)
    expect(scrolls).toBe(true)
  })

  test('draws boxes on several pages, then applies them in one go', async ({ page }) => {
    await openRedaction(page)

    await dragBox(page, 0)
    await expect(page.locator('#redact-count')).toContainText('1 box on 1 page')

    await dragBox(page, 2)
    await expect(page.locator('#redact-count')).toContainText('2 boxes on 2 pages')

    await page.locator('#redact-apply').click()
    await expect(page.locator('#redact-dialog')).toBeHidden()
    await expect(page.locator('.redact-mark')).toHaveCount(2)
  })

  test('removes a single box with its ×', async ({ page }) => {
    await openRedaction(page)
    await dragBox(page, 0)
    await expect(page.locator('.redact-box')).toHaveCount(1)

    await page.locator('.redact-remove').first().click()
    await expect(page.locator('.redact-box')).toHaveCount(0)
    await expect(page.locator('#redact-count')).toContainText('No boxes yet')
  })

  test('Undo last box takes back only the latest box', async ({ page }) => {
    await openRedaction(page)
    await dragBox(page, 0, 0.1)
    await dragBox(page, 0, 0.25)
    await expect(page.locator('.redact-box')).toHaveCount(2)

    await page.locator('#redact-undo').click()
    await expect(page.locator('.redact-box')).toHaveCount(1)
  })

  test('Cancel leaves the document exactly as it was', async ({ page }) => {
    await openRedaction(page)
    await dragBox(page, 0)

    await page.locator('#redact-cancel').click()
    await expect(page.locator('#redact-dialog')).toBeHidden()
    await expect(page.locator('.redact-mark')).toHaveCount(0)
  })

  test('Escape does not throw away boxes that are not applied yet', async ({ page }) => {
    await openRedaction(page)
    await dragBox(page, 0)

    await page.keyboard.press('Escape')
    await expect(page.locator('#redact-dialog')).toBeVisible()
    await expect(page.locator('#redact-count')).toContainText('not applied yet')
  })

  test('keeps white boxes white', async ({ page }) => {
    await openRedaction(page)
    await page.locator('input[name="redact-colour"][value="white"]').check()
    await dragBox(page, 0)
    await expect(page.locator('.redact-box.white')).toHaveCount(1)

    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark.white')).toHaveCount(1)
  })

  test('zooming redraws the pages larger, so text stays sharp', async ({ page }) => {
    await openRedaction(page)
    await expect(page.locator('#redact-zoom-level')).toHaveText('Fit')
    const fitWidth = await page.locator('.redact-stage img').first().evaluate((i) => i.naturalWidth)

    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('150%')
    await expect
      .poll(() => page.locator('.redact-stage img').first().evaluate((i) => i.naturalWidth), { timeout: 30_000 })
      .toBeGreaterThan(fitWidth)

    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('200%')
    const wider = await page.locator('#redact-scroll').evaluate((s) => s.scrollWidth > s.clientWidth)
    expect(wider).toBe(true)
  })

  test('on a touch screen, a finger scrolls until drawing is switched on', async ({ page }) => {
    await openRedaction(page)
    const toggle = page.locator('#redact-draw')
    const touch = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)

    // A mouse always draws, so the toggle only exists where fingers do.
    if (!touch) {
      await expect(toggle).toBeHidden()
      return
    }

    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#redact-scroll')).toHaveClass(/drawing/)
  })

  test('the Redact tool opens on the whole document without choosing a page', async ({ page }) => {
    await page.goto('/#redact')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('#tool-note')).toContainText('whole document')
    await expect(page.locator('#redact')).toHaveClass(/action-primary/)
    await expect(page.locator('#redact')).toBeEnabled()

    // Selecting pages does nothing for redaction, so those controls are gone.
    for (const id of ['#select-all', '#select-odd', '#select-even', '#select-invert', '#range-select']) {
      await expect(page.locator(id)).toBeHidden()
    }
  })

  test('leaves the full editor row untouched', async ({ page }) => {
    await load(page)
    await expect(page.locator('#select-all')).toBeVisible()
    await expect(page.locator('#select-odd')).toBeVisible()
    await expect(page.locator('#redact')).not.toHaveClass(/action-primary/)
    await expect(page.locator('#tool-note')).toBeHidden()
  })
})

test.describe('finding text to redact', () => {
  test('outlines a phrase on every page it appears on', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'Exhibit')

    await expect(page.locator('.redact-match')).toHaveCount(2)
    await expect(page.locator('#redact-search-status')).toContainText('2 matches on 2 pages')
    await expect(page.locator('#redact-apply-matches')).toHaveText(/Redact 2 matches/)
  })

  test('a match can be left out before redacting', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'Exhibit')
    await expect(page.locator('.redact-match')).toHaveCount(2)

    await page.locator('.redact-match').first().click()
    await expect(page.locator('.redact-match.excluded')).toHaveCount(1)
    await expect(page.locator('#redact-apply-matches')).toHaveText(/Redact 1 match/)

    await page.locator('#redact-apply-matches').click()
    await expect(page.locator('#redact-count')).toContainText('1 box on 1 page')
  })

  test('says so when nothing matches', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'Rumpelstiltskin')

    await expect(page.locator('#redact-search-status')).toContainText('No match')
    await expect(page.locator('.redact-match')).toHaveCount(0)
    await expect(page.locator('#redact-search-results')).toBeHidden()
  })

  test('respects Match case', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'exhibit')
    await expect(page.locator('.redact-match')).toHaveCount(2)

    await findInRedaction(page, 'exhibit', { matchCase: true })
    await expect(page.locator('#redact-search-status')).toContainText('No match')
  })

  test('one Undo takes back everything applied from the view', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'Exhibit')
    await page.locator('#redact-apply-matches').click()
    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark')).toHaveCount(2)

    await page.locator('#undo').click()
    await expect(page.locator('.redact-mark')).toHaveCount(0)
  })

  // The one that matters: the words must be gone from the SAVED file, not just
  // covered on screen.
  test('destroys the found text in the saved PDF', async ({ page }) => {
    await openRedaction(page)
    await findInRedaction(page, 'Exhibit')
    await page.locator('#redact-apply-matches').click()
    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark')).toHaveCount(2)

    const file = await savedFile(page, pressSave(page))
    const pages = await textOfEachPage(file.bytes)
    expect(pages).toHaveLength(5)
    expect(pages[1]).not.toContain('Exhibit')
    expect(pages[2]).not.toContain('Exhibit')
    expect(pages[0]).toContain('Page One')
    expect(pages[4]).toContain('Page Five')
  })
})

test.describe('deleting pages', () => {
  async function openReorder(page) {
    await page.goto('/#organise')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile')).toHaveCount(5, { timeout: 30_000 })
  }

  test('every page in Reorder has its own delete button', async ({ page }) => {
    await openReorder(page)
    await expect(page.locator('.tile-delete')).toHaveCount(5)

    await page.locator('.tile').nth(1).locator('.tile-delete').click()
    await expect(page.locator('.tile')).toHaveCount(4)

    // Deleting one page leaves the selection alone.
    await expect(page.locator('.tile.selected')).toHaveCount(0)
  })

  test('the toolbar Delete says how many pages it will remove', async ({ page }) => {
    await openReorder(page)
    await expect(page.locator('#delete')).toBeDisabled()

    await page.locator('.tile').nth(0).click()
    await expect(page.locator('#delete')).toHaveText('Delete page')

    await page.locator('.tile').nth(2).click()
    await expect(page.locator('#delete')).toHaveText('Delete 2 pages')

    await page.locator('#delete').click()
    await expect(page.locator('.tile')).toHaveCount(3)
  })

  test('one Undo brings a deleted page back', async ({ page }) => {
    await openReorder(page)
    await page.locator('.tile').nth(0).locator('.tile-delete').click()
    await expect(page.locator('.tile')).toHaveCount(4)

    await page.locator('#undo').click()
    await expect(page.locator('.tile')).toHaveCount(5)
  })

  test('tools that do not delete pages show no delete button on them', async ({ page }) => {
    await page.goto('/#numbering')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.tile-delete').first()).toBeHidden()
  })
})

test.describe('making a file smaller', () => {
  test('never hands back a file bigger than the one you started with', async ({ page }) => {
    // A short text document is already smaller than any picture of itself, so
    // flattening it would BLOAT it. The tool must notice and refuse.
    await page.goto('/#compress')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    const file = await savedFile(page, pressSave(page))
    expect(file.name).toMatch(/\.pdf$/)

    const original = await readFile(FIVE_PAGES).then((bytes) => bytes.length)
    expect(file.bytes.length).toBeLessThanOrEqual(original)

    // And it says why, rather than pretending it did something.
    await expect(page.locator('#compress-result')).toContainText('Not worth it')
  })

  test('offers three settings and keeps the document readable', async ({ page }) => {
    await page.goto('/#compress')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#compress-level option')).toHaveCount(3)

    await page.locator('#compress-level').selectOption('smallest')
    const file = await savedFile(page, pressSave(page))
    const pages = await textOfEachPage(file.bytes)
    expect(pages).toHaveLength(5)
  })
})

test.describe('PDF to images', () => {
  test('saves one file per page as a zip', async ({ page }) => {
    await page.goto('/#to-images')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.locator('#primary-action').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.zip$/)
    await expect(page.locator('#images-result')).toContainText('5 images')
  })

  test('offers PNG and JPEG', async ({ page }) => {
    await page.goto('/#to-images')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('#images-format').selectOption('jpeg')
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.locator('#primary-action').click()
    expect((await download).suggestedFilename()).toMatch(/\.zip$/)
  })
})

test.describe('saving', () => {
  test.beforeEach(async ({ page }) => load(page))

  test('saves a PDF', async ({ page }) => {
    const file = await savedFile(page, pressSave(page))
    expect(file.name).toMatch(/\.pdf$/)
  })

  test('saves only the selected pages', async ({ page }) => {
    // Under the load of the whole suite, typing into the box while thumbnails
    // are still arriving occasionally did not land. Confirm the selection
    // actually took before relying on it, typing again if it did not.
    await expect(async () => {
      await page.locator('#range-input').fill('2-3')
      await page.locator('#range-select').click()
      await expect(page.locator('#selection-summary')).toHaveText('2 pages selected', { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    const file = await savedFile(page, () => page.locator('#extract').click())
    expect(file.name).toContain('extract')
  })
})

test.describe('fitting the screen', () => {
  // The bug this guards: the top bar could not fit its buttons at phone width,
  // so it forced the document wider than the viewport and every line of text
  // on every screen was cut off on the right.
  const noSidewaysScroll = async (page) => {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  }

  test('the landing page does not scroll sideways', async ({ page }) => {
    await page.goto('/')
    await noSidewaysScroll(page)
  })

  test('neither do the tools and legal pages', async ({ page }) => {
    for (const hash of ['#tools', '#legal']) {
      await page.goto('/' + hash)
      await noSidewaysScroll(page)
    }
  })

  test('the drop screen does not scroll sideways', async ({ page }) => {
    await page.goto('/#pro')
    await noSidewaysScroll(page)
  })

  test('the workspace does not scroll sideways', async ({ page }) => {
    await load(page)
    await noSidewaysScroll(page)
  })

  test('the security explainer does not scroll sideways', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero-actions .linky').click()
    await expect(page.locator('#security-dialog')).toBeVisible()
    await noSidewaysScroll(page)
  })
})

test.describe('the landing page', () => {
  test('lists the popular tools and opens one', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tcard')).not.toHaveCount(0)
    await page.locator('.tcard', { hasText: 'Add a watermark' }).click()
    await expect(page).toHaveURL(/#photo-watermark/)
    await expect(page.locator('#tool-name')).toHaveText('Add a watermark')
  })

  test('leads with the workspace, and opens it', async ({ page }) => {
    await page.goto('/')
    const room = page.locator('.croom-card')
    await expect(room).toContainText('PDF Control Room')
    await expect(room).toContainText('Open Control Room')
    await room.click()
    await expect(page).toHaveURL(/#pro/)
    await expect(page.locator('#tool-name')).toHaveText('PDF Control Room')
    await expect(page.locator('#tool-subtitle')).toHaveText('Prepare your document in one place.')
  })

  test('every tool page is reachable from All tools, and search narrows them', async ({ page }) => {
    await page.goto('/#tools')
    const cards = page.locator('.tcard')
    const total = await cards.count()
    expect(total).toBeGreaterThan(10)

    await page.locator('#tool-search').fill('watermark')
    await expect(page.locator('.tcard:visible')).toHaveCount(1)

    await page.locator('#tool-search').fill('')
    await page.locator('.chip', { hasText: 'Organise' }).click()
    const organise = await page.locator('.tcard:visible').count()
    expect(organise).toBeGreaterThan(0)
    expect(organise).toBeLessThan(total)
  })

  test('a tool marked coming soon is not clickable', async ({ page }) => {
    await page.goto('/#tools')
    await expect(page.locator('.tcard.soon').first()).toBeDisabled()
    await expect(page.locator('.tcard', { hasText: 'PDF scan and OCR' })).toBeDisabled()
  })

  test('the legal page offers only tools that exist', async ({ page }) => {
    await page.goto('/#legal')
    await expect(page.locator('.hero-title')).toHaveText(/Prepare legal documents/)
    await expect(page.locator('.croom-block')).toContainText('Prepare the whole bundle')

    // Every card on the page must lead somewhere real.
    for (const card of await page.locator('.tcard').all()) {
      await expect(card).toBeEnabled()
    }
  })

  test('explains the privacy claim', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero-actions .linky').click()
    await expect(page.locator('#security-dialog')).toBeVisible()

    // The claim, the picture that carries it, and the honest limits.
    await expect(page.locator('#security-dialog')).toContainText('never leave this device')
    await expect(page.locator('.sec-diagram')).toBeVisible()
    await expect(page.locator('#security-dialog')).toContainText('No server. Nothing uploaded.')
    await expect(page.locator('.sec-col.cannot')).toContainText('Your files')
    await expect(page.locator('.sec-limits li')).toHaveCount(4)
  })

  test('the explainer stays short enough to actually be read', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero-actions .linky').click()
    await expect(page.locator('#security-dialog')).toBeVisible()

    const box = await page.locator('#security-dialog').evaluate((el) => ({
      content: el.scrollHeight,
      onScreen: el.clientHeight,
    }))

    // The old explainer ran to about three screens of prose. This guards the
    // rewrite: whether it needs a nudge of scrolling depends on the window,
    // but the whole thing must stay short. Roughly 745px on a wide window; a
    // phone is taller because the two columns stack into one.
    const narrow = page.viewportSize().width < 700
    expect(box.content).toBeLessThan(narrow ? 1150 : 950)

    // And it must never be taller than the window it opens in.
    expect(box.onScreen).toBeLessThanOrEqual(page.viewportSize().height)
  })
})
