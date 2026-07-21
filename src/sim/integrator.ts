import type { Body } from './body'
import { G, SOFTENING } from '../constants'
import { v, type Vec } from './vec'

// Pairwise Newtonian gravity. extraAccel lets sim.ts inject the runaway and
// station-keeping terms (Tasks 7/8) without the integrator knowing about them.
//
// Contract: the returned acceleration must depend only on position/game state
// (b.pos, other bodies, elapsed time, stability state, etc.) — NEVER on
// b.vel. Velocity-dependent forces are non-conservative and break the
// symplectic (KDK) guarantee: step() calls extra() once against pre-drift
// velocities (a1) and once against post-drift velocities (a2), so a
// velocity-dependent term would see two inconsistent velocity values within
// a single step, corrupting the leapfrog integration this game depends on.
export type ExtraAccel = (b: Body, i: number) => Vec

// Circular-orbit speed against the softened potential. Using the naive
// sqrt(G*M/r) at moon-scale radii bakes in an 8-18% phantom wobble.
export function circularSpeed(centralMass: number, r: number): number {
  return Math.sqrt((G * centralMass * r * r) / Math.pow(r * r + SOFTENING * SOFTENING, 1.5))
}

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
// NOTE: game code should use stepHierarchical() below; step() remains the
// flat N-body kernel (and layer-1 workhorse).
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

// Hierarchical two-layer step (KSP-style patched integration).
//
// WHY: with game-scaled masses (jupiter = 3/1000 of the sun) full N-body
// coupling is chaotically unstable on run timescales — solar tides eject
// moons and near-commensurate planet periods pump multi-% radial drift,
// which false-triggers the stability alarm (1% ambient band). So:
//
//   Layer 1 (heliocentric): star/planet/ship/fab integrate under pairwise
//   gravity among themselves only. Each planet temporarily carries the sum
//   of its moons' current masses (the moon system rides with the planet),
//   so momentum/attraction bookkeeping stays honest. Real masses are
//   restored before layer 2.
//
//   Layer 2 (per-parent moon frames): each moon's RELATIVE state
//   (pos/vel minus parent) is KDK-stepped under the parent's CURRENT mass
//   (mining a planet genuinely loosens its grip), pairwise gravity between
//   sibling moons (real masses), and `extra`. No solar terms — that is the
//   point. Absolute state is then recomposed from the parent's new state.
//
// `extra` keeps its position-only contract and is applied to every body:
// layer-1 bodies via step(), moons inside the layer-2 kernel (the moon's
// absolute pos is synced to parent-new + rel before each evaluation, and
// extra receives the body's index in the ORIGINAL bodies array).
export function stepHierarchical(bodies: Body[], dt: number, extra?: ExtraAccel): void {
  // Partition: heliocentric layer vs moons.
  const helio: Body[] = []
  const helioIdx: number[] = []
  const moons: Body[] = []
  const moonIdx: number[] = []
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].kind === 'moon') { moons.push(bodies[i]); moonIdx.push(i) }
    else { helio.push(bodies[i]); helioIdx.push(i) }
  }

  // Capture moon states relative to their parents BEFORE the parents move.
  const nm = moons.length
  const parentOf: Body[] = new Array(nm)
  const relX = new Array<number>(nm), relY = new Array<number>(nm)
  const relVX = new Array<number>(nm), relVY = new Array<number>(nm)
  for (let k = 0; k < nm; k++) {
    const m = moons[k]
    let p: Body | undefined
    for (const h of helio) if (h.name === m.parentName) { p = h; break }
    if (!p) throw new Error(`moon ${m.name} has no heliocentric parent ${m.parentName}`)
    parentOf[k] = p
    relX[k] = m.pos.x - p.pos.x; relY[k] = m.pos.y - p.pos.y
    relVX[k] = m.vel.x - p.vel.x; relVY[k] = m.vel.y - p.vel.y
  }

  // Layer 1: planets carry their moon systems' mass. Restore after.
  const realMass = helio.map(b => b.mass)
  for (let k = 0; k < nm; k++) parentOf[k].mass += moons[k].mass
  const extraHelio = extra ? (b: Body, i: number) => extra(b, helioIdx[i]) : undefined
  step(helio, dt, extraHelio)
  for (let i = 0; i < helio.length; i++) helio[i].mass = realMass[i]

  // Layer 2: per-parent relative KDK for the moons.
  // Relative acceleration on moon k: central (parent's current mass) +
  // sibling moons (same parent, real masses) + extra. Same softening.
  const ax = new Array<number>(nm), ay = new Array<number>(nm)
  const s2 = SOFTENING * SOFTENING
  const computeRelAccels = () => {
    for (let k = 0; k < nm; k++) {
      const p = parentOf[k]
      const d2 = relX[k] * relX[k] + relY[k] * relY[k] + s2
      const f = -G * p.mass / (d2 * Math.sqrt(d2))
      ax[k] = f * relX[k]; ay[k] = f * relY[k]
    }
    for (let k = 0; k < nm; k++) {
      for (let j = k + 1; j < nm; j++) {
        if (parentOf[k] !== parentOf[j]) continue // siblings only
        const dx = relX[j] - relX[k], dy = relY[j] - relY[k]
        const d2 = dx * dx + dy * dy + s2
        const f = G / (d2 * Math.sqrt(d2))
        ax[k] += f * moons[j].mass * dx; ay[k] += f * moons[j].mass * dy
        ax[j] -= f * moons[k].mass * dx; ay[j] -= f * moons[k].mass * dy
      }
    }
    if (extra) {
      for (let k = 0; k < nm; k++) {
        const m = moons[k], p = parentOf[k]
        // Sync absolute position so a position-only extra sees where the
        // moon actually is (parent already at its new position).
        m.pos.x = p.pos.x + relX[k]; m.pos.y = p.pos.y + relY[k]
        const e = extra(m, moonIdx[k])
        ax[k] += e.x; ay[k] += e.y
      }
    }
  }

  computeRelAccels()
  for (let k = 0; k < nm; k++) {
    relVX[k] += ax[k] * dt / 2; relVY[k] += ay[k] * dt / 2
    relX[k] += relVX[k] * dt;   relY[k] += relVY[k] * dt
  }
  computeRelAccels()
  for (let k = 0; k < nm; k++) {
    relVX[k] += ax[k] * dt / 2; relVY[k] += ay[k] * dt / 2
    const m = moons[k], p = parentOf[k]
    m.pos.x = p.pos.x + relX[k]; m.pos.y = p.pos.y + relY[k]
    m.vel.x = p.vel.x + relVX[k]; m.vel.y = p.vel.y + relVY[k]
  }
}
