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
    await expect(page.locator('.file-row')).toHaveCount(2)
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
    await expect(page.locator('.file-row')).toHaveCount(2)
  })

  test('saves a PDF made only of photos', async ({ page }) => {
    await page.goto('/#photos')
    await page.locator('#photo-input').setInputFiles([PHOTO_LANDSCAPE, PHOTO_PORTRAIT])
    await expect(page.locator('.tile')).toHaveCount(2, { timeout: 30_000 })

    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.locator('#primary-action').click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
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

    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.locator('#primary-action').click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
    await expect(page.locator('#error-banner')).toBeHidden()
  })

  test('saves a protected file when asked', async ({ page }) => {
    await load(page)
    await page.locator('#panel-password > summary').click()
    await page.locator('#protect-enabled').check()
    await expect(page.locator('#protect-field')).toBeVisible()
    await page.locator('#protect-password').fill('hunter2')

    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.locator('#primary-action').click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  })
})

test.describe('the file strip', () => {
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

test.describe('redaction', () => {
  test('opens, accepts a dragged box, and fits the screen', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })

    const stage = await page.locator('#redact-stage').boundingBox()
    expect(stage.width).toBeLessThanOrEqual(page.viewportSize().width)
    // The whole page must be on screen at once: a dialog that has to be
    // scrolled cannot be boxed in a single drag.
    expect(stage.y).toBeGreaterThanOrEqual(0)
    expect(stage.y + stage.height).toBeLessThanOrEqual(page.viewportSize().height)

    // Drag a box across the middle of the page.
    await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * 0.5, { steps: 10 })
    await page.mouse.up()

    await expect(page.locator('#redact-count')).toHaveText(/1 box/)
    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark').first()).toBeVisible()
  })

  test('gives the redact tool a prominent action and a one-page instruction', async ({ page }) => {
    await page.goto('/#redact')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('#tool-note')).toContainText('one page at a time')
    await expect(page.locator('#redact')).toHaveClass(/action-primary/)
    // The button that opens the editor comes before the rest of the row.
    await expect(page.locator('#redact')).toBeVisible()

    // Controls that select many pages would contradict the instruction.
    for (const id of ['#select-all', '#select-odd', '#select-even', '#select-invert', '#range-select']) {
      await expect(page.locator(id)).toBeHidden()
    }

    await page.locator('.tile').first().click()
    await expect(page.locator('#redact')).toBeEnabled()
  })

  test('leaves the full editor row untouched', async ({ page }) => {
    await load(page)
    await expect(page.locator('#select-all')).toBeVisible()
    await expect(page.locator('#select-odd')).toBeVisible()
    await expect(page.locator('#redact')).not.toHaveClass(/action-primary/)
    await expect(page.locator('#tool-note')).toBeHidden()
  })

  test('zooms in, keeps the page sharp, and draws accurately while zoomed', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#redact-zoom-level')).toHaveText('Fit')

    const fitWidth = await page.locator('#redact-stage img').evaluate((i) => i.naturalWidth)

    // One step at a time: each click starts a render, and the label only
    // changes once that render has replaced the image.
    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('150%')
    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('200%')

    // Re-rendered at twice the size rather than stretched, so text stays sharp.
    await expect
      .poll(() => page.locator('#redact-stage img').evaluate((i) => i.naturalWidth), { timeout: 30_000 })
      .toBe(fitWidth * 2)

    // The page is now bigger than its viewport, which is what makes it scroll.
    const room = await page.locator('#redact-viewport').evaluate((v) => v.scrollWidth - v.clientWidth)
    expect(room).toBeGreaterThan(0)

    // A box drawn while zoomed is stored in page coordinates, not screen ones.
    await page.locator('#redact-viewport').evaluate((v) => { v.scrollLeft = 0; v.scrollTop = 0 })
    const vp = await page.locator('#redact-viewport').boundingBox()
    await page.mouse.move(vp.x + 30, vp.y + 30)
    await page.mouse.down()
    await page.mouse.move(vp.x + 330, vp.y + 62, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator('#redact-count')).toHaveText(/1 box/)

    const width = await page.locator('.redact-box').evaluate((b) => parseFloat(b.style.width))
    expect(width).toBeGreaterThan(15)
    expect(width).toBeLessThan(30)

    // Going back to Fit keeps the box.
    await page.locator('#redact-zoom-fit').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('Fit')
    await expect(page.locator('.redact-box')).toHaveCount(1)
  })

  test('Move mode pans instead of drawing, on any device', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })

    // The toggle only exists once there is something to move.
    await expect(page.locator('#redact-pan')).toBeHidden()
    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('150%')
    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('200%')
    await expect(page.locator('#redact-pan')).toBeVisible()

    await page.locator('#redact-viewport').evaluate((v) => { v.scrollLeft = 0 })
    await page.locator('#redact-pan').click()

    // Proportional, because a phone's viewport is a few hundred pixels wide.
    const vp = await page.locator('#redact-viewport').boundingBox()
    const y = vp.y + vp.height * 0.4
    await page.mouse.move(vp.x + vp.width * 0.8, y)
    await page.mouse.down()
    await page.mouse.move(vp.x + vp.width * 0.2, y, { steps: 8 })
    await page.mouse.up()

    await expect
      .poll(() => page.locator('#redact-viewport').evaluate((v) => v.scrollLeft))
      .toBeGreaterThan(0)
    await expect(page.locator('.redact-box')).toHaveCount(0)

    // Returning to Fit takes the toggle away and puts drawing back.
    await page.locator('#redact-zoom-fit').click()
    await expect(page.locator('#redact-pan')).toBeHidden()
  })

  test('the right mouse button pans instead of drawing', async ({ page }, testInfo) => {
    // A phone has no right button; Move mode is its way in, covered above.
    test.skip(testInfo.project.name === 'iphone', 'no right mouse button on a phone')
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })

    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('150%')
    await page.locator('#redact-zoom-in').click()
    await expect(page.locator('#redact-zoom-level')).toHaveText('200%')
    await page.locator('#redact-viewport').evaluate((v) => { v.scrollLeft = 0 })

    const vp = await page.locator('#redact-viewport').boundingBox()
    const y = vp.y + vp.height * 0.4
    await page.mouse.move(vp.x + vp.width * 0.8, y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(vp.x + vp.width * 0.2, y, { steps: 8 })
    await page.mouse.up({ button: 'right' })

    await expect
      .poll(() => page.locator('#redact-viewport').evaluate((v) => v.scrollLeft))
      .toBeGreaterThan(0)
    await expect(page.locator('.redact-box')).toHaveCount(0)
  })

  test('draws a white box when white is chosen', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })

    await page.locator('input[name="redact-colour"][value="white"]').check()

    const stage = await page.locator('#redact-stage img').boundingBox()
    await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * 0.5, { steps: 10 })
    await page.mouse.up()

    await expect(page.locator('.redact-box.white')).toHaveCount(1)
    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark.white').first()).toBeVisible()
  })

  test('black stays the default and can be mixed with white on one page', async ({ page }) => {
    await load(page)
    await tiles(page).first().click()
    await page.locator('#redact').click()
    await expect(page.locator('#redact-stage img')).toBeVisible({ timeout: 30_000 })

    const stage = await page.locator('#redact-stage img').boundingBox()
    const drag = async (y0, y1) => {
      await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * y0)
      await page.mouse.down()
      await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * y1, { steps: 10 })
      await page.mouse.up()
    }

    await drag(0.2, 0.28)                                                   // black by default
    await page.locator('input[name="redact-colour"][value="white"]').check()
    await drag(0.5, 0.58)                                                   // white

    await expect(page.locator('.redact-box')).toHaveCount(2)
    await expect(page.locator('.redact-box.white')).toHaveCount(1)
  })
})

test.describe('finding text to redact', () => {
  const search = async (page, needle) => {
    await page.goto('/#redact')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('#search-text').fill(needle)
    await page.locator('#search-run').click()
  }

  test('finds a phrase on every page it appears on', async ({ page }) => {
    await search(page, 'Exhibit')

    await expect(page.locator('.search-hit')).toHaveCount(2)
    await expect(page.locator('#search-status')).toContainText('2 results on 2 pages')

    // Each result says which page it is on and shows the words around it.
    await expect(page.locator('.search-hit').first()).toContainText('Page 2')
    await expect(page.locator('.search-hit').first().locator('mark')).toHaveText('Exhibit')
  })

  test('says plainly how many pages will become images', async ({ page }) => {
    await search(page, 'Exhibit')
    await expect(page.locator('#search-warning')).toContainText('2 pages to an image')
    await expect(page.locator('#search-apply')).toHaveText(/Redact 2 results/)
  })

  test('redacts only the results left ticked', async ({ page }) => {
    await search(page, 'Exhibit')
    await expect(page.locator('.search-hit')).toHaveCount(2)

    // Untick the second: one box should be added, not two.
    await page.locator('.search-hit input').nth(1).uncheck()
    await expect(page.locator('#search-apply')).toHaveText(/Redact 1 result/)
    await page.locator('#search-apply').click()

    await expect(page.locator('.redact-mark')).toHaveCount(1)
  })

  test('one Undo takes the whole search back', async ({ page }) => {
    await search(page, 'Exhibit')
    await page.locator('#search-apply').click()
    await expect(page.locator('.redact-mark')).toHaveCount(2)

    await page.locator('#undo').click()
    await expect(page.locator('.redact-mark')).toHaveCount(0)
  })

  test('reports honestly when there is no match', async ({ page }) => {
    await search(page, 'Rumpelstiltskin')
    await expect(page.locator('#search-status')).toContainText('No match')
    await expect(page.locator('.search-hit')).toHaveCount(0)
  })

  test('respects Match case', async ({ page }) => {
    await page.goto('/#redact')
    await page.locator('#file-input').setInputFiles([FIVE_PAGES])
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('#search-text').fill('exhibit')
    await page.locator('#search-run').click()
    await expect(page.locator('.search-hit')).toHaveCount(2)

    await page.locator('#search-match-case').check()
    await page.locator('#search-run').click()
    await expect(page.locator('#search-status')).toContainText('No match')
  })

  test('drops results when the document changes underneath them', async ({ page }) => {
    await search(page, 'Exhibit')
    await expect(page.locator('.search-hit')).toHaveCount(2)

    await page.locator('.file-chip .chip-remove, .file-chip button').first().click()
    await expect(page.locator('.search-hit')).toHaveCount(0)
  })

  // The one that matters: the words must be gone from the SAVED file, not just
  // covered on screen.
  test('destroys the found text in the saved PDF', async ({ page }) => {
    await search(page, 'Exhibit')
    await page.locator('#search-apply').click()
    await expect(page.locator('.redact-mark')).toHaveCount(2)

    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.locator('#primary-action').click()
    const file = await download
    const bytes = await readFile(await file.path())

    const pages = await textOfEachPage(bytes)
    expect(pages).toHaveLength(5)

    // Pages 2 and 3 held "Exhibit"; they are images now, so they hold no text.
    expect(pages[1]).not.toContain('Exhibit')
    expect(pages[2]).not.toContain('Exhibit')

    // Pages that were not touched keep their text and stay searchable.
    expect(pages[0]).toContain('Page One')
    expect(pages[4]).toContain('Page Five')
  })
})

test.describe('saving', () => {
  test.beforeEach(async ({ page }) => load(page))

  test('saves a PDF', async ({ page }) => {
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.locator('#primary-action').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.pdf$/)
  })

  test('saves only the selected pages', async ({ page }) => {
    await page.locator('#range-input').fill('2-3')
    await page.locator('#range-select').click()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.locator('#extract').click()
    const file = await download
    expect(file.suggestedFilename()).toContain('extract')
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
    await page.locator('#security-open').click()
    await expect(page.locator('#security-dialog')).toBeVisible()
    await noSidewaysScroll(page)
  })
})

test.describe('the landing page', () => {
  test('lists the tools and opens one', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tool-card')).not.toHaveCount(0)
    await page.locator('.tool-card', { hasText: 'Add a watermark' }).click()
    await expect(page).toHaveURL(/#photo-watermark/)
    await expect(page.locator('#tool-name')).toHaveText('Add a watermark')
  })

  test('a tool marked coming soon is not clickable', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tool-card.soon').first()).toBeDisabled()
    // Scan and OCR is listed as coming soon, and last.
    const ocr = page.locator('.tool-card', { hasText: 'PDF scan and OCR' })
    await expect(ocr).toBeDisabled()
    await expect(page.locator('.tool-card').last()).toHaveText(/PDF scan and OCR/)
  })

  test('explains the privacy claim', async ({ page }) => {
    await page.goto('/')
    await page.locator('#security-open').click()
    await expect(page.locator('#security-dialog')).toBeVisible()
    await expect(page.locator('#security-dialog')).toContainText('What we know about you')
  })
})
