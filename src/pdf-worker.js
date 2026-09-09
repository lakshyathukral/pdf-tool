// The pdf.js worker, with the polyfills loaded first.
//
// pdf.js starts its worker from a file we hand it, so the only way to get a
// polyfill into that thread is to point it at our own wrapper instead of the
// library's worker directly. Import order matters: the polyfills must be in
// place before the worker's own code runs.
import './polyfills.js'
import 'pdfjs-dist/build/pdf.worker.mjs'
