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
import { DT, RUN_DURATION, DEV_GAIN, ENV_MARGIN, BAND_AMBER, BAND_RED, BAND_CRITICAL } from '../constants'

export type Band = 'green' | 'amber' | 'red' | 'critical'

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
  const dev = deviationOf(body, bodies)
  const env = envelope[body.name] ?? 0
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
  return wtotal === 0 ? 100 : wsum / wtotal
}

// Tracks a "held" score per body across sim steps: instant worsening,
// slow recovery (+0.002/step cap) — prevents band flapping as oscillating
// orbits swing back through nominal. Emits a BandEvent only on the steps
// where the held band actually crosses.
export class StabilityTracker {
  private envelope: Record<string, number>
  private held = new Map<string, number>()
  private bands = new Map<string, Band>()

  constructor(bodies: Body[], envelope: Record<string, number>) {
    this.envelope = envelope
    for (const b of bodies) {
      if (!tracked(b)) continue
      const score = scoreOf(b, bodies, envelope)
      this.held.set(b.name, score)
      this.bands.set(b.name, bandOf(score))
    }
  }

  update(bodies: Body[]): BandEvent[] {
    const events: BandEvent[] = []
    for (const b of bodies) {
      const prevHeld = this.held.get(b.name)
      if (prevHeld === undefined) continue
      const raw = scoreOf(b, bodies, this.envelope)
      const heldScore = Math.min(raw, prevHeld + 0.002)
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

  heldScore(name: string): number {
    return this.held.get(name) ?? 100
  }

  heldBand(name: string): Band {
    return this.bands.get(name) ?? 'green'
  }
}
