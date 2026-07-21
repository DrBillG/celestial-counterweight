import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { stepHierarchical } from '../src/sim/integrator'
import { dist } from '../src/sim/vec'
import { DT, RUN_DURATION } from '../src/constants'

describe('solar system', () => {
  it('contains the minable roster', () => {
    const bodies = buildSystem()
    for (const name of ['moon', 'phobos', 'io', 'europa', 'ganymede', 'titan']) {
      expect(findBody(bodies, name)?.minable).toBe(true)
    }
    expect(findBody(bodies, 'ship')).toBeDefined()
  })

  // Bound is the coordinator-approved fallback band: best achievable
  // running-max with reduced masses + detuned radii is 1.93% (jupiter,
  // forced by saturn); see the roster notes in src/sim/data.ts. Task 6
  // scores against per-body baseline envelopes, not this band.
  it('null test: untouched system stays < 2% deviation at EVERY step of a full run', () => {
    const bodies = buildSystem()
    const tracked = bodies.filter(b => b.parentName && b.kind !== 'ship')
    const parents = tracked.map(b => findBody(bodies, b.parentName!)!)
    const maxDev = tracked.map(() => 0)
    const steps = Math.ceil(RUN_DURATION / DT)
    for (let i = 0; i < steps; i++) {
      stepHierarchical(bodies, DT)
      for (let k = 0; k < tracked.length; k++) {
        const d = dist(tracked[k].pos, parents[k].pos)
        const dev = Math.abs(d - tracked[k].rNom) / tracked[k].rNom
        if (dev > maxDev[k]) maxDev[k] = dev
      }
    }
    for (let k = 0; k < tracked.length; k++) {
      expect(maxDev[k], `${tracked[k].name} drifted (running max)`).toBeLessThan(0.02)
    }
  })

  it('determinism: two identical systems stay bitwise identical for 5000 steps', () => {
    const a = buildSystem()
    const b = buildSystem()
    for (let i = 0; i < 5000; i++) {
      stepHierarchical(a, DT)
      stepHierarchical(b, DT)
    }
    for (let k = 0; k < a.length; k++) {
      expect(a[k].pos.x).toBe(b[k].pos.x)
      expect(a[k].pos.y).toBe(b[k].pos.y)
      expect(a[k].vel.x).toBe(b[k].vel.x)
      expect(a[k].vel.y).toBe(b[k].vel.y)
    }
  })
})
