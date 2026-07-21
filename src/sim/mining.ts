import type { Body } from './body'
import { EJECTA_SPEED, ASYM } from '../constants'
import { norm, scale, sub, type Vec } from './vec'

export type Method = keyof typeof ASYM  // 'strip' | 'lattice'

export interface ExtractResult { cargo: number; ejectaMomentum: Vec }

// Newton's third law is the core mechanic: extracted mass leaves as ejecta
// carrying momentum. Strip blast throws it one-sided (prograde), shoving the
// body; lattice bore is near-symmetric so impulses almost cancel.
// refVel: velocity of the body's orbital parent (or omit for heliocentric
// bodies) — ejecta is thrown prograde RELATIVE to the parent so a mined moon
// is shoved along its own orbit, which is what the player sees on screen.
export function extract(body: Body, method: Method, dm: number, refVel: Vec = { x: 0, y: 0 }): ExtractResult {
  dm = Math.min(dm, body.mass * 0.5) // never let a body vanish in one call
  const dir = norm(sub(body.vel, refVel))
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
