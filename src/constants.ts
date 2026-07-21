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

// Mining (Task 5)
export const EJECTA_SPEED = 2.0
export const ASYM = { strip: 0.8, lattice: 0.05 } as const
export const RATE = { strip: 0.010, lattice: 0.003 } as const  // mass units per tu

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
export const ASSIST_K = 1500           // TUNE: per-unit-fab-mass gain scale (retuned for real ≤0.05 fab masses)
export const ASSIST_MAX = 0.15         // TUNE: saturation of the total PD gain K
export const ASSIST_RANGE = 40
export const SHIP_ASSIST = 0.02        // TUNE: direct gain contribution while the ship is stationed (setShipAssist)
export const DAMP_RATIO = 2.0          // TUNE: 2.0 ⇒ critically damped; >2 overdamped

// Dyson sphere (Task 11)
export const SPHERE_MASS_REQUIRED = 12 // TUNE: total delivered mass to win
