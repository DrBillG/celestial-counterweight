// src/sim/data.ts
import { makeBody, type Body, type Kind } from './body'
import { circularSpeed } from './integrator'
import { v, add } from './vec'
import { SUN_MASS } from '../constants'

interface Spec {
  name: string; kind: Kind; parent: string | null
  r: number      // orbit radius around parent (game units)
  mass: number
  radius: number // visual/collision radius
  minable?: boolean
  phase: number  // starting angle (radians) — EXPLICIT for every body: determinism is a hard requirement
}

// Game-scaled roster for the hierarchical two-layer sim (see integrator.ts).
// This is a TRUE equilibrium: the null test asserts the RUNNING MAX radial
// deviation of every body stays inside the band for the whole run, not just
// at the endpoint.
//
// How it was reached (order matters — each lever fixes what the previous
// cannot):
// 1. Masses were reduced (planets are not minable except mars, so this is
//    gameplay-neutral): heavy planets at 3/1000 of the sun pump multi-%
//    mutual forcing regardless of geometry.
// 2. Radii/PERIODS detune resonances — phases cannot; a mean-motion
//    resonance is set by the period ratio alone, so only radii move it.
//    Radii below come from a deterministic resonance-clearance search
//    verified by full running-max sims. Resonance ORDER is |p − q|:
//    first-order p:(p−1) resonances are the strong ones for close pairs
//    (an earlier draft ranked by integer size and let a 9:8 through at
//    0.3% clearance — uranus/neptune pumped to 10% soon after the run).
//    Actual clearances (nearest FIRST-ORDER resonance unless noted):
//      venus:mercury  (52/38)^1.5  = 1.601  (3:2 +6.7%)
//      earth:venus    (75/52)^1.5  = 1.732  (2:1 −13.4%; 5:3 +3.9% o2)
//      mars:earth     (104/75)^1.5 = 1.633  (3:2 +8.8%; 5:3 −2.1% o2)
//      jupiter:mars   (175/104)^1.5= 2.183  (2:1 +9.1%; 9:4 −3.0% o5)
//      saturn:jupiter (255/175)^1.5= 1.759  (2:1 −12.1%; 7:4 +0.5% o3)
//      uranus:saturn  (292/255)^1.5= 1.225  (5:4 −2.0%, 6:5 +2.1%)
//      neptune:uranus (344/292)^1.5= 1.279  (4:3 −4.1%, 5:4 +2.3%)
//      neptune:saturn (344/255)^1.5= 1.567  (3:2 +4.5%; 8:5 −2.1% o3)
//    The outer chain CANNOT clear every first-order resonance by >= 5%:
//    two such gaps need a period-ratio span of 1.414^2 ~ 2.0 and the
//    allowed radius ranges cap the saturn->neptune span at ~1.76. The
//    uranus:saturn and neptune:uranus pairs (the two lightest) therefore
//    sit at the local mid-gap maxima (~2%); heavy pairs are >= 4.5% clear.
// 3. Phases only choose WHERE in the free/forced beat each body starts
//    (legitimate sampling; they cannot change forcing amplitude). Offender-
//    only nudges vs the searched base: mercury −0.4, mars +0.8, saturn
//    +0.4, neptune +0.2 — folded into the literals below.
// 4. Jupiter's moon trio: io/europa/ganymede masses 0.0005 — sibling-moon
//    forcing scales with m_sibling/m_parent, so halving jupiter (3.0→1.5)
//    doubled the trio's mutual pumping; 0.0005 restores running-max < 1%.
//    Their radii 8/12/20.5 keep period ratios 1.84/2.23, clear of 2:1 and
//    3:2 (the plan's r=16 sat exactly on europa's 3:2 and pumped 6-11%).
//
// Verified running-max deviations at 1x RUN_DURATION (90k steps): worst
// body saturn 1.98%; all others <= 1.90%; single moons ~0%; trio <= 0.88%.
// Hence the null test's fallback band of 2% (coordinator-approved; Task 6
// scores against per-body baseline envelopes recorded at Sim construction,
// not against this band).
//
// HORIZON SCOPE: the equilibrium is verified to 1x RUN_DURATION (band
// holds at every step) and probed to 2x. Over the extended 2x horizon all
// bodies stay inside the band EXCEPT neptune, which first crosses 2% at
// t ~= 1839 (2% past RUN_DURATION) and peaks at 3.4% by 2x — the residual
// secular pumping of the sub-5% first-order clearances above. If
// RUN_DURATION is ever raised, re-run the extended null probe and expect
// to re-detune the outer chain.
const SPECS: Spec[] = [
  { name: 'sun',     kind: 'star',   parent: null,      r: 0,    mass: SUN_MASS, radius: 10, phase: 0 },
  { name: 'mercury', kind: 'planet', parent: 'sun',     r: 38,   mass: 0.03, radius: 1.2, phase: 5.159330687797544 },
  { name: 'venus',   kind: 'planet', parent: 'sun',     r: 52,   mass: 0.4,  radius: 1.9, phase: 3.7743402939809916 },
  // MOON PLAYABILITY (post-launch rework). The Moon used to orbit OUTSIDE
  // earth's Hill sphere ("barely bound"), so no counterweight could hold it and
  // mining it was a silent death. Three changes make it behave like every other
  // moon: earth mass 0.5→1.0 (a bigger Hill sphere, ≈5.2, with room for both the
  // moon AND a counterweight outside it), earth collision radius 2.0→1.2 (radius
  // affects only collision + rendering, never gravity), and moon r 6→3.2
  // (Hill ratio ≈0.62, collision margin ≈40%). The heavier earth is verified
  // against the null test; a moon's orbit radius never touches the heliocentric
  // layer (the planet carries the moon's mass regardless).
  { name: 'earth',   kind: 'planet', parent: 'sun',     r: 75,   mass: 1.0,  radius: 1.2, phase: 3.7825118158053623 },
  { name: 'moon',    kind: 'moon',   parent: 'earth',   r: 3.2,  mass: 0.012, radius: 0.7, minable: true, phase: 1.0 },
  // Mars is a moonless planet now. It used to be minable (a "poison trap": the
  // big planet fatally destabilized its unrescuable moon Phobos) — exactly the
  // hidden gotcha we're removing. And Mars is too light (0.11 → tiny Hill
  // sphere ≈3.4) to host a counterweight-rescuable moon, so Phobos is dropped
  // rather than left as a broken target. Planets aren't mined; moons are.
  { name: 'mars',    kind: 'planet', parent: 'sun',     r: 104,  mass: 0.11, radius: 1.5, phase: 5.6007703765883 },
  // Jupiter gets ONE solo moon (europa), replacing the old tiny 3-moon trio
  // (io/europa/ganymede at 0.0005). A single moon can carry a proper mining
  // mass (0.018) without a sibling to mutually perturb it — TWO moons at that
  // mass broke the null test; the original trio only held together because the
  // moons were near-massless. Solo europa r=10 (inside jupiter's Hill≈13.9,
  // ratio 0.72) is a clean counterweight target like titan/oberon/triton;
  // jupiter's collision radius is 4.6 so europa keeps a ~46% collision margin
  // (at r=8 with radius 5.5 the margin was only 21% and mining killed it). Mass
  // STOLEN from jupiter (1.5 → 1.4835 + 0.018 = 1.5015 carried, unchanged) so
  // the heliocentric null-test chain is untouched.
  { name: 'jupiter', kind: 'planet', parent: 'sun',     r: 175,  mass: 1.4835, radius: 4.6, phase: 0.7729674691607054 },
  { name: 'europa',  kind: 'moon',   parent: 'jupiter', r: 10,   mass: 0.018, radius: 0.8, minable: true, phase: 2.9 },
  { name: 'saturn',  kind: 'planet', parent: 'sun',     r: 255,  mass: 1.0,  radius: 4.8, phase: 2.0169372158879835 },
  { name: 'titan',   kind: 'moon',   parent: 'saturn',  r: 13,   mass: 0.023, radius: 0.9, minable: true, phase: 1.7 },
  // Uranus/Neptune each gain ONE solo, well-bound moon — Titan-class clean
  // mining targets (r well inside the planet's Hill sphere, no sibling → no
  // mean-motion resonance). Their mass is STOLEN from the planet (uranus
  // 0.45 = 0.432 + oberon 0.018; neptune 0.5 = 0.482 + triton 0.018) so the
  // HELIOCENTRIC carried mass (planet + its moons, layer 1) is UNCHANGED and
  // the null-test resonance chain sees no difference. Added post-launch to give
  // more than one rescuable target (see the diagnosis: Titan was the only one).
  { name: 'uranus',  kind: 'planet', parent: 'sun',     r: 292,  mass: 0.432, radius: 3.2, phase: 1.1342241661813397 },
  { name: 'oberon',  kind: 'moon',   parent: 'uranus',  r: 8,    mass: 0.018, radius: 0.8, minable: true, phase: 3.3 },
  { name: 'neptune', kind: 'planet', parent: 'sun',     r: 344,  mass: 0.482, radius: 3.1, phase: 0.5877357689177376 },
  { name: 'triton',  kind: 'moon',   parent: 'neptune', r: 10,   mass: 0.018, radius: 0.8, minable: true, phase: 4.1 },
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
    const pos = add(parent.pos, v(Math.cos(s.phase) * s.r, Math.sin(s.phase) * s.r))
    // Planets orbit the sun's bare mass; moons orbit the parent's current
    // mass — both against the softened potential (circularSpeed), which is
    // what the hierarchical integrator actually applies.
    const vCirc = circularSpeed(parent.mass, s.r)
    const vel = add(parent.vel, v(-Math.sin(s.phase) * vCirc, Math.cos(s.phase) * vCirc))
    bodies.push(makeBody({ name: s.name, kind: s.kind, mass: s.mass, pos, vel, radius: s.radius, parentName: s.parent, rNom: s.r, minable: s.minable }))
  }

  const earth = findBody(bodies, 'earth')!
  bodies.push(makeBody({ name: 'ship', kind: 'ship', mass: 1e-9, pos: add(earth.pos, v(4, 0)), vel: { ...earth.vel }, radius: 0.3, parentName: null, rNom: 0 }))

  // Zero the HELIOCENTRIC LAYER's total momentum by giving the sun the
  // compensating velocity: otherwise every planet's orbital momentum recoils
  // the sun off-origin and the accumulated linear drift beats against the
  // inner planets' orbits, blowing past the null test's band. In layer 1
  // of stepHierarchical a planet carries its moons' masses, so the layer's
  // momentum is sum over non-moon bodies of (mass + moons' mass) * vel.
  const sun = findBody(bodies, 'sun')!
  let px = 0, py = 0
  for (const b of bodies) {
    if (b === sun || b.kind === 'moon') continue
    let m = b.mass
    for (const c of bodies) if (c.kind === 'moon' && c.parentName === b.name) m += c.mass
    px += m * b.vel.x
    py += m * b.vel.y
  }
  sun.vel = v(-px / sun.mass, -py / sun.mass)

  return bodies
}
