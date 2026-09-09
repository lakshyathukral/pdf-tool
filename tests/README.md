# Tests

```bash
npm test              # unit tests — under a second
npm run test:browser  # real browsers — about a minute
npm run test:all      # both
npm run test:watch    # unit tests, re-running as you edit
```

Both run automatically on every push. **Nothing is published unless they pass.**

## Three layers, and what each is for

**`tests/ranges.test.js`, `tests/model.test.js`** — the pure logic. Page ranges,
selection, reordering, undo, bookmark nesting, split points. Fast enough to run
on every save.

**`tests/export.test.js`** — the exporter, checked by *reading the produced PDF
back*. Not "did it throw" but "does the file contain the right pages, in the
right order, rotated correctly, with the page number in the reader's
bottom-right and the watermark actually centred". `tests/helpers/read-pdf.js`
does the reading.

**`tests/browser/`** — the real application in a real browser, across Chromium,
WebKit, Firefox and an iPhone viewport.

## Why WebKit is not optional

WebKit is what Safari runs — every iPhone, iPad and Mac. pdf.js 6 uses a
JavaScript method Safari does not have, and shipped no fallback, so for a day
every PDF failed to open on iOS with an error naming a method nobody recognised.
A single WebKit run would have caught it before anyone saw it.

The iPhone project exists for the same reason: the redaction dialog was sized in
fixed pixels and ran off the side of a phone screen. Invisible at desktop width,
obvious at 390px.

## Tests that record a real limitation

Some assertions exist to pin down behaviour that is easy to "fix" wrongly:

- **Dragging backwards drops before the target, forwards drops after.** Standard
  for list reordering, and deliberate.
- **A page can carry several bookmarks.** A section heading and the first
  document under it usually start on the same page.
- **An orphan sub-bookmark is shown at the level it will really have.** The panel
  must not display nesting the saved file will not contain.
- **Double-tap is skipped on the phone project.** Mobile browsers reserve it for
  zoom, so it is unreliable there by design — the toolbar button is the
  dependable route, and that is what is tested.

## Reading a failure

```bash
npx playwright test --project=webkit -g "renders every page"   # one test, one engine
npx playwright show-report                                     # the last run, with traces
npx playwright test --headed                                   # watch it happen
```

A failed browser test keeps a trace: every DOM state, network request and
console message, steppable frame by frame.

## Fixtures

`tests/fixtures/*.pdf` are small text PDFs with labelled pages, so a test can
assert *which* page ended up where by reading its text back.
