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

export default defineConfig({
  base: repoName ? `/${repoName}/` : '/',
})
