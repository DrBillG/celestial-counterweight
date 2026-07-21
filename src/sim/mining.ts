import type { Body } from './body'
import { G, EJECTA_SPEED, ASYM } from '../constants'
import { add, len, norm, scale, sub, v, type Vec } from './vec'

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

// Healing lever #1: give mass back (amendment 8 — honest inelastic
// accretion, not a free no-impulse mass bump). The delivered mass is
// accreted at the vis-viva velocity of the body's NOMINAL orbit evaluated
// at its CURRENT radius: that velocity is exactly circular-orbit speed at
// rNom, so momentum-weighted mixing pulls both semi-major axis toward rNom
// AND eccentricity toward 0 — this is what makes the HUD's "heal orbit"
// promise physically true (see AMENDMENTS LOG item 8).
export function returnSlag(body: Body, dm: number, parent: Body): void {
  dm = Math.max(0, dm)
  const rel = sub(body.pos, parent.pos)
  const r = len(rel)
  if (r === 0 || body.rNom === 0) { body.mass += dm; return }  // degenerate: plain mass return
  // vis-viva speed of the nominal-a orbit at current radius (arg clamped for blown-out orbits)
  const visViva2 = Math.max(G * parent.mass * (2 / r - 1 / body.rNom), 0.05 * G * parent.mass / r)
  const tangent = norm(v(-rel.y, rel.x))
  // pick the tangent direction matching current motion (don't reverse the orbit)
  const relVel = sub(body.vel, parent.vel)
  const dir = (tangent.x * relVel.x + tangent.y * relVel.y) >= 0 ? tangent : scale(tangent, -1)
  const vTarget = add(parent.vel, scale(dir, Math.sqrt(visViva2)))
  // momentum-weighted inelastic accretion
  body.vel = scale(add(scale(body.vel, body.mass), scale(vTarget, dm)), 1 / (body.mass + dm))
  body.mass += dm
}
