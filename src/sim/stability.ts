// Envelope-calibrated stability scoring (Task 6, see AMENDMENTS LOG item 4
// in docs/superpowers/plans/2026-07-21-celestial-counterweight.md).
//
// The pristine system has ambient forced oscillations (near-resonance
// beating) up to ~2% radial deviation — deterministic, not caused by the
// player. Raw thresholding on deviation alone false-alarms. Instead we
// record each body's own pristine deviation envelope once (a fresh
// deterministic null run) and score EXCEEDANCE beyond that envelope (plus
// a small absolute margin), so mining pressure elsewhere in the system
// nudging ambient forcing slightly never false-ambers an untouched body.
import type { Body } from './body'
import { dist } from './vec'
import { buildSystem } from './data'
import { stepHierarchical } from './integrator'
import { DT, RUN_DURATION, DEV_GAIN, ENV_MARGIN, BAND_AMBER, BAND_RED, BAND_CRITICAL, HELD_RECOVERY_PER_TU } from '../constants'

export type Band = 'green' | 'amber' | 'red' | 'critical'

// Fires on every step where a tracked body's held band changes. Under
// physical dynamics (one sim step's worth of deviation change) a large
// jump still emits one event per crossed band boundary, since held score
// only moves incrementally relative to the previous step. But this is NOT
// a structural guarantee — a caller that reseeds/mutates held state in a
// non-physical way (e.g. re-running track() at a very different score, or
// a future change that lets held score jump non-incrementally) can merge
// multiple boundary crossings into a single event. Consumers MUST key off
// `to` (treat `from -> to` as a span that may skip intermediate bands),
// not assume every band is visited via its own event.
export interface BandEvent {
  body: string
  from: Band
  to: Band
  score: number
}

function tracked(b: Body): boolean {
  return !!b.parentName && b.kind !== 'ship' && b.kind !== 'fab'
}

function findParent(body: Body, bodies: Body[]): Body | undefined {
  if (!body.parentName) return undefined
  return bodies.find(b => b.name === body.parentName)
}

// Scalar radial deviation from the body's nominal orbit around its parent.
// 0 for bodies with no parent (sun) or non-orbital kinds (ship/fab).
export function deviationOf(body: Body, bodies: Body[]): number {
  if (!tracked(body)) return 0
  const parent = findParent(body, bodies)
  if (!parent || body.rNom === 0) return 0
  return Math.abs(dist(body.pos, parent.pos) - body.rNom) / body.rNom
}

// Builds a fresh pristine system and steps it with stepHierarchical for
// RUN_DURATION at DT, recording each parented body's running-max scalar
// deviation. Computed, never hard-coded — deterministic and ~0.3s.
export function computeBaselineEnvelope(): Record<string, number> {
  const bodies = buildSystem()
  const envelope: Record<string, number> = {}
  for (const b of bodies) envelope[b.name] = 0

  const steps = Math.ceil(RUN_DURATION / DT)
  for (let i = 0; i < steps; i++) {
    stepHierarchical(bodies, DT)
    for (const b of bodies) {
      if (!tracked(b)) continue
      const dev = deviationOf(b, bodies)
      if (dev > envelope[b.name]) envelope[b.name] = dev
    }
  }
  return envelope
}

// score = 100 − DEV_GAIN · max(0, deviation − envelope[body] − ENV_MARGIN),
// clamped to [0, 100]. A body only loses points once its deviation exceeds
// its OWN pristine envelope plus a slack margin.
export function scoreOf(body: Body, bodies: Body[], envelope: Record<string, number>): number {
  if (!(body.name in envelope)) {
    throw new Error(`scoreOf: no baseline envelope entry for body '${body.name}' — wiring bug (missing computeBaselineEnvelope() entry, or a body added after the envelope was computed)`)
  }
  const dev = deviationOf(body, bodies)
  const env = envelope[body.name]
  const excess = Math.max(0, dev - env - ENV_MARGIN)
  const score = 100 - DEV_GAIN * excess
  return Math.max(0, Math.min(100, score))
}

export function bandOf(score: number): Band {
  if (score >= BAND_AMBER) return 'green'
  if (score >= BAND_RED) return 'amber'
  if (score >= BAND_CRITICAL) return 'red'
  return 'critical'
}

// m0-weighted mean score over parented non-ship/fab bodies.
export function harmony(bodies: Body[], envelope: Record<string, number>): number {
  let wsum = 0
  let wtotal = 0
  for (const b of bodies) {
    if (!tracked(b)) continue
    wsum += b.m0 * scoreOf(b, bodies, envelope)
    wtotal += b.m0
  }
  // Each scoreOf is clamped to [0,100], so the weighted mean is definitionally
  // in [0,100]; clamp the result to strip floating-point overshoot from the
  // Σ(m0·score)/Σ(m0) division (a pristine all-100 system can otherwise read
  // 100.00000000000001 for some m0 weightings).
  return wtotal === 0 ? 100 : Math.max(0, Math.min(100, wsum / wtotal))
}

// Tracks a "held" score per body across sim steps: instant worsening,
// slow recovery (capped at HELD_RECOVERY_PER_TU per tu) — prevents band
// flapping as oscillating orbits swing back through nominal. Emits a
// BandEvent only on the steps where the held band actually crosses.
export class StabilityTracker {
  private envelope: Record<string, number>
  private bodies: Body[]
  private held = new Map<string, number>()
  private bands = new Map<string, Band>()

  constructor(bodies: Body[], envelope: Record<string, number>) {
    this.envelope = envelope
    this.bodies = bodies
    for (const b of bodies) {
      if (!tracked(b)) continue
      const score = scoreOf(b, bodies, envelope)
      this.held.set(b.name, score)
      this.bands.set(b.name, bandOf(score))
    }
  }

  update(bodies: Body[]): BandEvent[] {
    this.bodies = bodies
    const events: BandEvent[] = []
    for (const b of bodies) {
      const prevHeld = this.held.get(b.name)
      if (prevHeld === undefined) continue
      const raw = scoreOf(b, bodies, this.envelope)
      const heldScore = Math.min(raw, prevHeld + HELD_RECOVERY_PER_TU * DT)
      const prevBand = this.bands.get(b.name)!
      const newBand = bandOf(heldScore)
      if (newBand !== prevBand) {
        events.push({ body: b.name, from: prevBand, to: newBand, score: heldScore })
      }
      this.held.set(b.name, heldScore)
      this.bands.set(b.name, newBand)
    }
    return events
  }

  // Registers a newly-added body (e.g. a fab spawned mid-run in Task 7)
  // by seeding ONLY that body's held score/band from its current raw
  // score — every other already-tracked body's held/band state is left
  // untouched. Task 7 MUST use this instead of constructing a fresh
  // StabilityTracker when the roster changes mid-run: a fresh tracker
  // reseeds EVERY body's held score from its CURRENT raw score, discarding
  // the accumulated instant-worsen/slow-recover history — probed: a body
  // whose held state is 'critical' (deep in a slow recovery) reads back as
  // 'amber' under a fresh tracker the instant its raw score happens to
  // have recovered, even though the real (held) alarm state is still
  // critical. No-op for non-orbital kinds (ship/fab) since those are never
  // score-tracked (see `tracked()`).
  track(body: Body): void {
    if (!tracked(body)) return
    const score = scoreOf(body, this.bodies, this.envelope)
    this.held.set(body.name, score)
    this.bands.set(body.name, bandOf(score))
  }

  heldScore(name: string): number {
    const v = this.held.get(name)
    if (v === undefined) throw new Error(`StabilityTracker.heldScore: '${name}' is not tracked (never constructed with it, nor track()ed)`)
    return v
  }

  heldBand(name: string): Band {
    const v = this.bands.get(name)
    if (v === undefined) throw new Error(`StabilityTracker.heldBand: '${name}' is not tracked (never constructed with it, nor track()ed)`)
    return v
  }
}
