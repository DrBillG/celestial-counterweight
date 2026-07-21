import type { Body } from './body'
import { EJECTA_SPEED, ASYM } from '../constants'
import { norm, scale, sub, type Vec } from './vec'

export type Method = keyof typeof ASYM  // 'strip' | 'lattice'

export interface ExtractResult {
  cargo: number
  // Momentum in the body's PRE-KICK frame (dm * u, where u is the ejecta
  // unit direction and the magnitude is dm * EJECTA_SPEED * ASYM[method]).
  // This is NOT absolute-frame momentum — converting to the absolute frame
  // would require adding dm * v_body (the mass's own momentum before it left).
  ejectaMomentum: Vec
}

// Newton's third law is the core mechanic: extracted mass leaves as ejecta
// carrying momentum. Strip blast throws it one-sided (prograde), shoving the
// body; lattice bore is near-symmetric so impulses almost cancel.
// refVel is REQUIRED: for a moon, absolute velocity is parent-dominated, so
// a forgotten refVel would throw ejecta along the parent's orbit direction
// instead of the moon's own — silently wrong and phase-dependent. Callers
// must pass the parent's velocity explicitly, or {x:0,y:0} (or the sun's
// velocity) for heliocentric-frame bodies.
export function extract(body: Body, method: Method, dm: number, refVel: Vec): ExtractResult {
  dm = Math.max(0, Math.min(dm, body.mass * 0.5)) // never let a body vanish in one call; never go negative
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
  dm = Math.max(0, dm)
  body.mass += dm
}
