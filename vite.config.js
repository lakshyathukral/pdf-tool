import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'

// GitHub Pages serves a project site from a subfolder:
//   https://<username>.github.io/<repo-name>/
// but this app assumes it lives at the root, so every asset path would 404.
//
// GitHub Actions sets GITHUB_REPOSITORY to "username/repo-name" during a build,
// so the correct prefix can be worked out automatically. That means the repo
// can be renamed without touching this file, and local builds — where the
// variable does not exist — still use the plain root.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]

// A custom domain serves the site from the ROOT, not from /<repo-name>/, so
// the prefix has to go — otherwise every asset 404s and the page comes up
// blank while the DNS looks perfectly fine. public/CNAME is the signal:
// GitHub Pages reads that file for the domain, and Vite copies it into the
// build, so its presence is exactly the condition we want to key off.
const hasCustomDomain = existsSync('public/CNAME')

export default defineConfig({
  base: hasCustomDomain || !repoName ? '/' : `/${repoName}/`,

  // pdf.js starts its worker as a module, so ours has to be one too.
  worker: { format: 'es' },
})
