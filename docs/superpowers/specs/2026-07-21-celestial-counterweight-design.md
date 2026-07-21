# Celestial Counterweight — Game Design Spec

**Date:** July 21, 2026
**Owner:** Bill Giovannetti
**Status:** Approved design, pending implementation plan

---

## 1. Concept

A one-sitting browser game about dismantling the solar system without destroying it.

You command a mining/construction ship tasked with building a **Dyson sphere** around
the sun. The raw material comes from the solar system itself — the Moon, Mars, the
moons of Jupiter and Saturn. But every ton you extract changes the physics: **gravity
is the constant; mass becomes the variable.** Careless mining wobbles orbits. Enough
wobble cascades into catastrophe — moons ejected, planets colliding, bodies spiraling
into the sun.

The player must **intuit two truths through play**, never through tutorial text:

1. Mining celestial bodies throws the system out of balance.
2. Operating efficiently — surgical extraction, smart mass placement — restores it.

**Win:** Dyson sphere reaches 100% with the system stable.
**Lose:** a runaway instability cascade (spectacular, legible, and traceable to the
player's own choices).

## 2. Locked Decisions

| Decision | Choice |
|---|---|
| Genre | Space mining / physics-balance strategy (chosen from concept option C) |
| Platform | Desktop web browser, single link, no install. Keyboard + mouse; gamepad optional (enables haptics) |
| Session shape | One-sitting run, ~20–40 minutes, restartable. No saves in v1 |
| View system | Dual view with automatic cinematic transitions (see §4) |
| Travel | Hybrid: autopilot plots trajectories; player times burns and can steer mid-flight for gravity slingshots |
| Art direction | Realistic NASA-textured bodies + glowing holographic HUD ("The Expanse" feel) |
| Sky | Glorious: parallax 3-layer starfield (thousands of stars), Milky Way band, drifting nebulae (violet/teal/magenta/amber), distant galaxy, twinkle shader, diffraction flares on bright stars |
| Time | Real gravity math on compressed timescales via the diegetic **Temporal Compressorator** (activation chime + HUD badge at run start) |
| Tech | TypeScript + Three.js + Vite; custom orbital physics; static-site deployment |
| Title | **Celestial Counterweight** |

## 3. Core Gameplay Loop

1. **Launch.** Temporal Compressorator activates. Orrery shows sun, eight planets,
   key minable moons (Moon, Phobos, Io, Europa, Ganymede, Titan…), and the empty
   Dyson scaffold. Goal on screen: Sphere 0% → 100%.
2. **Choose a target.** Clicking a body reveals composition (Fe / Si / H₂O) and its
   **mass budget** — how much can be extracted before orbital degradation.
3. **Fly (hybrid autopilot).** Autopilot plots the curve; player times the burn and
   may steer mid-flight to capture slingshots (saves fuel/time — the skill expression).
4. **Mine (bridge view, auto-engaged).** Extraction choice:
   - **Strip Blast** — high yield/min, high impulse, big wobble.
   - **Lattice Bore** — low yield/min, symmetric extraction, minimal wobble.
   - **Return Slag** — give mass back to heal an over-mined body.
5. **Deliver & build (bridge view, timed).** At the fab, segment-placement choices
   appear inside a **decision window** (countdown). Placement location matters —
   everything built has mass.
6. **Rebalance.** Fabs and sphere segments act as **counterweights**: placed well,
   their gravity tugs wobbling orbits back toward nominal. HUD offers
   "suggest counterweight" placements; ignoring them is allowed and risky.
7. **Interrupts.** Alarms fire on stability-threshold crossings; the player triages:
   drop everything and fix, or gamble.

## 4. View System

**Orrery view (default, god's-eye 3D).** Tilted view of the whole system. Orbit
trails color-coded by stability (green/amber/red). The gold **Harmony Ring**
encircles the system and visibly fractures where instability grows. Top bar: sphere
%, Temporal Compressorator rate, run clock. Right panel: target inspector (composition,
mass budget, stability score, plot course, suggest counterweight). Alert stack
bottom-right. Scroll-zoom from full system down toward any body.

**Bridge view (auto-engaged on approach).** First-person from the ship's bridge —
the body fills the window, framed by hull. Console cards present mining or
construction choices; decision-window timer pinned top-center. Used at minable
bodies and at the Dyson fab.

**Transitions.** The camera *dives* from orrery into bridge on approach and pulls
back out on departure — continuous, cinematic, no cuts.

**Ambient balance cue.** Nebula tint shifts subtly warmer when the system is in
harmony, colder/redder as instability spreads — the sky is an ambient mood ring
reinforcing intuition without UI text.

## 5. Physics Design

> **Amendment (2026-07-21, implementation-verified):** the sim is a **hierarchical
> two-layer Newtonian simulation** (KSP-style), not a single fully-coupled N-body.
> A heliocentric layer integrates sun/planets/ship/fabs (planets carry their moons'
> masses); each moon system integrates in its parent's frame under the parent's
> *current* mass plus sibling gravity. Reason: at game-scaled masses, full coupling
> is chaotically unstable on run timescales (measured moon ejections at >0.4 Hill
> radii; mean-motion-resonance pumping of planet orbits). All player-facing physics
> promises survive: mining impulses shove moons, a lightened parent loosens its
> grip, counterweights act via the assist force. The roster is resonance-detuned
> and verified quiet (running-max deviation < 2% for every body over a full run,
> enforced by test). Stability scoring (§below) is calibrated per-body against the
> deterministic pristine baseline envelope, scoring only *exceedance*.

One Newtonian simulation architecture (two layers, as amended above) covers sun,
planets, moons, ship, fabs, and sphere segments. Fixed-timestep symplectic
integrator (stable long-horizon orbits). The Temporal Compressorator scales
sim-time so consequences unfold in minutes.

**Mining pushes (the core mechanic).** Extracted material leaves the body as ejecta
carrying momentum; net unbalanced ejecta = real impulse on the body.

- Strip Blast: one-sided ejecta → large net impulse → visible orbit deformation.
- Lattice Bore: symmetric extraction → impulses cancel → near-zero drift.

The player feels Newton's third law without being lectured.

**Mass-loss coupling.** Lighter bodies grip their satellites more weakly — over-mine
Jupiter and the Galilean moons drift off their leashes.

**Stability model.** Each body carries a **stability score** (0–100): deviation of
current orbital elements from run-start nominal. Bands: green → amber → red →
**critical**. Past critical, deviation growth is amplified (designed runaway) —
this produces the dramatic, legible cascade. System-wide **Harmony Index** =
weighted aggregate, rendered as the Harmony Ring.

**Rebalancing.** Two honest physical levers: counterweight placement (fabs/segments
are real masses in the sim) and slag return (restores mass to a body). Both are
computed by the same gravity code as everything else — no special-case "healing"
logic.

## 6. Alarms & Feedback

Alarms fire **only on threshold crossings** (never continuous — avoids alarm fatigue).

| Tier | Trigger | Feedback |
|---|---|---|
| Amber drift | stability crosses amber | soft chime; trail turns amber; alert added to stack |
| Red wobble | stability crosses red | klaxon; pulsing red trail; screen-edge red glow in bridge view; gamepad haptic pulse |
| Critical runaway | stability crosses critical | continuous alarm; one-click camera jump to failing body; Harmony Ring visibly cracks |

Haptics via the Gamepad vibration API where hardware supports it; silently absent
otherwise.

## 7. Architecture

Single-page static web app. TypeScript, Three.js, Vite. No backend, no accounts,
no database. Deployable to any static host (Cloudflare Pages / Netlify) as one link.

| Module | Responsibility | Depends on |
|---|---|---|
| `sim/` | Pure physics: bodies, gravity, integrator, mining impulses, stability scores, Harmony Index. **Zero rendering imports — runs headless.** | nothing |
| `render/` | Three.js scenes: sky (parallax starfield, nebulae, twinkle, bloom), orrery scene, bridge scene, camera director (dive transitions) | sim (read-only) |
| `game/` | Run state machine: travel, mining, construction, decision windows, alarms, win/lose; owns the Temporal Compressorator | sim |
| `ui/` | HTML/CSS HUD overlays: top bar, target inspector, choice cards, alert stack | game events |
| `audio/` | WebAudio score, klaxons, chimes; gamepad haptics | game events |

**Data flow (one-way):** `sim` ticks → `game` reads state, emits events
("Jupiter crossed amber") → `render` / `ui` / `audio` react. Nothing writes
backward into the physics.

## 8. Error & Edge Handling

- **No WebGL:** friendly full-screen message, no crash.
- **Weak GPU:** auto-degrade (thin the starfield, reduce bloom) to hold frame rate.
- **Tab hidden:** sim pauses (`visibilitychange`); no off-screen catastrophes.
- **Reproducibility:** every run has a seed; bugs and balance complaints replay deterministically.
- **No gamepad:** haptics silently skipped.

## 9. Testing Strategy

The headless `sim/` module is exercised by an automated scenario suite that plays
runs thousands of times faster than real time. The design's central promise —
*the game must make sense* — is enforced by tests, not vibes:

1. **Null test:** an untouched solar system stays green for a full run's duration
   (bounded integrator drift; no phantom wobble).
2. **Conservation:** momentum accounting on every mining impulse checks out.
3. **Greedy player loses:** a scripted strip-blast-everything bot reaches cascade
   failure before sphere completion.
4. **Efficient player wins:** a scripted surgical-mining + counterweight bot
   completes the sphere with the system stable.
5. **Monotonic causality:** more dirty mining ⇒ never-better stability. The
   cause-effect players must intuit is provably monotonic.
6. **Rebalance efficacy:** a well-placed counterweight measurably reduces drift.

Difficulty tuning = adjusting constants until the suite says the run is winnable,
losable, and honest. Rendering is verified visually via browser preview and
screenshots during development.

## 10. Out of Scope for v1

- Mobile/touch layout
- Save/load, campaigns, meta-progression between runs (session shape option C — a
  natural v2)
- Multiplayer or leaderboards
- Multiple star systems, difficulty modes, accessibility remapping (v2 candidates)

## 11. Open Items (deliberately deferred to implementation planning)

- Exact roster of minable bodies and their mass budgets (tuned by scenario suite)
- Run-duration pacing constants (Temporal Compressorator rate, decision-window lengths)
- Audio sourcing (generated vs. licensed ambient score)
