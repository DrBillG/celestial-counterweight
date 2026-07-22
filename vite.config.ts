import { defineConfig } from 'vite'

// base: './' emits relative asset URLs so the built site works from any host
// path — domain root (Cloudflare Pages / Netlify) OR a subdirectory
// (GitHub Pages project sites, /games/… mounts). Texture loads are already
// relative (orrery.ts uses `textures/…`), so the whole bundle is subpath-safe.
export default defineConfig({
  base: './',
})
