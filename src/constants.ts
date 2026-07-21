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

// Rebalance (Task 8)
export const ASSIST_K = 0.02           // TUNE: station-keeping strength per fab mass
export const ASSIST_RANGE = 40

// Dyson sphere (Task 11)
export const SPHERE_MASS_REQUIRED = 12 // TUNE: total delivered mass to win
