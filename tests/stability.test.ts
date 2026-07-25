import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { stepHierarchical } from '../src/sim/integrator'
import { extract } from '../src/sim/mining'
import { StabilityTracker, scoreOf, harmony, computeBaselineEnvelope } from '../src/sim/stability'
import { DT, RUN_DURATION } from '../src/constants'

const envelope = computeBaselineEnvelope() // compute once for the whole file

function run(bodies: ReturnType<typeof buildSystem>, tu: number, tracker?: StabilityTracker) {
  const steps = Math.ceil(tu / DT)
  const events: ReturnType<StabilityTracker['update']> = []
  for (let i = 0; i < steps; i++) {
    stepHierarchical(bodies, DT)
    if (tracker) events.push(...tracker.update(bodies))
  }
  return events
}

describe('stability (envelope-based)', () => {
  it('pristine full run: every body holds score 100 and emits ZERO events', () => {
    const bodies = buildSystem()
    const tracker = new StabilityTracker(bodies, envelope)
    const events = run(bodies, RUN_DURATION, tracker)
    expect(events.length).toBe(0)
    for (const b of bodies) {
      if (!b.parentName || b.kind === 'ship') continue
      expect(scoreOf(b, bodies, envelope), b.name).toBe(100)
    }
  })

  it('monotonic causality: more strip mining never improves titan held score', () => {
    // Dose/window scaled down from the plan's raw 0.001-0.006 over 100 tu:
    // at that scale, ONE strip tick's ejecta kick (amendment 7 in the plan:
    // "one strip tick ~= 5-9% of a moon's orbital speed") crashes titan's
    // held score to the floor (0) for every nonzero dose well before t=100,
    // so all nonzero doses tie at 0 and the ordering degenerates into
    // recovery-time noise (whichever dose happened to hit floor earliest
    // has recovered the most by the read-out time) instead of showing
    // causality. Scaling doses down ~10x and reading out at t=40 (before
    // any dose saturates the floor) recovers a clean graded decline:
    // measured heldScore('titan') at t=40 for doses [0, 0.0001, 0.0003,
    // 0.0006] = [100, 91.41, 50.32, 0] (deterministic).
    const doses = [0, 0.0001, 0.0003, 0.0006]
    const scores = doses.map(dose => {
      const bodies = buildSystem()
      const titan = findBody(bodies, 'titan')!
      const saturn = findBody(bodies, 'saturn')!
      const tracker = new StabilityTracker(bodies, envelope)
      if (dose > 0) extract(titan, 'strip', dose, saturn.vel)
      run(bodies, 40, tracker)
      return tracker.heldScore('titan')
    })
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] + 0.5)
    }
    expect(scores[3]).toBeLessThan(scores[0] - 5)
  })

  it('emits a band-crossing event exactly once per crossing', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const tracker = new StabilityTracker(bodies, envelope)
    extract(titan, 'strip', 0.006, saturn.vel)
    const events = run(bodies, 150, tracker)
    const amber = events.filter(e => e.body === 'titan' && e.to === 'amber')
    expect(amber.length).toBe(1)
  })

  it('harmony drops when a body wobbles', () => {
    const bodies = buildSystem()
    const h0 = harmony(bodies, envelope)
    const titan = findBody(bodies, 'titan')!
    extract(titan, 'strip', 0.006, findBody(bodies, 'saturn')!.vel)
    run(bodies, 100)
    expect(harmony(bodies, envelope)).toBeLessThan(h0)
    expect(h0).toBeCloseTo(100, 5)
  })

  it('mass-loss coupling: draining a parent loosens its moons (spec §5)', () => {
    const bodies = buildSystem()
    const control = buildSystem()
    findBody(bodies, 'saturn')!.mass *= 0.5
    run(bodies, 150); run(control, 150)
    const drained = scoreOf(findBody(bodies, 'titan')!, bodies, envelope)
    const untouched = scoreOf(findBody(control, 'titan')!, control, envelope)
    expect(drained).toBeLessThan(untouched - 5)
    expect(untouched).toBe(100)
  })

  it('track() registers a new body without disturbing already-tracked held/band state', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const oberon = findBody(bodies, 'oberon')!
    // Construct the tracker WITHOUT oberon — simulates a body that isn't
    // present/tracked yet (the mid-run-addition scenario Task 7 hits when
    // spawning fabs: the tracker predates the new body).
    const initial = bodies.filter(b => b.name !== 'oberon')
    const tracker = new StabilityTracker(initial, envelope)
    extract(titan, 'strip', 0.0006, saturn.vel)
    run(bodies, 40, tracker)
    expect(tracker.heldBand('titan')).toBe('critical')
    const titanHeldBefore = tracker.heldScore('titan')
    expect(() => tracker.heldScore('oberon')).toThrow()

    tracker.track(oberon)

    expect(tracker.heldBand('oberon')).toBe('green')
    expect(tracker.heldScore('oberon')).toBe(100)
    // titan's already-accumulated held/band state must be untouched.
    expect(tracker.heldBand('titan')).toBe('critical')
    expect(tracker.heldScore('titan')).toBe(titanHeldBefore)
  })

  it('heldScore/heldBand throw for an unknown body name (no silent fallback)', () => {
    const bodies = buildSystem()
    const tracker = new StabilityTracker(bodies, envelope)
    expect(() => tracker.heldScore('not-a-real-body')).toThrow()
    expect(() => tracker.heldBand('not-a-real-body')).toThrow()
  })

  it('scoreOf throws when the envelope has no entry for the body (no silent ?? 0)', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const strippedEnvelope = { ...envelope }
    delete strippedEnvelope['titan']
    expect(() => scoreOf(titan, bodies, strippedEnvelope)).toThrow()
  })
})
