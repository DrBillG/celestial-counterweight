import { defineConfig } from 'vite'

// base: './' emits relative asset URLs so the built site works from any host
// path — domain root (Cloudflare Pages / Netlify) OR a subdirectory
// (GitHub Pages project sites, /games/… mounts). Texture loads are already
// relative (orrery.ts uses `textures/…`), so the whole bundle is subpath-safe.
//
// server.port honors the PORT env var (the harness assigns a free port when
// launch.json uses autoPort), falling back to 5173 for a plain `npm run dev`.
// strictPort:false lets Vite pick the next free port if the chosen one is busy.
export default defineConfig({
  base: './',
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
})
