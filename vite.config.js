import { defineConfig } from 'vite'

// Relative asset paths, so one build works wherever it is served from: at the
// root of a custom domain, or in a subfolder like /pdf-tool/ on github.io.
//
// Pinning it to one or the other means the other silently breaks — the page
// loads, the stylesheet 404s, and you get raw unstyled HTML that looks like a
// corrupt deployment rather than a path problem.
//
// Safe here because navigation uses the URL hash (#watermark) rather than
// paths, so nothing depends on the site knowing its own depth.
export default defineConfig({
  base: './',

  // pdf.js starts its worker as a module, so ours has to be one too.
  worker: { format: 'es' },
})
