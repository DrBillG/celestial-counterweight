// Every tunable number lives here. Values marked TUNE are expected to be
// adjusted until the scenario suite (Task 10) says the game is winnable,
// losable, and honest.
export const G = 1
export const SUN_MASS = 1000
export const DT = 0.02                  // sim timestep (tu)
export const SOFTENING = 0.5           // gravity softening to avoid singularities
export const RUN_DURATION = 1800       // tu of sim time in one run (~30 min at rate 1)
// RUN_DURATION guard: the roster's equilibrium (src/sim/data.ts) is
// verified to hold the null-test band for 1x this value and probed to 2x
// (neptune first crosses the band at t ~= 1839; all other bodies hold to
// 2x). Re-run the extended null probe before raising this value.

// Stability (Task 6/7)
export const DEV_GAIN = 1200           // TUNE: deviation → score steepness
export const BAND_AMBER = 85
export const BAND_RED = 60
export const BAND_CRITICAL = 30
export const ENV_MARGIN = 0.01  // absolute slack over the pristine envelope; mining elsewhere shifts ambient forcing slightly
export const HELD_RECOVERY_PER_TU = 0.25  // TUNE: held-score recovery rate; genuine healing arrives with Task 8's re-circularization
export const RUNAWAY_ACCEL = 0.004     // TUNE: designed instability past critical
export const EJECT_RADIUS = 600        // beyond this from sun = ejected (lose event)

// Mining (Task 5; rates retuned in Task 9 per amendment 10 — the original
// strip 0.010/tu extracted ≈43% of titan's m0 per tu, ~100× the measured
// fatal single-dose threshold. These rates make mining gradual pressure
// instead of instant catastrophe; Task 10 finalizes per-body.)
export const EJECTA_SPEED = 2.0
export const ASYM = { strip: 0.8, lattice: 0.05 } as const
export const RATE = { strip: 0.0002, lattice: 0.00005 } as const  // TUNE: mass units per tu
export const RATE_SLAG = 0.0002        // TUNE: mass/tu returned to a body during slag mode
// Director-side husk guard (amendment 9): refuse to mine a body below this
// fraction of its m0 — exhausted husks become unbounded-Δv noisemakers.
export const EXTRACTION_FLOOR = 0.05   // TUNE

// Rebalance (Task 8, amendment 11: PD controller at REAL fab masses)
// The assist is a PD controller (see Sim.extraAccel). Per-body total gain
// K = Σ_fabs ASSIST_K·fabMass/d² + (SHIP_ASSIST if the ship is stationed).
// Kp = K; Kd = DAMP_RATIO·sqrt(Kp·rNom) (⇒ damping ratio ζ = DAMP_RATIO/2
// w.r.t. the controller stiffness — see the derivation in sim.ts).
// The raw fab sum saturates at ASSIST_MAX: without a cap the 1/d² gain
// spans a ~100× dynamic range over one fab–moon synodic cycle (measured
// fd 2→25 for a counterweight at titan), so no single ASSIST_K is both
// safe at conjunction (an uncapped gain there slams the moon into its
// parent within one epicycle) and authoritative at opposition (where the
// runaway otherwise outpulls the assist and wins). ASSIST_K is therefore
// set high for far-phase authority and ASSIST_MAX bounds the near phase.
// Task 10 raise 1500 -> 9000: the Task 8 rescue proof used deliberately
// heavy (0.03–0.05) fabs, but a REAL counterweight is built from ONE mine-
// to-amber's cargo (≈0.003 for titan) — 10–16× lighter. At ASSIST_K=1500 a
// cargo-sized counterweight was too weak to hold its body (titan decayed
// amber→critical over ~200 tu despite a live, in-range fab, measured by the
// scenario bots), so the amendment-13 winning cadence physically failed.
// 9000 lets a ≈0.003 fab pin titan back to green and hold it. This is a
// PD-control gain applied ONLY to the assisted body and gated by that body's
// own envelope, so it cannot perturb siblings; the Task 8 grid rescue,
// tick-partition, healing, and no-false-alarm proofs all stay green (near
// phase is unchanged — still ASSIST_MAX-capped; only far-phase authority on
// light fabs increased).
export const ASSIST_K = 9000           // TUNE: per-unit-fab-mass gain scale (retuned for real ≤0.05 fab masses)
export const ASSIST_MAX = 0.15         // TUNE: saturation of the total PD gain K
export const ASSIST_RANGE = 40
// Direct gain contribution while the ship is stationed (setShipAssist).
// TUNE window measured against the healing proof (2-tu snapshot cadence):
// ≥0.015 heals so fast the raw score reads 100 before the held band
// finishes recovering to green (ordering churn); ≤0.008 is too weak to
// pin deviation inside the envelope at all. 0.012 sits mid-window.
export const SHIP_ASSIST = 0.012       // TUNE
export const DAMP_RATIO = 2.0          // TUNE: 2.0 ⇒ critically damped; >2 overdamped
// PD sDot refresh cadence in ABSOLUTE sim time (substep-count based, so the
// trajectory is independent of how callers partition tick() calls). A sDot
// frozen for a whole large tick is a stale derivative at high gain —
// measured: tick(10)-frozen snapshots turned a clean rescue into an
// ejection (relDist 5021).
export const ASSIST_SNAPSHOT_TU = 2    // TUNE: keep ≤2; larger destabilizes big-tick callers

// Fab placement guards (coordinator review, Task 8 follow-up)
// Max fabMass/primary.mass when the placement binds to a planet. Measured
// on mars (mass 0.11): a 0.01 fab (ratio 0.09) false-ambers mars via real
// gravity; a 0.05 fab ejects it. Sun-bound placements skip this check
// (sun mass 1000 — any real fab is negligible).
export const FAB_MASS_RATIO_MAX = 0.05 // TUNE
// Min distance from any LIVE fab. Measured: two 0.05 fabs at ≤6 u mutually
// capture, collide, and doom the rescue.
export const FAB_MIN_SEPARATION = 8    // TUNE

// Dyson sphere win target. HONEST pool math (Task 9 quality review):
// nominal minable m0 pool ≈ 0.1505, BUT mars (0.1045 — 73% of the pool) is
// POISONED: mining it in any mode fatally destabilizes its moon phobos, and
// phobos is unrescuable (mars is a fab-exclusion zone, amendment 12a — no
// counterweight can hold it). Honestly-accessible pool = titan 0.0219 +
// moon 0.0114 + jupiter trio 0.0014 ≈ 0.035 usable AFTER the extraction
// floors. Of that, the jupiter trio (0.0014) proved to be its own mini-trap:
// the near-massless resonant moons husk-kick (amendment 9) into a jupiter
// collision when drained toward their floor, so the honestly-DELIVERABLE
// pool is titan + moon ≈ 0.033 held by counterweights.
//
// MEASURED (Task 10 scenario bots, tests/scenario.test.ts): the efficient
// mine-to-amber → counterweight bot DELIVERS ≥0.0149 and wins (it stops at
// the win, so the test proves a floor, not the ceiling). Raw headroom above
// the floors is titan 0.0219 + moon 0.0114 ≈ 0.033; sustained best play is
// estimated ≈0.021 deliverable before diminishing per-round mass and
// eventual body-loss cap it (ESTIMATE — not pinned by a committed test).
// Final win target = 0.012 sits below the proven-deliverable 0.0149, inside
// amendment-13a [0.010, 0.025], skilled-but-comfortable: the reference bot
// wins in ≈7 rounds with ~75% of the run to spare, while the greedy strip
// bot loses long before banking a third of it.
export const SPHERE_MASS_REQUIRED = 0.012 // TUNE: total delivered mass to win

// Director (Task 9)
export const SIM_RATE = 1              // TUNE: sim tu advanced per real-time unit passed to Director.advance
export const TRAVEL_SPEED = 25         // TUNE: ship transit speed (distance units per tu)
export const SLINGSHOT_BONUS = 0.35    // TUNE: one burn() per transit cuts the remaining time by this fraction
export const DECISION_WINDOW = 8       // TUNE: tu to decide at the construction site before auto-placement
