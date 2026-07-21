# Celestial Counterweight

Mine the solar system to build a Dyson sphere — without throwing the planets out
of balance. You strip mass from moons and planets to feed your fabricator, but
every gram you remove nudges orbits off their nominal paths. Gravity is the
constant; **mass is the variable**. Pull too much, too fast, from the wrong body
and its moon falls into a runaway cascade you can't undo. Play it patient and
you complete the sphere in one sitting; play it greedy and the system is lost.

## Develop

```bash
npm install
npm run dev       # local dev server (Vite) at http://localhost:5173
npm run test      # physics + scenario suite (Vitest)
```

## Deploy

```bash
npm run build     # type-checks, then outputs a static bundle to dist/
```

`dist/` is a fully static site — deploy it to any static host:

- **Cloudflare Pages** — connect the GitHub repo (build command `npm run build`,
  build output directory `dist`), or create a project → *Direct Upload* → drag
  the `dist/` folder in.
- **Netlify** — connect the repo (build command `npm run build`, publish
  directory `dist`), or drag-and-drop the `dist/` folder onto the Netlify
  dashboard.

No server, database, or environment variables required.

## Controls

- **Click a body** in the orrery to select it as your target (its risk and
  stats appear in the inspector).
- **PLOT COURSE** to launch the ship toward the selected body.
- On arrival, **choose an extraction**: *strip* (fast, brutal), *lattice*
  (slow, gentle), or *slag* (restorative — rebalances as it mines).
- Deliver cargo to the **fab**, then **place counterweights** — *suggested*
  (stable, radially-outward) or *hasty* (fast, riskier).
- **Watch the harmony** readout: green is stable, red is destabilizing. Keep the
  system in balance while the sphere mass climbs to 100%.

Win by completing the sphere. Lose if any body cascades into catastrophe.

## Credits

Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures)
— CC BY 4.0.
