# Celestial Counterweight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-sitting desktop browser game where the player mines the solar system to build a Dyson sphere while keeping planetary orbits from cascading into catastrophe.

**Architecture:** A static single-page app with a headless, fully-tested physics core (`sim/`), a run state machine (`game/`), a Three.js renderer (`render/`), DOM HUD overlays (`ui/`), and synthesized audio/haptics (`audio/`). Data flows one way: sim ticks → game reads state and emits events → render/ui/audio react.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest. No backend. Deployed as a static site.

**Spec:** `docs/superpowers/specs/2026-07-21-celestial-counterweight-design.md`

**One deliberate spec refinement (read before Task 8):** Passive gravity from a parked fab cannot reliably *restore* a perturbed orbit — real orbital mechanics doesn't heal. The counterweight lever is therefore implemented as **gravitational-tether station-keeping**: a fab near a wobbling body applies a restoring acceleration toward the body's nominal orbit, with magnitude `ASSIST_K * fabMass / d²` — the same inverse-square mass coupling as gravity, so the *cause* (big mass placed close) stays physical and intuitive. This is the one gameplay-designed force in the sim, and it is documented and tested explicitly.

**Physics units (used everywhere):** Game-scaled units, not SI. `G = 1`, sun mass `1000`, planet orbit radii 38–344 units, one time-unit (tu) ≈ 1 real second at Temporal Compressorator rate ×1. Circular orbit speed uses the softened-potential helper `circularSpeed()`; the system data is *constructed* to start in circular equilibrium, which is what makes the null test (Task 4) meaningful.

---

## ⚠ AMENDMENTS LOG (binding — supersedes task text below where they conflict)

Recorded after Task 4 shipped (commits 412fc50, feb76c0, 5e7968a). Every later task must honor these:

1. **Hierarchical sim (Tasks 4–10).** The sim is two-layer (heliocentric layer + per-parent moon frames via `stepHierarchical`); `step()` remains only for the heliocentric sub-array and old tests. Task 7's `Sim.tick` must call `stepHierarchical`, never `step`. Moons are gravitationally invisible to ship/fabs — cross-layer influence happens ONLY via the `extra` accel hook.
2. **ExtraAccel contract (Tasks 7–8).** Extra accelerations must not read any body's `vel` OR `mass` (helio masses are temporarily boosted during layer 1; staleness windows documented in integrator.ts). Position/game-state only.
3. **Roster (Task 4 final).** Planets: mercury 38/0.03, venus 52/0.4, earth 75/0.5, mars 104/0.11 (minable), jupiter 175/1.5, saturn 255/1.0, uranus 292/0.45, neptune 344/0.5. Moons: moon 6/0.012, phobos 4/0.004, io 8/0.0005, europa 12/0.0005, ganymede 20.5/0.0005, titan 13/0.023 (all minable). The Jupiter trio is near-massless (resonance constraints) — treat as trophy targets in Task 10 economy tuning; total minable pool ≈ 0.148.
4. **Stability scoring is envelope-based (Task 6).** The plan's raw `score = 100 − DEV_GAIN·dev` formula is DEAD — ambient forced oscillations reach ~2% (> amber). Instead: at Sim construction, run the pristine deterministic null sim once (~0.3 s) and record each body's scalar max deviation envelope B(body); score = 100 − DEV_GAIN·max(0, dev − B(body) − MARGIN) with an absolute MARGIN (~1%) so untouched bodies never false-amber when masses shift elsewhere. Envelope is computed, never hard-coded. Monotonicity/threshold tests adapt accordingly.
5. **Null-test bar.** `tests/system.test.ts` asserts per-body RUNNING-MAX deviation < 0.02 over RUN_DURATION, plus a bitwise determinism pin. Any roster/DT/RUN_DURATION change must re-run the extended (2×) probe — neptune crosses 2% at t≈1839; guard comments sit beside RUN_DURATION.
6. **Catastrophe detection (Task 7).** Moon ejection must be detected RELATIVE to parent (e.g. rel distance > 3× rNom), not via heliocentric EJECT_RADIUS (which stays for planets/heliocentric bodies). ALSO: prograde ejecta means mined moons recoil retrograde → orbits CONTRACT, so the moon catastrophe mode is parent close-approach/collision (detect rel distance < parent.radius + moon.radius; softening otherwise lets a moon pass through its parent uneventfully) as well as ejection in the exhausted-husk regime.
7. **Stability module contract (Task 6 final).** `StabilityTracker(bodies, envelope)`; `scoreOf(body, bodies, envelope)`; `harmony(bodies, envelope)` — the plan's Task 7 snippet arities are STALE. Task 7 adds fabs via `tracker.track(body)`, never by re-constructing the tracker (loses alarm state). Held-score recovery is `HELD_RECOVERY_PER_TU` (constants.ts). Envelope guarantee (exact-100, zero events) holds only within RUN_DURATION; probed pristine to 1.5×: neptune raw dips to ~92.5 from t≈1896, still zero band events — any overtime mode must re-probe. Consumers key BandEvents on `to` (from→to is a span).
8. **Healing story (binding for Tasks 8/9/14).** `returnSlag` will be amended in Task 8 to accrete at the body's NOMINAL circular velocity (inelastic accretion, momentum-weighted: v ← (m·v + dm·v_nom)/(m+dm)) — this genuinely re-circularizes orbits, making the HUD's "heal orbit" promise physically true. Until then slag is prevention-only. Task 8 must also add a no-false-alarm test: a massive assist fab parked near a moon must not push SIBLING moons past envelope+margin via its real gravity (fab accels can reach ~30% of a small moon's central accel).
9. **Mining API (Task 5 final, supersedes plan snippets in Tasks 6/7/10).** `extract(body, method, dm, refVel)` — refVel is REQUIRED (the orbital parent's velocity; explicit {x:0,y:0}/sun.vel for heliocentric bodies). Ejecta is thrown prograde RELATIVE to refVel. `ExtractResult.ejectaMomentum` is in the body's pre-kick frame. dm is clamped to [0, mass/2]. Every plan snippet calling `extract(x, 'strip', dose)` with 3 args is STALE — add the parent velocity. Tuning note for Task 10: one strip tick ≈ 5–9% of a moon's orbital speed — EJECTA_SPEED·ASYM likely needs ~10× reduction for mining to be gradual pressure rather than instant catastrophe; a director-side extraction floor (refuse when mass < k·m0) should also be considered so exhausted husks don't become unbounded-Δv noisemakers.
10. **Measured dose-response landscape (Task 7 probes — binding inputs for Tasks 8/9/10 tuning).** Titan single strip dose: fatal threshold ≈ 0.4% of m0 (0.0001 abs); below ~0.25% m0 = permanent flapping-klaxon zone (alarm, no cascade, no healing until Task 8); safe/fatal span is only ~2×. RATE.strip=0.010/tu ≈ 43% of titan m0 per tu — needs ~100× reduction (not the 10× amendment 9 guessed) for gradual pressure. Pre-retune runaway was 4.7× central gravity at critical (death sentence, assist could never win) — retuned in Task 7 fixes to ×10 multiplier (≈0.5× gravity at threshold) with ASSIST_K=0.1 so early-critical rescue is possible; Task 8 proves efficacy and may fine-tune. Fab losses are `fabLost` events (setbacks), never game-ending catastrophes; moon↔fab overlap is phantom (different layers) and excluded. Fabs on naive sun-circular orbits near a planet are NOT stable parking — capture/drag is real; Task 9 placement must account for it or accept fab attrition. (Superseded in part by amendment 11: at REAL fab masses the capture problem is negligible.)
11. **Rebalance mechanics final design (Task 8 follow-up — binding).** (a) FAB MASSES COME FROM CARGO: the entire minable pool is ≈0.148, so real fabs weigh ≤~0.05 — every earlier probe with mass-5 fabs was unphysical; fab-vs-planet capture chaos evaporates at real masses. ASSIST_K is retuned for real fab masses (~3.0, TUNE). (b) The assist force is a PD CONTROLLER: proportional restoring toward rNom plus a damping term derived from finite-difference deviation rates snapshotted per tick outside the integrator callback (contract-compliant; no vel reads) — eliminates the arrest-vs-overshoot knife edge. (c) SHIP ASSIST: `sim.setShipAssist(bodyName|null)` applies the same PD force with strength SHIP_ASSIST while the ship is stationed (Task 9: active during Return Slag); slag mass restoration stays vis-viva accretion (optimal but weak per unit mass — the PD force does the orbital healing, the mass does the budget/coupling healing). (d) Rescue and healing proofs must assert robustness across a small parameter GRID, not single points. (e) Task 10: SPHERE_MASS_REQUIRED must be set vs the 0.148 pool (~0.08-0.12), and fab placement near planets is safe at real masses.

---

## File Structure

```
celestial-counterweight/
├── index.html                  # entry, #app + #hud containers
├── package.json                # scripts: dev, build, test
├── vite.config.ts
├── src/
│   ├── main.ts                 # bootstraps sim+game+render+ui+audio, main loop
│   ├── constants.ts            # every tunable number in one place
│   ├── sim/
│   │   ├── vec.ts              # 2D vector math (sim is planar; render adds 3D tilt)
│   │   ├── body.ts             # Body interface + factory
│   │   ├── data.ts             # solar-system roster, buildSystem()
│   │   ├── integrator.ts       # leapfrog step + gravity/assist/runaway accelerations
│   │   ├── mining.ts           # extract(), returnSlag(), impulse math
│   │   ├── stability.ts        # deviation, score, bands, StabilityTracker events, harmony
│   │   └── sim.ts              # Sim facade: tick(), addFab(), collision/ejection detection
│   ├── game/
│   │   └── director.ts         # run state machine, decision windows, win/lose, sim rate
│   ├── render/
│   │   ├── renderer.ts         # WebGL renderer + bloom composer + resize
│   │   ├── sky.ts              # 3-layer parallax starfield, nebulae, galaxy, twinkle
│   │   ├── orrery.ts           # body meshes, orbit trails, harmony ring, picking
│   │   ├── bridge.ts           # close-up body scene
│   │   └── cameraDirector.ts   # orrery⇄bridge dive transitions
│   ├── ui/
│   │   └── hud.ts              # top bar, inspector, choice cards, alert stack
│   └── audio/
│       └── audio.ts            # synthesized chime/klaxon, gamepad haptics
├── public/textures/            # planet textures (downloaded in Task 12)
└── tests/
    ├── vec.test.ts
    ├── integrator.test.ts
    ├── system.test.ts
    ├── mining.test.ts
    ├── stability.test.ts
    ├── sim.test.ts
    ├── rebalance.test.ts
    ├── director.test.ts
    └── scenario.test.ts        # greedy-loses / efficient-wins bots
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `index.html`, `src/main.ts` (stub), `.gitignore`

- [ ] **Step 1: Scaffold Vite project**

Run in the repo root (`/Users/williamgiovannetti/Projects/celestial-counterweight`):

```bash
npm create vite@latest . -- --template vanilla-ts
npm install three
npm install -D vitest @types/three
```

If `npm create vite` complains the directory is non-empty (it contains `docs/` and `.git/`), choose "Ignore files and continue".

- [ ] **Step 2: Clean template and configure**

Delete template cruft: `rm -f src/counter.ts src/typescript.svg src/style.css public/vite.svg`.

Replace `index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Celestial Counterweight</title>
    <style>
      html, body { margin: 0; height: 100%; background: #01020a; overflow: hidden; }
      #app canvas { display: block; }
      #hud { position: fixed; inset: 0; pointer-events: none; font-family: ui-monospace, monospace; }
      #hud .clickable { pointer-events: auto; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="hud"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Replace `src/main.ts` with a stub:

```ts
console.log('Celestial Counterweight — scaffold OK')
```

Add `"test": "vitest run"` to `package.json` scripts.

- [ ] **Step 3: Verify dev server and tests run**

Run: `npm run test` — Expected: "No test files found" exit 0 (or add `--passWithNoTests`: make the script `"test": "vitest run --passWithNoTests"`).
Run: `npm run build` — Expected: builds `dist/` without error.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + TypeScript + Three.js + Vitest"
```

---

### Task 2: Vector Math

**Files:**
- Create: `src/sim/vec.ts`
- Test: `tests/vec.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/vec.test.ts
import { describe, it, expect } from 'vitest'
import { v, add, sub, scale, len, norm, dist } from '../src/sim/vec'

describe('vec', () => {
  it('adds and subtracts', () => {
    expect(add(v(1, 2), v(3, 4))).toEqual({ x: 4, y: 6 })
    expect(sub(v(3, 4), v(1, 2))).toEqual({ x: 2, y: 2 })
  })
  it('scales and measures', () => {
    expect(scale(v(1, 2), 3)).toEqual({ x: 3, y: 6 })
    expect(len(v(3, 4))).toBe(5)
    expect(dist(v(0, 0), v(0, 7))).toBe(7)
  })
  it('normalizes safely', () => {
    expect(norm(v(0, 5))).toEqual({ x: 0, y: 1 })
    expect(norm(v(0, 0))).toEqual({ x: 0, y: 0 }) // no NaN on zero vector
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vec.test.ts`
Expected: FAIL — cannot resolve `../src/sim/vec`

- [ ] **Step 3: Implement**

```ts
// src/sim/vec.ts
export interface Vec { x: number; y: number }

export const v = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
export const len = (a: Vec): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a: Vec): Vec => {
  const l = len(a)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vec.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sim/vec.ts tests/vec.test.ts
git commit -m "feat(sim): 2D vector math"
```

---

### Task 3: Bodies, Gravity, Leapfrog Integrator

**Files:**
- Create: `src/constants.ts`, `src/sim/body.ts`, `src/sim/integrator.ts`
- Test: `tests/integrator.test.ts`

- [ ] **Step 1: Write the failing test** — a two-body circular orbit must stay circular for 100 orbits (the leapfrog/symplectic property this game depends on).

```ts
// tests/integrator.test.ts
import { describe, it, expect } from 'vitest'
import { v, dist } from '../src/sim/vec'
import { makeBody } from '../src/sim/body'
import { step } from '../src/sim/integrator'
import { G, DT } from '../src/constants'

describe('integrator', () => {
  it('holds a circular two-body orbit for 100 orbits within 0.5%', () => {
    const M = 1000
    const r = 80
    const vCirc = Math.sqrt((G * M) / r)
    const sun = makeBody({ name: 'sun', kind: 'star', mass: M, pos: v(0, 0), vel: v(0, 0), radius: 8, parentName: null, rNom: 0 })
    const planet = makeBody({ name: 'p', kind: 'planet', mass: 0.001, pos: v(r, 0), vel: v(0, vCirc), radius: 1, parentName: 'sun', rNom: r })
    const bodies = [sun, planet]
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * M))
    const steps = Math.ceil((100 * period) / DT)
    let minR = Infinity, maxR = 0
    for (let i = 0; i < steps; i++) {
      step(bodies, DT)
      const d = dist(planet.pos, sun.pos)
      minR = Math.min(minR, d); maxR = Math.max(maxR, d)
    }
    expect(minR).toBeGreaterThan(r * 0.995)
    expect(maxR).toBeLessThan(r * 1.005)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integrator.test.ts` — Expected: FAIL (modules missing)

- [ ] **Step 3: Implement constants, body, integrator**

```ts
// src/constants.ts
// Every tunable number lives here. Values marked TUNE are expected to be
// adjusted until the scenario suite (Task 10) says the game is winnable,
// losable, and honest.
export const G = 1
export const SUN_MASS = 1000
export const DT = 0.02                  // sim timestep (tu)
export const SOFTENING = 0.5           // gravity softening to avoid singularities
export const RUN_DURATION = 1800       // tu of sim time in one run (~30 min at rate 1)

// Stability (Task 6/7)
export const DEV_GAIN = 1200           // TUNE: deviation → score steepness
export const BAND_AMBER = 85
export const BAND_RED = 60
export const BAND_CRITICAL = 30
export const RUNAWAY_ACCEL = 0.004     // TUNE: designed instability past critical
export const EJECT_RADIUS = 600        // beyond this from sun = ejected (lose event)

// Mining (Task 5)
export const EJECTA_SPEED = 2.0
export const ASYM = { strip: 0.8, lattice: 0.05 } as const
export const RATE = { strip: 0.010, lattice: 0.003 } as const  // mass units per tu

// Rebalance (Task 8)
export const ASSIST_K = 0.02           // TUNE: station-keeping strength per fab mass
export const ASSIST_RANGE = 40

// Dyson sphere (Task 11)
export const SPHERE_MASS_REQUIRED = 12 // TUNE: total delivered mass to win
```

```ts
// src/sim/body.ts
import type { Vec } from './vec'

export type Kind = 'star' | 'planet' | 'moon' | 'ship' | 'fab'

export interface Body {
  name: string
  kind: Kind
  mass: number
  m0: number                 // mass at run start (stability weighting, budgets)
  pos: Vec
  vel: Vec
  radius: number             // collision + visual scale
  parentName: string | null  // orbital parent ('sun' for planets, planet for moons)
  rNom: number               // nominal orbit radius around parent at run start
  minable?: boolean
}

export function makeBody(b: Omit<Body, 'm0'>): Body {
  return { ...b, m0: b.mass }
}
```

```ts
// src/sim/integrator.ts
import type { Body } from './body'
import { G, SOFTENING } from '../constants'
import { v, type Vec } from './vec'

// Pairwise Newtonian gravity. extraAccel lets sim.ts inject the runaway and
// station-keeping terms (Tasks 7/8) without the integrator knowing about them.
export type ExtraAccel = (b: Body, i: number) => Vec

export function accelerations(bodies: Body[], extra?: ExtraAccel): Vec[] {
  const acc: Vec[] = bodies.map(() => v(0, 0))
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j]
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y
      const d2 = dx * dx + dy * dy + SOFTENING * SOFTENING
      const d = Math.sqrt(d2)
      const f = G / (d2 * d) // 1/d^3 for direction scaling
      acc[i].x += f * b.mass * dx; acc[i].y += f * b.mass * dy
      acc[j].x -= f * a.mass * dx; acc[j].y -= f * a.mass * dy
    }
  }
  if (extra) {
    for (let i = 0; i < bodies.length; i++) {
      const e = extra(bodies[i], i)
      acc[i].x += e.x; acc[i].y += e.y
    }
  }
  return acc
}

// Leapfrog (kick-drift-kick): symplectic, so orbits don't spiral from
// numerical energy drift — the property the null test depends on.
export function step(bodies: Body[], dt: number, extra?: ExtraAccel): void {
  const a1 = accelerations(bodies, extra)
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    b.vel.x += a1[i].x * dt / 2; b.vel.y += a1[i].y * dt / 2
    b.pos.x += b.vel.x * dt;     b.pos.y += b.vel.y * dt
  }
  const a2 = accelerations(bodies, extra)
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    b.vel.x += a2[i].x * dt / 2; b.vel.y += a2[i].y * dt / 2
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integrator.test.ts` — Expected: PASS. (This test integrates ~700k steps; it should still finish in a few seconds. If it's slow, check you aren't allocating inside the inner gravity loop.)

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/sim/body.ts src/sim/integrator.ts tests/integrator.test.ts
git commit -m "feat(sim): bodies, pairwise gravity, leapfrog integrator"
```

---

### Task 4: Solar System Data + Null Test

The roster is *constructed in equilibrium*: every body starts on a circular orbit around its parent (moons inherit the parent's velocity). The null test then proves an untouched system stays green for a full run — no phantom wobble.

**Files:**
- Create: `src/sim/data.ts`
- Test: `tests/system.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/system.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { step } from '../src/sim/integrator'
import { dist } from '../src/sim/vec'
import { DT, RUN_DURATION } from '../src/constants'

describe('solar system', () => {
  it('contains the minable roster', () => {
    const bodies = buildSystem()
    for (const name of ['moon', 'phobos', 'io', 'europa', 'ganymede', 'titan']) {
      expect(findBody(bodies, name)?.minable).toBe(true)
    }
    expect(findBody(bodies, 'ship')).toBeDefined()
  })

  it('null test: untouched system deviates < 1% over a full run', () => {
    const bodies = buildSystem()
    const steps = Math.ceil(RUN_DURATION / DT)
    for (let i = 0; i < steps; i++) step(bodies, DT)
    for (const b of bodies) {
      if (!b.parentName || b.kind === 'ship') continue
      const parent = findBody(bodies, b.parentName)!
      const d = dist(b.pos, parent.pos)
      expect(Math.abs(d - b.rNom) / b.rNom, `${b.name} drifted`).toBeLessThan(0.01)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/system.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement the roster**

```ts
// src/sim/data.ts
import { makeBody, type Body, type Kind } from './body'
import { G, SUN_MASS } from '../constants'
import { v, add } from './vec'

interface Spec {
  name: string; kind: Kind; parent: string | null
  r: number      // orbit radius around parent (game units)
  mass: number
  radius: number // visual/collision radius
  minable?: boolean
  phase?: number // starting angle (radians); spread bodies around the sky
}

// Game-scaled roster. Distances are compressed and moon orbits exaggerated
// for visibility; every orbit starts perfectly circular.
const SPECS: Spec[] = [
  { name: 'sun',     kind: 'star',   parent: null,      r: 0,   mass: SUN_MASS, radius: 10 },
  { name: 'mercury', kind: 'planet', parent: 'sun',     r: 40,  mass: 0.06, radius: 1.2, phase: 0.5 },
  { name: 'venus',   kind: 'planet', parent: 'sun',     r: 60,  mass: 0.8,  radius: 1.9, phase: 2.1 },
  { name: 'earth',   kind: 'planet', parent: 'sun',     r: 80,  mass: 1.0,  radius: 2.0, phase: 4.0 },
  { name: 'moon',    kind: 'moon',   parent: 'earth',   r: 6,   mass: 0.012, radius: 0.7, minable: true },
  { name: 'mars',    kind: 'planet', parent: 'sun',     r: 105, mass: 0.11, radius: 1.5, phase: 5.3, minable: true },
  { name: 'phobos',  kind: 'moon',   parent: 'mars',    r: 4,   mass: 0.004, radius: 0.4, minable: true },
  { name: 'jupiter', kind: 'planet', parent: 'sun',     r: 180, mass: 3.0,  radius: 5.5, phase: 1.2 },
  { name: 'io',      kind: 'moon',   parent: 'jupiter', r: 9,   mass: 0.015, radius: 0.7, minable: true },
  { name: 'europa',  kind: 'moon',   parent: 'jupiter', r: 12,  mass: 0.013, radius: 0.7, minable: true },
  { name: 'ganymede',kind: 'moon',   parent: 'jupiter', r: 16,  mass: 0.025, radius: 0.9, minable: true },
  { name: 'saturn',  kind: 'planet', parent: 'sun',     r: 240, mass: 2.0,  radius: 4.8, phase: 3.6 },
  { name: 'titan',   kind: 'moon',   parent: 'saturn',  r: 13,  mass: 0.023, radius: 0.9, minable: true },
  { name: 'uranus',  kind: 'planet', parent: 'sun',     r: 290, mass: 0.9,  radius: 3.2, phase: 0.2 },
  { name: 'neptune', kind: 'planet', parent: 'sun',     r: 320, mass: 1.0,  radius: 3.1, phase: 2.8 },
]

export function findBody(bodies: Body[], name: string): Body | undefined {
  return bodies.find(b => b.name === name)
}

export function buildSystem(): Body[] {
  const bodies: Body[] = []
  for (const s of SPECS) {
    if (!s.parent) {
      bodies.push(makeBody({ name: s.name, kind: s.kind, mass: s.mass, pos: v(0, 0), vel: v(0, 0), radius: s.radius, parentName: null, rNom: 0 }))
      continue
    }
    const parent = findBody(bodies, s.parent)
    if (!parent) throw new Error(`parent ${s.parent} must be declared before ${s.name}`)
    const phase = s.phase ?? Math.random() * Math.PI * 2
    const pos = add(parent.pos, v(Math.cos(phase) * s.r, Math.sin(phase) * s.r))
    const vCirc = Math.sqrt((G * parent.mass) / s.r)
    // circular velocity perpendicular to the radial direction, plus parent's velocity
    const vel = add(parent.vel, v(-Math.sin(phase) * vCirc, Math.cos(phase) * vCirc))
    bodies.push(makeBody({ name: s.name, kind: s.kind, mass: s.mass, pos, vel, radius: s.radius, parentName: s.parent, rNom: s.r, minable: s.minable }))
  }
  // The ship: near Earth, tiny mass so it never perturbs anything.
  const earth = findBody(bodies, 'earth')!
  bodies.push(makeBody({ name: 'ship', kind: 'ship', mass: 1e-9, pos: add(earth.pos, v(4, 0)), vel: { ...earth.vel }, radius: 0.3, parentName: null, rNom: 0 }))
  return bodies
}
```

Note the moon phases use `Math.random()` — replace that: moons must also take deterministic phases for reproducible runs. Give every moon an explicit `phase` in SPECS (e.g. moon 1.0, phobos 2.0, io 0.8, europa 2.9, ganymede 5.0, titan 1.7) so `buildSystem()` is fully deterministic. Seeded variation between runs comes later via the game layer, not the data layer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/system.test.ts` — Expected: PASS.
If the null test fails: the drifting body's parent mass is too low for its satellite radius (Hill-sphere violation) — move the moon closer or raise the parent's mass, keeping every orbit circular at start. Do not loosen the 1% bound.

- [ ] **Step 5: Commit**

```bash
git add src/sim/data.ts tests/system.test.ts
git commit -m "feat(sim): equilibrium solar-system roster + null stability test"
```

---

### Task 5: Mining — Extraction, Impulse, Conservation

**Files:**
- Create: `src/sim/mining.ts`
- Test: `tests/mining.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mining.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { extract, returnSlag } from '../src/sim/mining'
import { len, sub, scale } from '../src/sim/vec'

describe('mining', () => {
  it('moves mass from body to ship cargo', () => {
    const bodies = buildSystem()
    const europa = findBody(bodies, 'europa')!
    const m0 = europa.mass
    const result = extract(europa, 'strip', 0.002)
    expect(europa.mass).toBeCloseTo(m0 - 0.002, 10)
    expect(result.cargo).toBeCloseTo(0.002, 10)
  })

  it('conserves momentum: body impulse equals ejecta momentum, opposite sign', () => {
    const bodies = buildSystem()
    const europa = findBody(bodies, 'europa')!
    const velBefore = { ...europa.vel }
    const massAfter = europa.mass - 0.002
    const r = extract(europa, 'strip', 0.002)
    const bodyDp = scale(sub(europa.vel, velBefore), massAfter)
    expect(bodyDp.x).toBeCloseTo(-r.ejectaMomentum.x, 8)
    expect(bodyDp.y).toBeCloseTo(-r.ejectaMomentum.y, 8)
  })

  it('strip blast imparts far more impulse than lattice bore for equal mass', () => {
    const a = buildSystem(); const b = buildSystem()
    const ea = findBody(a, 'europa')!; const eb = findBody(b, 'europa')!
    const va = { ...ea.vel }; const vb = { ...eb.vel }
    extract(ea, 'strip', 0.002); extract(eb, 'lattice', 0.002)
    const dva = len(sub(ea.vel, va)); const dvb = len(sub(eb.vel, vb))
    expect(dva).toBeGreaterThan(dvb * 5)
  })

  it('returnSlag restores mass', () => {
    const bodies = buildSystem()
    const europa = findBody(bodies, 'europa')!
    extract(europa, 'strip', 0.002)
    const m = europa.mass
    returnSlag(europa, 0.001)
    expect(europa.mass).toBeCloseTo(m + 0.001, 10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mining.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

```ts
// src/sim/mining.ts
import type { Body } from './body'
import { EJECTA_SPEED, ASYM } from '../constants'
import { norm, scale, type Vec } from './vec'

export type Method = keyof typeof ASYM  // 'strip' | 'lattice'

export interface ExtractResult { cargo: number; ejectaMomentum: Vec }

// Newton's third law is the core mechanic: extracted mass leaves as ejecta
// carrying momentum. Strip blast throws it one-sided (prograde), shoving the
// body; lattice bore is near-symmetric so impulses almost cancel.
export function extract(body: Body, method: Method, dm: number): ExtractResult {
  dm = Math.min(dm, body.mass * 0.5) // never let a body vanish in one call
  const dir = norm(body.vel)         // prograde ejection direction
  const pEject = scale(dir, dm * EJECTA_SPEED * ASYM[method])
  body.mass -= dm
  // impulse on body = -ejecta momentum, applied to remaining mass
  body.vel.x -= pEject.x / body.mass
  body.vel.y -= pEject.y / body.mass
  return { cargo: dm, ejectaMomentum: pEject }
}

// Healing lever #1: give mass back (delivered gently — no impulse).
export function returnSlag(body: Body, dm: number): void {
  body.mass += dm
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mining.test.ts` — Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sim/mining.ts tests/mining.test.ts
git commit -m "feat(sim): mining extraction with momentum-conserving ejecta impulses"
```

---

### Task 6: Stability Scores, Bands, Threshold Events

**Files:**
- Create: `src/sim/stability.ts`
- Test: `tests/stability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/stability.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { step } from '../src/sim/integrator'
import { extract } from '../src/sim/mining'
import { StabilityTracker, scoreOf, harmony } from '../src/sim/stability'
import { DT } from '../src/constants'

function run(bodies: ReturnType<typeof buildSystem>, tu: number, tracker?: StabilityTracker) {
  const steps = Math.ceil(tu / DT)
  const events: ReturnType<StabilityTracker['update']> = []
  for (let i = 0; i < steps; i++) {
    step(bodies, DT)
    if (tracker) events.push(...tracker.update(bodies))
  }
  return events
}

describe('stability', () => {
  it('untouched body scores ~100', () => {
    const bodies = buildSystem()
    run(bodies, 50)
    expect(scoreOf(findBody(bodies, 'europa')!, bodies)).toBeGreaterThan(97)
  })

  it('monotonic causality: more strip mining never improves the score', () => {
    const doses = [0, 0.001, 0.003, 0.006]
    const scores = doses.map(dose => {
      const bodies = buildSystem()
      const europa = findBody(bodies, 'europa')!
      if (dose > 0) extract(europa, 'strip', dose)
      run(bodies, 100)
      return scoreOf(europa, bodies)
    })
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] + 0.5) // small tolerance for oscillation sampling
    }
    expect(scores[3]).toBeLessThan(scores[0] - 5) // and the effect is material
  })

  it('emits a band-crossing event exactly once per crossing', () => {
    const bodies = buildSystem()
    const europa = findBody(bodies, 'europa')!
    const tracker = new StabilityTracker(bodies)
    extract(europa, 'strip', 0.006)
    const events = run(bodies, 150, tracker)
    const amberEvents = events.filter(e => e.body === 'europa' && e.to === 'amber')
    expect(amberEvents.length).toBe(1)
  })

  it('harmony index drops when a body wobbles', () => {
    const bodies = buildSystem()
    const h0 = harmony(bodies)
    extract(findBody(bodies, 'europa')!, 'strip', 0.006)
    run(bodies, 100)
    expect(harmony(bodies)).toBeLessThan(h0)
  })

  it('mass-loss coupling: draining a parent loosens its moons (spec §5)', () => {
    // Halve Mars's mass directly (no impulse — isolate the gravity-grip effect)
    const bodies = buildSystem()
    const control = buildSystem()
    findBody(bodies, 'mars')!.mass *= 0.5
    run(bodies, 150); run(control, 150)
    const drained = scoreOf(findBody(bodies, 'phobos')!, bodies)
    const untouched = scoreOf(findBody(control, 'phobos')!, control)
    expect(drained).toBeLessThan(untouched - 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stability.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

```ts
// src/sim/stability.ts
import type { Body } from './body'
import { findBody } from './data'
import { dist } from './vec'
import { DEV_GAIN, BAND_AMBER, BAND_RED, BAND_CRITICAL } from '../constants'

export type Band = 'green' | 'amber' | 'red' | 'critical'

export function deviationOf(body: Body, bodies: Body[]): number {
  if (!body.parentName || body.rNom === 0) return 0
  const parent = findBody(bodies, body.parentName)
  if (!parent) return 0
  return Math.abs(dist(body.pos, parent.pos) - body.rNom) / body.rNom
}

export function scoreOf(body: Body, bodies: Body[]): number {
  return Math.max(0, Math.min(100, 100 - DEV_GAIN * deviationOf(body, bodies)))
}

export function bandOf(score: number): Band {
  if (score < BAND_CRITICAL) return 'critical'
  if (score < BAND_RED) return 'red'
  if (score < BAND_AMBER) return 'amber'
  return 'green'
}

// m0-weighted so wobbling Jupiter matters more than wobbling Phobos.
export function harmony(bodies: Body[]): number {
  let sum = 0, w = 0
  for (const b of bodies) {
    if (!b.parentName || b.kind === 'ship' || b.kind === 'fab') continue
    sum += scoreOf(b, bodies) * b.m0
    w += b.m0
  }
  return w === 0 ? 100 : sum / w
}

export interface BandEvent { body: string; from: Band; to: Band; score: number }

// Fires events ONLY on band crossings — the spec's alarm-fatigue rule.
// A peak-hold keeps oscillating orbits (r swings through rNom twice per orbit)
// from flapping between bands: the tracked score is the worst score seen
// recently, decaying slowly back toward current.
export class StabilityTracker {
  private held = new Map<string, number>()
  private bands = new Map<string, Band>()

  constructor(bodies: Body[]) {
    for (const b of bodies) {
      this.held.set(b.name, 100)
      this.bands.set(b.name, 'green')
    }
  }

  heldScore(name: string): number { return this.held.get(name) ?? 100 }
  heldBand(name: string): Band { return this.bands.get(name) ?? 'green' }

  update(bodies: Body[]): BandEvent[] {
    const events: BandEvent[] = []
    for (const b of bodies) {
      if (!b.parentName || b.kind === 'ship' || b.kind === 'fab') continue
      const raw = scoreOf(b, bodies)
      const prev = this.held.get(b.name) ?? 100
      const held = Math.min(raw, prev + 0.002) // instant worsen, slow recover
      this.held.set(b.name, held)
      const from = this.bands.get(b.name) ?? 'green'
      const to = bandOf(held)
      if (to !== from) {
        this.bands.set(b.name, to)
        events.push({ body: b.name, from, to, score: held })
      }
    }
    return events
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stability.test.ts` — Expected: PASS (4 tests). If the monotonicity test fails on tolerance, the peak-hold recovery rate (0.002) is too fast — lower it; do not widen the test tolerance.

- [ ] **Step 5: Commit**

```bash
git add src/sim/stability.ts tests/stability.test.ts
git commit -m "feat(sim): stability scores, peak-hold band tracker, harmony index"
```

---

### Task 7: Sim Facade — Runaway, Collisions, Ejections

**Files:**
- Create: `src/sim/sim.ts`
- Test: `tests/sim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sim.test.ts
import { describe, it, expect } from 'vitest'
import { Sim } from '../src/sim/sim'
import { findBody } from '../src/sim/data'
import { extract } from '../src/sim/mining'

describe('Sim facade', () => {
  it('ticks the system and reports harmony', () => {
    const sim = new Sim()
    sim.tick(10)
    expect(sim.harmony()).toBeGreaterThan(97)
  })

  it('past critical, deviation compounds into runaway (designed instability)', () => {
    const sim = new Sim()
    const europa = findBody(sim.bodies, 'europa')!
    extract(europa, 'strip', europa.mass * 0.45) // savage over-mining
    sim.tick(400)
    const catastrophes = sim.drainEvents().filter(e => e.type === 'catastrophe')
    expect(catastrophes.length).toBeGreaterThan(0)
  })

  it('an untouched system produces no catastrophe in a full run', () => {
    const sim = new Sim()
    sim.tick(1800)
    expect(sim.drainEvents().filter(e => e.type === 'catastrophe').length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

```ts
// src/sim/sim.ts
import type { Body } from './body'
import { makeBody } from './body'
import { buildSystem, findBody } from './data'
import { step, type ExtraAccel } from './integrator'
import { StabilityTracker, deviationOf, harmony, type BandEvent } from './stability'
import { dist, norm, sub, scale, v, type Vec } from './vec'
import { DT, RUNAWAY_ACCEL, EJECT_RADIUS, ASSIST_K, ASSIST_RANGE, G } from '../constants'

export type SimEvent =
  | ({ type: 'band' } & BandEvent)
  | { type: 'catastrophe'; kind: 'collision' | 'ejection' | 'sundive'; body: string; other?: string }

export class Sim {
  bodies: Body[] = buildSystem()
  tracker = new StabilityTracker(this.bodies)
  private events: SimEvent[] = []
  private dead = new Set<string>()

  harmony(): number { return harmony(this.bodies) }
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e }

  // Fabs are real masses in the sim, placed on a circular orbit at their radius.
  addFab(pos: Vec, mass: number): Body {
    const r = Math.hypot(pos.x, pos.y)
    const vCirc = Math.sqrt((G * findBody(this.bodies, 'sun')!.mass) / r)
    const t = norm(v(-pos.y, pos.x))
    const fab = makeBody({ name: `fab-${this.bodies.filter(b => b.kind === 'fab').length + 1}`,
      kind: 'fab', mass, pos: { ...pos }, vel: scale(t, vCirc), radius: 1.2, parentName: 'sun', rNom: r })
    this.bodies.push(fab)
    this.tracker = new StabilityTracker(this.bodies) // re-seed tracker with new body
    return fab
  }

  // Extra accelerations injected into the integrator:
  //  1. Designed runaway: past critical, push the body further off its nominal
  //     orbit proportionally to its deviation (the legible cascade).
  //  2. Gravitational-tether station-keeping (spec refinement): each nearby fab
  //     applies a restoring acceleration toward the nominal radius, scaled by
  //     fabMass/d² — the one gameplay-designed force in the sim.
  private extraAccel: ExtraAccel = (b) => {
    if (!b.parentName || b.kind === 'ship' || b.kind === 'fab') return v(0, 0)
    const parent = findBody(this.bodies, b.parentName)
    if (!parent) return v(0, 0)
    const radial = norm(sub(b.pos, parent.pos))
    const d = dist(b.pos, parent.pos)
    const out = v(0, 0)
    if (this.tracker.heldBand(b.name) === 'critical') {
      const dev = deviationOf(b, this.bodies)
      const sign = d >= b.rNom ? 1 : -1
      out.x += radial.x * RUNAWAY_ACCEL * dev * sign * 100
      out.y += radial.y * RUNAWAY_ACCEL * dev * sign * 100
    }
    for (const fab of this.bodies) {
      if (fab.kind !== 'fab') continue
      const fd = dist(fab.pos, b.pos)
      if (fd > ASSIST_RANGE) continue
      const restore = (ASSIST_K * fab.mass) / (fd * fd)
      const sign = d >= b.rNom ? -1 : 1 // pull back toward nominal radius
      out.x += radial.x * restore * sign
      out.y += radial.y * restore * sign
    }
    return out
  }

  tick(tu: number): void {
    const steps = Math.ceil(tu / DT)
    for (let i = 0; i < steps; i++) {
      step(this.bodies, DT, this.extraAccel)
      for (const ev of this.tracker.update(this.bodies)) this.events.push({ type: 'band', ...ev })
      this.detectCatastrophes()
    }
  }

  private detectCatastrophes(): void {
    const sun = findBody(this.bodies, 'sun')!
    for (const b of this.bodies) {
      if (b.kind === 'star' || b.kind === 'ship' || this.dead.has(b.name)) continue
      const dSun = dist(b.pos, sun.pos)
      if (dSun > EJECT_RADIUS) { this.dead.add(b.name); this.events.push({ type: 'catastrophe', kind: 'ejection', body: b.name }); continue }
      if (dSun < sun.radius + b.radius) { this.dead.add(b.name); this.events.push({ type: 'catastrophe', kind: 'sundive', body: b.name }); continue }
      for (const o of this.bodies) {
        if (o === b || o.kind === 'ship' || o.kind === 'star' || this.dead.has(o.name)) continue
        if (dist(b.pos, o.pos) < (b.radius + o.radius) * 0.8) {
          this.dead.add(b.name)
          this.events.push({ type: 'catastrophe', kind: 'collision', body: b.name, other: o.name })
          break
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sim.test.ts` — Expected: PASS (3 tests). If the runaway test fails, raise `RUNAWAY_ACCEL` in constants; if the null-run test now fails, the runaway trigger is leaking into green bodies — check `heldBand` gating.

- [ ] **Step 5: Commit**

```bash
git add src/sim/sim.ts tests/sim.test.ts
git commit -m "feat(sim): Sim facade with designed runaway, fabs, catastrophe detection"
```

---

### Task 8: Rebalance Efficacy — Counterweights & Slag

**Files:**
- Test: `tests/rebalance.test.ts` (logic already exists in Tasks 5/7 — this task *proves* the levers work and tunes constants)

- [ ] **Step 1: Write the failing test**

```ts
// tests/rebalance.test.ts
import { describe, it, expect } from 'vitest'
import { Sim } from '../src/sim/sim'
import { findBody } from '../src/sim/data'
import { extract, returnSlag } from '../src/sim/mining'
import { deviationOf, scoreOf } from '../src/sim/stability'

function wobbleEuropa(sim: Sim) {
  extract(findBody(sim.bodies, 'europa')!, 'strip', 0.005)
}

describe('rebalancing levers', () => {
  it('a nearby counterweight fab reduces drift vs. doing nothing', () => {
    const a = new Sim(); const b = new Sim()
    wobbleEuropa(a); wobbleEuropa(b)
    const europaB = findBody(b.bodies, 'europa')!
    b.addFab({ x: europaB.pos.x * 1.05, y: europaB.pos.y * 1.05 }, 5)
    a.tick(300); b.tick(300)
    const devA = deviationOf(findBody(a.bodies, 'europa')!, a.bodies)
    const devB = deviationOf(findBody(b.bodies, 'europa')!, b.bodies)
    expect(devB).toBeLessThan(devA * 0.7)
  })

  it('returning slag improves the raw stability trajectory', () => {
    const a = new Sim(); const b = new Sim()
    wobbleEuropa(a); wobbleEuropa(b)
    returnSlag(findBody(b.bodies, 'europa')!, 0.005)
    a.tick(300); b.tick(300)
    const sA = scoreOf(findBody(a.bodies, 'europa')!, a.bodies)
    const sB = scoreOf(findBody(b.bodies, 'europa')!, b.bodies)
    expect(sB).toBeGreaterThanOrEqual(sA)
  })
})
```

- [ ] **Step 2: Run test — tune until it passes**

Run: `npx vitest run tests/rebalance.test.ts`

This is a *tuning* task: if the counterweight test fails, adjust `ASSIST_K` / `ASSIST_RANGE` in `src/constants.ts` upward until the fab measurably stabilizes Europa, then re-run the FULL suite (`npm run test`) to confirm nothing else regressed (especially the null test — assist must not destabilize green bodies; it can't, because it always points toward nominal, but verify).

Expected end state: PASS, full suite green.

- [ ] **Step 3: Commit**

```bash
git add tests/rebalance.test.ts src/constants.ts
git commit -m "test(sim): prove counterweight and slag-return rebalancing levers work"
```

---

### Task 9: Game Director — Run State Machine

**Files:**
- Create: `src/game/director.ts`
- Test: `tests/director.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/director.test.ts
import { describe, it, expect } from 'vitest'
import { Director } from '../src/game/director'

describe('Director', () => {
  it('starts in orrery with 0% sphere', () => {
    const d = new Director()
    expect(d.state).toBe('orrery')
    expect(d.sphereProgress()).toBe(0)
  })

  it('travels to a target then enters mining', () => {
    const d = new Director()
    d.selectTarget('europa')
    d.launch()
    expect(d.state).toBe('transit')
    d.advance(d.transitRemaining() + 1) // real-time seconds
    expect(d.state).toBe('mining')
  })

  it('mining accumulates cargo; delivering builds the sphere', () => {
    const d = new Director()
    d.selectTarget('europa'); d.launch(); d.advance(d.transitRemaining() + 1)
    d.chooseExtraction('strip')
    d.advance(30)
    expect(d.cargo).toBeGreaterThan(0)
    d.selectTarget('fab'); d.launch(); d.advance(d.transitRemaining() + 1)
    expect(d.state).toBe('constructing')
    const before = d.sphereProgress()
    d.placeSegment('suggested')
    expect(d.sphereProgress()).toBeGreaterThan(before)
  })

  it('a catastrophe ends the run as a loss', () => {
    const d = new Director()
    // brute-force: strip Europa to runaway via many mining cycles
    d.selectTarget('europa'); d.launch(); d.advance(d.transitRemaining() + 1)
    d.chooseExtraction('strip')
    d.advance(3000)
    expect(d.state).toBe('lost')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/director.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

```ts
// src/game/director.ts
import { Sim, type SimEvent } from '../sim/sim'
import { findBody } from '../sim/data'
import { extract, returnSlag, type Method } from '../sim/mining'
import { dist, sub, norm, scale, add } from '../sim/vec'
import { RATE, SPHERE_MASS_REQUIRED } from '../constants'

export type State = 'orrery' | 'transit' | 'mining' | 'constructing' | 'won' | 'lost'

// Time model: advance(dtReal) receives REAL seconds from the main loop.
// The Temporal Compressorator maps real seconds -> sim tu (1:1 at rate 1).
// The ×80,000 shown in the HUD is fiction/flavor over this mapping.
export const SIM_RATE = 1          // tu per real second
const TRAVEL_SPEED = 25            // game-units per real second (autopilot)
const SLINGSHOT_BONUS = 0.35       // fraction of transit skipped by a well-timed burn
const DECISION_WINDOW = 8          // seconds to make a construction choice

export class Director {
  sim = new Sim()
  state: State = 'orrery'
  cargo = 0
  private sphereMass = 0
  private target: string | null = null
  private transitLeft = 0
  private extraction: Method | null = null
  private decisionLeft = 0
  private eventLog: SimEvent[] = []

  sphereProgress(): number { return Math.min(1, this.sphereMass / SPHERE_MASS_REQUIRED) * 100 }
  transitRemaining(): number { return this.transitLeft }
  decisionRemaining(): number { return this.decisionLeft }
  drainEvents(): SimEvent[] { const e = this.eventLog; this.eventLog = [] ; return e }

  selectTarget(name: 'fab' | string): void {
    if (this.state !== 'orrery' && this.state !== 'mining' && this.state !== 'constructing') return
    this.target = name
    this.extraction = null
  }

  launch(): void {
    if (!this.target) return
    const ship = findBody(this.sim.bodies, 'ship')!
    const dest = this.target === 'fab' ? this.fabAnchor() : findBody(this.sim.bodies, this.target)!.pos
    this.transitLeft = dist(ship.pos, dest) / TRAVEL_SPEED
    this.state = 'transit'
  }

  // Player skill expression: a burn during transit shaves time (slingshot).
  burn(): void {
    if (this.state === 'transit') this.transitLeft *= (1 - SLINGSHOT_BONUS)
  }

  chooseExtraction(m: Method): void {
    if (this.state === 'mining') this.extraction = m
  }

  dumpSlag(): void {
    if (this.state !== 'mining' || !this.target || this.cargo <= 0) return
    const body = findBody(this.sim.bodies, this.target)!
    returnSlag(body, this.cargo)
    this.cargo = 0
  }

  placeSegment(_placement: 'suggested' | 'hasty'): void {
    if (this.state !== 'constructing' || this.cargo <= 0) return
    // Delivered mass becomes sphere progress AND a real counterweight fab.
    // 'suggested' placement goes near the most-wobbly body; 'hasty' goes wherever
    // the ship is (fast, no rebalancing value).
    const pos = _placement === 'suggested' ? this.suggestedFabPos() : { ...findBody(this.sim.bodies, 'ship')!.pos }
    this.sim.addFab(pos, this.cargo)
    this.sphereMass += this.cargo
    this.cargo = 0
    this.decisionLeft = 0
    this.state = this.sphereProgress() >= 100 ? 'won' : 'orrery'
  }

  advance(dtReal: number): void {
    if (this.state === 'won' || this.state === 'lost') return
    this.sim.tick(dtReal * SIM_RATE)
    const events = this.sim.drainEvents()
    this.eventLog.push(...events)
    if (events.some(e => e.type === 'catastrophe')) { this.state = 'lost'; return }

    if (this.state === 'transit') {
      this.transitLeft -= dtReal
      if (this.transitLeft <= 0) {
        this.state = this.target === 'fab' ? 'constructing' : 'mining'
        if (this.state === 'constructing') this.decisionLeft = DECISION_WINDOW
      }
    } else if (this.state === 'mining' && this.extraction && this.target) {
      const body = findBody(this.sim.bodies, this.target)!
      const r = extract(body, this.extraction, RATE[this.extraction] * dtReal)
      this.cargo += r.cargo
    } else if (this.state === 'constructing') {
      this.decisionLeft -= dtReal
      if (this.decisionLeft <= 0) this.placeSegment('hasty') // hesitate and the fab auto-places badly
    }
  }

  private fabAnchor() {
    const sun = findBody(this.sim.bodies, 'sun')!
    return add(sun.pos, { x: 25, y: 0 })
  }

  private suggestedFabPos() {
    // near the body with the worst held score
    let worst: string | null = null; let worstScore = 101
    for (const b of this.sim.bodies) {
      if (!b.parentName || b.kind === 'ship' || b.kind === 'fab') continue
      const s = this.sim.tracker.heldScore(b.name)
      if (s < worstScore) { worstScore = s; worst = b.name }
    }
    const b = findBody(this.sim.bodies, worst ?? 'earth')!
    const away = norm(sub(b.pos, findBody(this.sim.bodies, 'sun')!.pos))
    return add(b.pos, scale(away, 5))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/director.test.ts` — Expected: PASS (4 tests). The catastrophe test depends on tuned `RATE.strip` and `RUNAWAY_ACCEL`; if it times out, raise `RATE.strip`.

- [ ] **Step 5: Commit**

```bash
git add src/game/director.ts tests/director.test.ts
git commit -m "feat(game): run state machine with transit, mining, timed construction"
```

---

### Task 10: Scenario Bots — Greedy Loses, Efficient Wins

This is the design's central promise, enforced by tests: the game is winnable, losable, and honest.

**Files:**
- Test: `tests/scenario.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/scenario.test.ts
import { describe, it, expect } from 'vitest'
import { Director } from '../src/game/director'
import { findBody } from '../src/sim/data'

const MINABLE = ['moon', 'phobos', 'io', 'europa', 'ganymede', 'titan', 'mars']

function playRound(d: Director, targetIdx: number, method: 'strip' | 'lattice', mineFor: number, placement: 'suggested' | 'hasty') {
  d.selectTarget(MINABLE[targetIdx % MINABLE.length]); d.launch()
  d.advance(d.transitRemaining() + 0.1)
  if (d.state !== 'mining') return
  d.chooseExtraction(method)
  d.advance(mineFor)
  if ((d.state as string) !== 'mining') return
  d.selectTarget('fab'); d.launch()
  d.advance(d.transitRemaining() + 0.1)
  if ((d.state as string) === 'constructing') d.placeSegment(placement)
}

describe('scenario bots', () => {
  it('GREEDY BOT: strip-blasts one moon relentlessly and loses', () => {
    const d = new Director()
    for (let round = 0; round < 60 && d.state !== 'lost' && d.state !== 'won'; round++) {
      playRound(d, 3 /* always europa */, 'strip', 60, 'hasty')
    }
    expect(d.state).toBe('lost')
  })

  it('EFFICIENT BOT: lattice-bores across many bodies with suggested placement and wins', () => {
    const d = new Director()
    for (let round = 0; round < 200 && d.state !== 'lost' && d.state !== 'won'; round++) {
      playRound(d, round /* rotate targets */, 'lattice', 40, 'suggested')
    }
    expect(d.state).toBe('won')
  })

  it('the efficient run finishes inside the run-duration budget', () => {
    // Winnability must hold within ~35 minutes of real time (2100s).
    const d = new Director()
    let elapsed = 0
    const before = () => elapsed
    for (let round = 0; round < 200 && d.state !== 'lost' && d.state !== 'won'; round++) {
      const t0 = before()
      playRound(d, round, 'lattice', 40, 'suggested')
      elapsed = t0 + 40 + 20 // mining + generous transit estimate per round
    }
    expect(d.state).toBe('won')
    expect(elapsed).toBeLessThan(2100)
  })
})
```

- [ ] **Step 2: Run and TUNE until all three pass**

Run: `npx vitest run tests/scenario.test.ts`

This is the game-balance task. Expected initial state: some failures. Tune ONLY in `src/constants.ts`, in this order:

1. Greedy bot doesn't lose → raise `ASYM.strip` or `RATE.strip`, or lower `BAND_CRITICAL` margin (raise `DEV_GAIN`).
2. Efficient bot doesn't win → lower `SPHERE_MASS_REQUIRED` or raise `RATE.lattice`.
3. Efficient bot wins but too slowly → raise `RATE.lattice` (keep `RATE.strip / RATE.lattice ≥ 3` so the greed temptation stays real).

After each change run the FULL suite: `npm run test`. All previous tests must stay green — they are the honesty constraints on your tuning.

- [ ] **Step 3: Commit**

```bash
git add tests/scenario.test.ts src/constants.ts
git commit -m "test(game): scenario bots prove the run is winnable, losable, and honest"
```

---

### Task 11: Renderer Shell + The Glorious Sky

From here the work is visual; verification is by preview + screenshot rather than unit tests. Keep `npm run test` green throughout.

**Files:**
- Create: `src/render/renderer.ts`, `src/render/sky.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the renderer shell**

```ts
// src/render/renderer.ts
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export class Renderer {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  composer: EffectComposer

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(innerWidth, innerHeight)
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000)
    this.camera.position.set(0, -260, 200)   // tilted god view of the xy orbital plane
    this.camera.lookAt(0, 0, 0)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.6, 0.1))

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(innerWidth, innerHeight)
      this.composer.setSize(innerWidth, innerHeight)
    })
  }

  render() { this.composer.render() }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}
```

- [ ] **Step 2: Implement the sky** — three parallax star layers, nebula sprites, galaxy, twinkle.

```ts
// src/render/sky.ts
import * as THREE from 'three'

function starLayer(count: number, radius: number, size: number, seed: number): THREE.Points {
  const pos = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < count; i++) {
    // random directions on a far sphere
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1)
    pos[i * 3] = radius * Math.sin(ph) * Math.cos(th)
    pos[i * 3 + 1] = radius * Math.sin(ph) * Math.sin(th)
    pos[i * 3 + 2] = radius * Math.cos(ph)
    phase[i] = rand() * Math.PI * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSize: { value: size } },
    vertexShader: `
      attribute float phase; uniform float uTime; uniform float uSize;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * (0.8 + fract(phase) * 2.0) + phase * 7.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * vTwinkle;
      }`,
    fragmentShader: `
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * glow, glow * vTwinkle);
      }`,
  })
  return new THREE.Points(geo, mat)
}

function nebulaSprite(color: string, size: number, pos: THREE.Vector3): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256)
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.35, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(size)
  sprite.position.copy(pos)
  return sprite
}

export class Sky {
  group = new THREE.Group()
  private layers: THREE.Points[]
  private nebulae: THREE.Sprite[] = []

  constructor(quality: 1 | 2 | 3 = 3) {
    const counts = { 1: [800, 300, 80], 2: [2000, 700, 160], 3: [4500, 1500, 300] }[quality]
    this.layers = [
      starLayer(counts[0], 2400, 1.6, 11),  // far dust
      starLayer(counts[1], 1900, 2.6, 22),  // mid
      starLayer(counts[2], 1500, 4.5, 33),  // near bright
    ]
    this.layers.forEach(l => this.group.add(l))
    const nebulaSpecs: Array<[string, number, THREE.Vector3]> = [
      ['rgba(122,66,196,0.8)', 1600, new THREE.Vector3(-900, 600, -1400)],
      ['rgba(18,160,176,0.7)', 1800, new THREE.Vector3(1000, -500, -1500)],
      ['rgba(208,74,146,0.6)', 1200, new THREE.Vector3(700, 800, -1300)],
      ['rgba(224,138,60,0.4)', 2000, new THREE.Vector3(0, 0, -1700)],
    ]
    for (const [c, s, p] of nebulaSpecs) this.nebulae.push(nebulaSprite(c, s, p))
    this.nebulae.forEach(n => this.group.add(n))
  }

  // Parallax: sky group counter-rotates slightly against camera movement,
  // with each layer at a different radius the depth reads naturally.
  update(time: number, harmonyPct: number) {
    for (const l of this.layers) (l.material as THREE.ShaderMaterial).uniforms.uTime.value = time
    // ambient mood ring: warm when harmonious, cold/red as instability spreads
    const cold = 1 - harmonyPct / 100
    for (const n of this.nebulae) {
      const m = n.material as THREE.SpriteMaterial
      m.color.setRGB(1 + cold * 0.3, 1 - cold * 0.25, 1 - cold * 0.15)
    }
  }
}
```

- [ ] **Step 3: Wire a minimal main loop to view the sky**

Replace `src/main.ts`:

```ts
import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'

const app = document.getElementById('app')!
if (!webglAvailable()) {
  app.innerHTML = '<div style="color:#cfe3ff;font-family:monospace;padding:40vh 20px;text-align:center">Celestial Counterweight needs WebGL. Please try a modern desktop browser.</div>'
} else {
  const r = new Renderer(app)
  const sky = new Sky()
  r.scene.add(sky.group)
  const loop = (t: number) => {
    sky.update(t / 1000, 100)
    r.render()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
```

- [ ] **Step 4: Visual verification**

Create `.claude/launch.json` with a `dev` config (`npm run dev`, port 5173), start the preview, and screenshot. Expected: deep-space black with thousands of twinkling stars in visible depth layers, four colored nebula glows, bloom on bright stars. Check the console for errors. Pan the camera in devtools (or temporarily animate it) to confirm parallax between layers.

- [ ] **Step 5: Run full test suite, then commit**

Run: `npm run test` — Expected: all green (rendering must not break sim tests).

```bash
git add -A
git commit -m "feat(render): renderer shell with bloom + glorious parallax sky"
```

---### Task 12: Orrery Scene

**Files:**
- Create: `src/render/orrery.ts`
- Modify: `src/main.ts`
- Create: `public/textures/` (downloaded planet textures)

- [ ] **Step 1: Download planet textures** (Solar System Scope, CC BY 4.0 — attribute in the page footer later)

```bash
mkdir -p public/textures && cd public/textures
for name in sun mercury venus_atmosphere earth_daymap moon mars jupiter saturn uranus neptune; do
  curl -fsSLO "https://www.solarsystemscope.com/textures/download/2k_${name}.jpg"
done
cd ../..
```

If any download fails, proceed — the code below falls back to flat colors per body.

- [ ] **Step 2: Implement the orrery**

```ts
// src/render/orrery.ts
import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { Body } from '../sim/body'
import type { Band } from '../sim/stability'

const TEXTURE_FILE: Record<string, string> = {
  sun: '2k_sun.jpg', mercury: '2k_mercury.jpg', venus: '2k_venus_atmosphere.jpg',
  earth: '2k_earth_daymap.jpg', moon: '2k_moon.jpg', mars: '2k_mars.jpg',
  jupiter: '2k_jupiter.jpg', saturn: '2k_saturn.jpg', uranus: '2k_uranus.jpg', neptune: '2k_neptune.jpg',
}
const FALLBACK_COLOR: Record<string, number> = {
  sun: 0xffd75e, mercury: 0x9a8a7a, venus: 0xd9b98a, earth: 0x5a8fd0, moon: 0xb0b0b8,
  mars: 0xd0745a, phobos: 0x8a7a6a, jupiter: 0xcaa77e, io: 0xd8c060, europa: 0xc8d8e0,
  ganymede: 0xa89a8a, saturn: 0xd8c8a0, titan: 0xd0a860, uranus: 0x9ad0d8, neptune: 0x6a8ad8,
}
const BAND_COLOR: Record<Band, number> = { green: 0x4a9d6f, amber: 0xe0b34e, red: 0xe05e5e, critical: 0xff2222 }
const TRAIL_LEN = 240

export class Orrery {
  group = new THREE.Group()
  private meshes = new Map<string, THREE.Object3D>()
  private trails = new Map<string, { line: THREE.Line; pts: THREE.Vector3[] }>()
  private harmonyRing: THREE.Mesh
  private loader = new THREE.TextureLoader()

  constructor(private sim: Sim) {
    for (const b of sim.bodies) this.addBody(b)
    // Harmony Ring: a thin torus enclosing the whole system
    this.harmonyRing = new THREE.Mesh(
      new THREE.TorusGeometry(345, 0.8, 8, 256),
      new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.5 }),
    )
    this.group.add(this.harmonyRing)
    const sunlight = new THREE.PointLight(0xfff2d0, 30000, 0, 1.6)
    this.group.add(sunlight, new THREE.AmbientLight(0x334, 2))
  }

  addBody(b: Body) {
    let mesh: THREE.Object3D
    if (b.kind === 'ship') {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 6), new THREE.MeshBasicMaterial({ color: 0xdceaff }))
    } else if (b.kind === 'fab') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), new THREE.MeshBasicMaterial({ color: 0x7ff0d0, wireframe: true }))
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR[b.name] ?? 0x888888 })
      const file = TEXTURE_FILE[b.name]
      if (file) this.loader.load(`/textures/${file}`, t => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true })
      if (b.kind === 'star') {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 48, 48), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }))
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 32, 32), mat)
      }
    }
    mesh.userData.bodyName = b.name
    this.group.add(mesh)
    this.meshes.set(b.name, mesh)
    if (b.kind === 'planet' || b.kind === 'moon') {
      const geo = new THREE.BufferGeometry().setFromPoints([])
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: BAND_COLOR.green, transparent: true, opacity: 0.7 }))
      this.group.add(line)
      this.trails.set(b.name, { line, pts: [] })
    }
  }

  update(time: number) {
    for (const b of this.sim.bodies) {
      let mesh = this.meshes.get(b.name)
      if (!mesh) { this.addBody(b); mesh = this.meshes.get(b.name)! } // fabs appear mid-run
      mesh.position.set(b.pos.x, b.pos.y, 0)
      if (b.kind === 'planet' || b.kind === 'moon' || b.kind === 'star') mesh.rotation.z = time * 0.1
      const trail = this.trails.get(b.name)
      if (trail) {
        trail.pts.push(new THREE.Vector3(b.pos.x, b.pos.y, 0))
        if (trail.pts.length > TRAIL_LEN) trail.pts.shift()
        trail.line.geometry.setFromPoints(trail.pts)
        const band = this.sim.tracker.heldBand(b.name)
        const m = trail.line.material as THREE.LineBasicMaterial
        m.color.set(BAND_COLOR[band])
        m.opacity = band === 'red' || band === 'critical' ? 0.6 + 0.4 * Math.sin(time * 8) : 0.7
      }
    }
    // Harmony Ring integrity: fade + flicker as harmony drops
    const h = this.sim.harmony()
    const rm = this.harmonyRing.material as THREE.MeshBasicMaterial
    rm.opacity = 0.15 + 0.45 * (h / 100) + (h < 60 ? 0.15 * Math.sin(time * 10) : 0)
  }

  // Click-picking for target selection
  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.group.children, false)
    for (const h of hits) {
      const name = h.object.userData.bodyName
      if (name) return name
    }
    return null
  }
}
```

- [ ] **Step 3: Wire into main.ts** — instantiate `Director`, add `Orrery` to the scene alongside `Sky`, advance the director each frame with real dt, and update both. Add a click handler that raycasts through `orrery.pick` and calls `director.selectTarget(name)`.

```ts
// src/main.ts (replace the loop body from Task 11)
import * as THREE from 'three'
import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'
import { Orrery } from './render/orrery'
import { Director } from './game/director'

const app = document.getElementById('app')!
if (!webglAvailable()) {
  app.innerHTML = '<div style="color:#cfe3ff;font-family:monospace;padding:40vh 20px;text-align:center">Celestial Counterweight needs WebGL. Please try a modern desktop browser.</div>'
} else {
  const r = new Renderer(app)
  const director = new Director()
  const sky = new Sky()
  const orrery = new Orrery(director.sim)
  r.scene.add(sky.group, orrery.group)

  const raycaster = new THREE.Raycaster()
  addEventListener('click', (e) => {
    raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), r.camera)
    const name = orrery.pick(raycaster)
    if (name) director.selectTarget(name)
  })

  let last = performance.now()
  const loop = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1); last = t
    if (!document.hidden) director.advance(dt)   // tab-hidden pause
    sky.update(t / 1000, director.sim.harmony())
    orrery.update(t / 1000)
    r.render()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
```

- [ ] **Step 4: Visual verification**

Preview + screenshot. Expected: textured planets orbiting the glowing sun against the sky, green orbit trails behind every planet and moon, the gold Harmony Ring enclosing the system, the ship cone near Earth. Wait ~30s and confirm orbits are visibly circulating and trails follow. Console clean.

- [ ] **Step 5: Full suite + commit**

Run: `npm run test` — Expected: green.

```bash
git add -A
git commit -m "feat(render): orrery scene with textured bodies, band-colored trails, harmony ring"
```

---

### Task 13: Camera Director + Bridge View

**Files:**
- Create: `src/render/cameraDirector.ts`, `src/render/bridge.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the camera director** — the cinematic dive is a smooth interpolation between the god-view pose and a pose just behind the ship looking at the target body.

```ts
// src/render/cameraDirector.ts
import * as THREE from 'three'
import type { Director } from '../game/director'
import { findBody } from '../sim/data'

const GOD_POS = new THREE.Vector3(0, -260, 200)
const DIVE_SECONDS = 2.5

export class CameraDirector {
  private blend = 0 // 0 = orrery god view, 1 = bridge view

  constructor(private camera: THREE.PerspectiveCamera, private director: Director) {}

  update(dt: number) {
    const wantBridge = this.director.state === 'mining' || this.director.state === 'constructing'
    this.blend = THREE.MathUtils.clamp(this.blend + (wantBridge ? dt : -dt) / DIVE_SECONDS, 0, 1)
    const eased = this.blend < 0.5 ? 2 * this.blend * this.blend : 1 - (-2 * this.blend + 2) ** 2 / 2

    const ship = findBody(this.director.sim.bodies, 'ship')!
    const targetName = this.director.state === 'constructing' ? this.nearestFab() : (this.director as unknown as { target: string | null }).target
    const tgt = targetName ? findBody(this.director.sim.bodies, targetName) : null
    const tp = tgt ? new THREE.Vector3(tgt.pos.x, tgt.pos.y, 0) : new THREE.Vector3()
    const sp = new THREE.Vector3(ship.pos.x, ship.pos.y, 0)

    // bridge pose: just behind the ship, looking at the target, low over the plane
    const back = sp.clone().sub(tp).normalize().multiplyScalar(4)
    const bridgePos = sp.clone().add(back).add(new THREE.Vector3(0, 0, 1.5))
    this.camera.position.lerpVectors(GOD_POS, bridgePos, eased)
    const lookAt = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 0, 0), tp, eased)
    this.camera.lookAt(lookAt)
  }

  isBridge(): boolean { return this.blend > 0.85 }

  private nearestFab(): string | null {
    const fabs = this.director.sim.bodies.filter(b => b.kind === 'fab')
    return fabs.length ? fabs[fabs.length - 1].name : 'sun'
  }
}
```

Note: `target` is private in `Director` — add a public getter `currentTarget(): string | null` to `Director` and use it here instead of the cast. (Do it now; the cast above is a placeholder-by-example of what NOT to keep.)

- [ ] **Step 2: Implement the bridge dressing** — hull frame drawn as a fixed HTML/CSS overlay (cheaper and crisper than 3D geometry).

```ts
// src/render/bridge.ts
// The bridge is the same 3D scene seen up close; the "bridge-ness" is set
// dressing: a hull frame vignette + window struts, toggled when camera blend
// passes the threshold.
export class BridgeFrame {
  private el: HTMLDivElement

  constructor(hud: HTMLElement) {
    this.el = document.createElement('div')
    this.el.style.cssText = `
      position:absolute; inset:0; opacity:0; transition:opacity .6s; pointer-events:none;
      background:
        linear-gradient(105deg, #0a0d14 0%, transparent 12%, transparent 88%, #0a0d14 100%),
        linear-gradient(180deg, #0a0d14 0%, transparent 6%, transparent 90%, #0a0d14 100%);
      box-shadow: inset 0 0 140px rgba(0,0,0,0.9);`
    hud.appendChild(this.el)
  }

  setVisible(v: boolean) { this.el.style.opacity = v ? '1' : '0' }
  setAlarm(on: boolean) {
    this.el.style.boxShadow = on
      ? 'inset 0 0 140px rgba(0,0,0,0.9), inset 0 0 60px rgba(224,94,94,0.55)'
      : 'inset 0 0 140px rgba(0,0,0,0.9)'
  }
}
```

- [ ] **Step 3: Wire into main.ts** — create `CameraDirector` and `BridgeFrame`; call `cameraDirector.update(dt)` each frame and `bridgeFrame.setVisible(cameraDirector.isBridge())`. Remove the static camera setup dependency (the camera director now owns the camera each frame).

- [ ] **Step 4: Visual verification**

Preview: click Europa, then trigger launch from console (`director.launch()` — HUD buttons come next task; expose `window.director = director` temporarily in main.ts for this check and remove it in Task 14). Expected: after transit completes, the camera dives from god view down behind the ship until Europa fills the frame, and the hull vignette fades in. State back to orrery → camera pulls out smoothly.

- [ ] **Step 5: Full suite + commit**

```bash
npm run test
git add -A
git commit -m "feat(render): cinematic camera dives + bridge hull dressing"
```

---

### Task 14: HUD — Top Bar, Inspector, Choice Cards, Alerts

**Files:**
- Create: `src/ui/hud.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the HUD.** All DOM, all driven by `Director` state + drained events each frame. Holographic look: monospace, cyan/gold on translucent navy.

```ts
// src/ui/hud.ts
import type { Director } from '../game/director'
import type { SimEvent } from '../sim/sim'

const PANEL = 'position:absolute;background:rgba(10,16,32,.88);border:1px solid rgba(87,200,255,.35);border-radius:6px;color:#cfe3ff;padding:10px 14px;font-size:13px;'

export class Hud {
  private top: HTMLDivElement
  private inspector: HTMLDivElement
  private cards: HTMLDivElement
  private alerts: HTMLDivElement
  private endScreen: HTMLDivElement
  private alertLines: string[] = []
  onChoice: (id: string) => void = () => {}

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `
      <div id="cc-top" style="${PANEL}top:10px;left:50%;transform:translateX(-50%);display:flex;gap:24px;white-space:nowrap"></div>
      <div id="cc-inspector" class="clickable" style="${PANEL}top:60px;right:10px;width:230px"></div>
      <div id="cc-cards" class="clickable" style="position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:14px"></div>
      <div id="cc-alerts" style="${PANEL}bottom:24px;right:10px;width:230px;border-color:rgba(224,94,94,.5);color:#e05e5e;display:none"></div>
      <div id="cc-end" style="${PANEL}top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;font-size:20px;display:none"></div>`)
    this.top = root.querySelector('#cc-top')!
    this.inspector = root.querySelector('#cc-inspector')!
    this.cards = root.querySelector('#cc-cards')!
    this.alerts = root.querySelector('#cc-alerts')!
    this.endScreen = root.querySelector('#cc-end')!
  }

  private card(id: string, color: string, title: string, sub: string): string {
    return `<button data-id="${id}" style="${PANEL}position:static;border-color:${color};cursor:pointer;min-width:170px;text-align:left">
      <div style="color:${color};font-weight:bold">${title}</div><div style="opacity:.7;font-size:11px">${sub}</div></button>`
  }

  update(d: Director, events: SimEvent[]) {
    const h = d.sim.harmony().toFixed(0)
    this.top.innerHTML =
      `<span style="color:#ffd75e">◉ DYSON SPHERE ${d.sphereProgress().toFixed(1)}%</span>` +
      `<span style="color:#7fb3ff">⏱ TEMPORAL COMPRESSORATOR ×80,000</span>` +
      `<span style="color:${+h > 80 ? '#4a9d6f' : +h > 55 ? '#e0b34e' : '#e05e5e'}">HARMONY ${h}%</span>` +
      `<span style="color:#57c8ff">CARGO ${d.cargo.toFixed(3)}</span>`

    const t = d.currentTarget()
    if (t && t !== 'fab') {
      const body = d.sim.bodies.find(b => b.name === t)!
      const spent = ((1 - body.mass / body.m0) * 100).toFixed(1)
      this.inspector.style.display = 'block'
      this.inspector.innerHTML = `<div style="color:#57c8ff">TARGET: ${t.toUpperCase()}</div>
        <div style="opacity:.7">mass extracted: ${spent}%</div>
        <div style="opacity:.7">stability: ${d.sim.tracker.heldScore(t).toFixed(0)}</div>
        ${d.state === 'orrery' ? `<button data-id="launch" style="margin-top:8px;cursor:pointer">▸ PLOT COURSE &amp; LAUNCH</button>` : ''}
        ${d.state === 'orrery' && d.cargo > 0 ? `<button data-id="to-fab" style="margin-top:4px;cursor:pointer">▸ DELIVER TO FAB</button>` : ''}`
    } else this.inspector.style.display = t ? 'block' : 'none'

    if (d.state === 'transit') {
      this.cards.innerHTML = this.card('burn', '#57c8ff', '🔥 SLINGSHOT BURN', `arrive sooner · transit ${d.transitRemaining().toFixed(0)}s`)
    } else if (d.state === 'mining') {
      this.cards.innerHTML =
        this.card('strip', '#e0b34e', '⛏ STRIP BLAST', '+fast · HIGH wobble · impulse ▲▲▲') +
        this.card('lattice', '#4a9d6f', '⛏ LATTICE BORE', '+slow · LOW wobble · impulse ▲') +
        this.card('slag', '#57c8ff', '↩ RETURN SLAG', 'give cargo back · heal orbit') +
        this.card('to-fab', '#dceaff', '🚀 DEPART TO FAB', 'deliver cargo')
    } else if (d.state === 'constructing') {
      this.cards.innerHTML =
        `<div style="color:#e05e5e;font-size:15px;align-self:center">DECISION ${Math.max(0, d.decisionRemaining()).toFixed(1)}s</div>` +
        this.card('place-suggested', '#4a9d6f', '⬡ COUNTERWEIGHT PLACEMENT', 'stabilizes worst orbit') +
        this.card('place-hasty', '#e0b34e', '⬡ HASTY PLACEMENT', 'instant · no rebalance value')
    } else this.cards.innerHTML = ''

    for (const ev of events) {
      if (ev.type === 'band' && (ev.to === 'amber' || ev.to === 'red' || ev.to === 'critical'))
        this.alertLines.unshift(`⚠ ${ev.body.toUpperCase()} → ${ev.to.toUpperCase()}`)
      if (ev.type === 'catastrophe')
        this.alertLines.unshift(`☄ CATASTROPHE: ${ev.body.toUpperCase()} ${ev.kind.toUpperCase()}`)
    }
    this.alertLines = this.alertLines.slice(0, 5)
    this.alerts.style.display = this.alertLines.length ? 'block' : 'none'
    this.alerts.innerHTML = this.alertLines.join('<br>')

    if (d.state === 'won' || d.state === 'lost') {
      this.endScreen.style.display = 'block'
      this.endScreen.innerHTML = d.state === 'won'
        ? `<div style="color:#ffd75e">☀ SPHERE COMPLETE</div><div style="font-size:13px;opacity:.8">The system hums in balance. Reload to play again.</div>`
        : `<div style="color:#e05e5e">☄ SYSTEM LOST</div><div style="font-size:13px;opacity:.8">Gravity always collects. Reload to try again.</div>`
    }
  }

  bindClicks() {
    document.getElementById('hud')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-id]') as HTMLElement | null
      if (btn) this.onChoice(btn.dataset.id!)
    })
  }
}
```

- [ ] **Step 2: Wire choices in main.ts**

```ts
// in main.ts after constructing hud:
const hud = new Hud(document.getElementById('hud')!)
hud.bindClicks()
hud.onChoice = (id) => {
  if (id === 'launch') director.launch()
  else if (id === 'burn') director.burn()
  else if (id === 'strip') director.chooseExtraction('strip')
  else if (id === 'lattice') director.chooseExtraction('lattice')
  else if (id === 'slag') director.dumpSlag()
  else if (id === 'to-fab') { director.selectTarget('fab'); director.launch() }
  else if (id === 'place-suggested') director.placeSegment('suggested')
  else if (id === 'place-hasty') director.placeSegment('hasty')
}
// in the frame loop, after director.advance(dt):
const events = director.drainEvents()
hud.update(director, events)
bridgeFrame.setAlarm(events.some(e => e.type === 'band' && (e.to === 'red' || e.to === 'critical')))
```

Also add to `Director` (from the Task 13 note, if not already done):

```ts
currentTarget(): string | null { return this.target }
```

Remove the temporary `window.director` exposure from Task 13.

- [ ] **Step 3: Visual verification — play a full loop**

Preview. Click Europa → PLOT COURSE & LAUNCH → watch transit, optionally SLINGSHOT BURN → camera dives to bridge → choose LATTICE BORE, watch cargo climb → DEPART TO FAB → construction decision under the countdown → COUNTERWEIGHT PLACEMENT → sphere % increases, back to orrery. Then deliberately strip-blast the Moon hard and confirm: amber alert appears, trail turns amber, then red + pulsing + bridge edge-glow.

- [ ] **Step 4: Full suite + commit**

```bash
npm run test
git add -A
git commit -m "feat(ui): holographic HUD with choice cards, alerts, end screens"
```

---

### Task 15: Audio + Haptics

**Files:**
- Create: `src/audio/audio.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement synthesized audio** (no asset files — oscillators only) and gamepad haptics.

```ts
// src/audio/audio.ts
import type { SimEvent } from '../sim/sim'

export class GameAudio {
  private ctx: AudioContext | null = null

  // Browsers require a user gesture before audio; call from the first click.
  unlock() { if (!this.ctx) this.ctx = new AudioContext() }

  private tone(freq: number, dur: number, type: OscillatorType, gainPeak: number) {
    if (!this.ctx) return
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
    o.type = type; o.frequency.value = freq
    g.gain.setValueAtTime(0, this.ctx.currentTime)
    g.gain.linearRampToValueAtTime(gainPeak, this.ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur)
    o.connect(g).connect(this.ctx.destination)
    o.start(); o.stop(this.ctx.currentTime + dur)
  }

  compressoratorChime() { this.tone(520, 0.5, 'sine', 0.15); setTimeout(() => this.tone(780, 0.7, 'sine', 0.12), 180) }
  amberChime() { this.tone(660, 0.4, 'sine', 0.12) }
  klaxon() { this.tone(310, 0.35, 'sawtooth', 0.18); setTimeout(() => this.tone(250, 0.4, 'sawtooth', 0.18), 380) }
  catastrophe() { this.tone(120, 2.0, 'sawtooth', 0.25); this.tone(90, 2.4, 'triangle', 0.2) }

  private haptic(ms: number, strong: number) {
    const pad = navigator.getGamepads?.()[0] as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => void } }) | null
    pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong * 0.6 })
  }

  react(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'band' && e.to === 'amber') this.amberChime()
      if (e.type === 'band' && (e.to === 'red' || e.to === 'critical')) { this.klaxon(); this.haptic(400, 0.8) }
      if (e.type === 'catastrophe') { this.catastrophe(); this.haptic(1200, 1.0) }
    }
  }
}
```

- [ ] **Step 2: Wire into main.ts** — construct `GameAudio`; call `audio.unlock()` inside the existing click listener (first line); call `audio.compressoratorChime()` once after unlock on run start; call `audio.react(events)` in the frame loop next to `hud.update`.

- [ ] **Step 3: Verification**

Preview: first click anywhere unlocks audio and plays the Compressorator chime. Strip-blast the Moon to force alarms: amber chime on amber, two-tone klaxon on red. With a gamepad connected, red pulses rumble.

- [ ] **Step 4: Full suite + commit**

```bash
npm run test
git add -A
git commit -m "feat(audio): synthesized chimes/klaxons + gamepad haptics"
```

---

### Task 16: Edge Handling, Performance, Deploy

**Files:**
- Modify: `src/main.ts`, `src/render/sky.ts` usage
- Create: `README.md`

- [ ] **Step 1: Performance autoscale**

In `main.ts`, track a rolling average frame time; if it exceeds 22ms (≈45fps) for 5 consecutive seconds, rebuild the sky at the next lower quality tier (`new Sky(2)` then `new Sky(1)`, replacing `sky.group` in the scene) and disable the bloom pass at tier 1:

```ts
// in main.ts
let frameAvg = 16, skyQuality: 1 | 2 | 3 = 3, slowSince = 0
// inside loop, after render:
frameAvg = frameAvg * 0.95 + (performance.now() - t) * 0.05
if (frameAvg > 22 && skyQuality > 1) {
  if (!slowSince) slowSince = t
  if (t - slowSince > 5000) {
    skyQuality = (skyQuality - 1) as 1 | 2
    r.scene.remove(sky.group)
    sky = new Sky(skyQuality)
    r.scene.add(sky.group)
    slowSince = 0
  }
} else slowSince = 0
```

(Change `const sky` to `let sky`.)

- [ ] **Step 2: Verify WebGL fallback and tab-pause**

Already implemented (Task 11 fallback message, Task 12 `document.hidden` guard). Verify both: block WebGL via devtools (or temporarily force `webglAvailable()` false) → friendly message. Switch tabs for 30s → return; no time passed in sim (harmony/positions unchanged).

- [ ] **Step 3: Write README with attribution + deploy instructions**

```markdown
# Celestial Counterweight

Mine the solar system to build a Dyson sphere — without throwing the planets
out of balance. A one-sitting browser game. Gravity is the constant; mass is
the variable.

## Develop
npm install
npm run dev       # local dev server
npm run test      # physics + scenario suite

## Deploy
npm run build     # outputs dist/
Deploy `dist/` to any static host (Cloudflare Pages: create project → direct
upload → drag the dist folder; or connect the GitHub repo with build command
`npm run build`, output `dist`).

## Credits
Planet textures: Solar System Scope (CC BY 4.0) — solarsystemscope.com/textures
```

- [ ] **Step 4: Final verification**

Run: `npm run test` — Expected: entire suite green.
Run: `npm run build && npm run preview` — play one full run start-to-finish in the production build: win once (efficient play), lose once (greedy play). Confirm both end screens.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: performance autoscale, README, deploy readiness"
```

---

## Post-Plan Notes for the Executor

- **Tuning discipline:** every gameplay-feel constant lives in `src/constants.ts` and is guarded by a test. If a number feels wrong during play, change the constant and re-run `npm run test` — the scenario suite is the referee, not vibes.
- **Determinism:** `buildSystem()` must stay deterministic (no `Math.random()` — Task 4 note). If run-to-run variety is wanted later, thread a seeded RNG through the data layer as a v2 item.
- **Do not** add features not in the spec (saves, mobile, difficulty modes). YAGNI — they're listed as v2 in the spec §10.
