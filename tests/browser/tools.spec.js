import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const FIVE_PAGES = fileURLToPath(new URL('../fixtures/five-pages.pdf', import.meta.url))
const THREE_PAGES = fileURLToPath(new URL('../fixtures/three-pages.pdf', import.meta.url))

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

    // Drag a box across the middle of the page.
    await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * 0.5, { steps: 10 })
    await page.mouse.up()

    await expect(page.locator('#redact-count')).toHaveText(/1 box/)
    await page.locator('#redact-apply').click()
    await expect(page.locator('.redact-mark').first()).toBeVisible()
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

test.describe('the landing page', () => {
  test('lists the tools and opens one', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tool-card')).not.toHaveCount(0)
    await page.locator('.tool-card', { hasText: 'Add a watermark' }).click()
    await expect(page).toHaveURL(/#watermark/)
    await expect(page.locator('#tool-name')).toHaveText('Add a watermark')
  })

  test('a tool marked coming soon is not clickable', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tool-card.soon').first()).toBeDisabled()
  })

  test('explains the privacy claim', async ({ page }) => {
    await page.goto('/')
    await page.locator('#security-open').click()
    await expect(page.locator('#security-dialog')).toBeVisible()
    await expect(page.locator('#security-dialog')).toContainText('What we know about you')
  })
})
