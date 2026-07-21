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

// Game-scaled roster for the hierarchical two-layer sim (see integrator.ts:
// planets integrate heliocentrically; moons integrate in their parent's
// frame, so moon orbits carry no solar-tide constraint).
//
// Planet phases: base values came from a deterministic search under which
// all 8 planets stay <1% radial drift over a full run — the plan's original
// phases sat near low-order mean-motion resonances (mars:earth ~3:2,
// jupiter:uranus ~2:1) that pump multi-% drift. Under the hierarchical sim
// three planets needed small deterministic nudges on top of that base
// (jupiter +0.1, uranus +0.15, neptune +0.1 rad — already folded into the
// values below), after which every planet's final deviation is <=0.92%.
//
// Moon spacing: sibling moons are kept >= ~3.5 mutual Hill radii apart
// (r_mH = ((m1+m2)/(3*m_parent))^(1/3) * (a1+a2)/2) AND clear of low-order
// mean-motion resonances. The jupiter trio at r=8/12/16 originally put
// europa:ganymede on an exact 3:2 (period ratio (16/12)^1.5 = 1.54) whose
// resonant argument pumped 6-11% radial oscillation; ganymede was moved to
// r=20.5 (ratios 1.84 / 2.23, both >=8% off every low-order resonance) and
// the trio's masses set to 0.002 to weaken residual coupling. Result: all
// moons' null-run deviation stays well inside the 1% band.
const SPECS: Spec[] = [
  { name: 'sun',     kind: 'star',   parent: null,      r: 0,   mass: SUN_MASS, radius: 10, phase: 0 },
  { name: 'mercury', kind: 'planet', parent: 'sun',     r: 40,  mass: 0.06, radius: 1.2, phase: 5.559330687797544 },
  { name: 'venus',   kind: 'planet', parent: 'sun',     r: 60,  mass: 0.8,  radius: 1.9, phase: 3.7743402939809916 },
  { name: 'earth',   kind: 'planet', parent: 'sun',     r: 80,  mass: 1.0,  radius: 2.0, phase: 3.7825118158053623 },
  { name: 'moon',    kind: 'moon',   parent: 'earth',   r: 6,   mass: 0.012, radius: 0.7, minable: true, phase: 1.0 },
  { name: 'mars',    kind: 'planet', parent: 'sun',     r: 105, mass: 0.11, radius: 1.5, phase: 4.8007703765883, minable: true },
  { name: 'phobos',  kind: 'moon',   parent: 'mars',    r: 4,   mass: 0.004, radius: 0.4, minable: true, phase: 2.0 },
  { name: 'jupiter', kind: 'planet', parent: 'sun',     r: 180, mass: 3.0,  radius: 5.5, phase: 0.7729674691607054 },
  { name: 'io',      kind: 'moon',   parent: 'jupiter', r: 8,   mass: 0.002, radius: 0.7, minable: true, phase: 0.8 },
  { name: 'europa',  kind: 'moon',   parent: 'jupiter', r: 12,  mass: 0.002, radius: 0.7, minable: true, phase: 2.9 },
  { name: 'ganymede',kind: 'moon',   parent: 'jupiter', r: 20.5, mass: 0.002, radius: 0.9, minable: true, phase: 5.0 },
  { name: 'saturn',  kind: 'planet', parent: 'sun',     r: 240, mass: 2.0,  radius: 4.8, phase: 1.6169372158879833 },
  { name: 'titan',   kind: 'moon',   parent: 'saturn',  r: 13,  mass: 0.023, radius: 0.9, minable: true, phase: 1.7 },
  { name: 'uranus',  kind: 'planet', parent: 'sun',     r: 290, mass: 0.9,  radius: 3.2, phase: 1.1342241661813397 },
  { name: 'neptune', kind: 'planet', parent: 'sun',     r: 320, mass: 1.0,  radius: 3.1, phase: 0.38773576891773756 },
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
  // inner planets' orbits, blowing past the null test's 1% band. In layer 1
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
