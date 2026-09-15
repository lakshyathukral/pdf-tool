// Copy what text recognition needs into public/ocr, so the site serves it itself.
//
// tesseract.js fetches its worker, its engine and its language data from a
// third-party CDN unless told otherwise. That would contradict "your files
// never leave your device" — the files would not, but the tool would be
// phoning a stranger's server — so everything is served from this site.
// These are generated from node_modules on every build and not committed.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url).pathname
const out = join(root, 'public', 'ocr')

const from = (pkg, file) => join(dirname(require.resolve(`${pkg}/package.json`)), file)
// The engine must be the exact version tesseract.js was built for, so it is
// found from tesseract.js's own location rather than wherever npm put a copy.
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'))
const coreDir = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tesseractDir] }))
const core = (file) => join(coreDir, file)

const copies = [
  [from('tesseract.js', 'dist/worker.min.js'), 'worker.min.js'],
  // LSTM-only engines for three levels of browser support; each browser
  // downloads only the one it can run.
  [core('tesseract-core-relaxedsimd-lstm.wasm.js'), 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [core('tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
  [core('tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
  // The compact integer model: what the accuracy tests used, at a quarter of the size.
  [from('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
]

for (const [source, target] of copies) {
  const dest = join(out, target)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(source, dest)
}
console.log(`OCR files copied to public/ocr (${copies.length} files)`)
