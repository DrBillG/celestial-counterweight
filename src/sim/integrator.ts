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
