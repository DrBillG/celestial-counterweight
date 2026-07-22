import { describe, it, expect } from 'vitest'
import { buildSystem, findBody } from '../src/sim/data'
import { extract, returnSlag } from '../src/sim/mining'
import { len, sub, scale } from '../src/sim/vec'

describe('mining', () => {
  it('moves mass from body to ship cargo', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const m0 = titan.mass
    const result = extract(titan, 'strip', 0.002, saturn.vel)
    expect(titan.mass).toBeCloseTo(m0 - 0.002, 10)
    expect(result.cargo).toBeCloseTo(0.002, 10)
  })

  it('caps a single extraction at half the body mass', () => {
    const bodies = buildSystem()
    const europa = findBody(bodies, 'europa')! // mass 0.0005 — dose bigger than body
    const jupiter = findBody(bodies, 'jupiter')!
    const result = extract(europa, 'strip', 0.002, jupiter.vel)
    expect(result.cargo).toBeCloseTo(0.00025, 10)
    expect(europa.mass).toBeCloseTo(0.00025, 10)
  })

  it('conserves momentum: body impulse equals ejecta momentum, opposite sign', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const velBefore = { ...titan.vel }
    const massAfter = titan.mass - 0.002
    const r = extract(titan, 'strip', 0.002, saturn.vel)
    const bodyDp = scale(sub(titan.vel, velBefore), massAfter)
    expect(bodyDp.x).toBeCloseTo(-r.ejectaMomentum.x, 8)
    expect(bodyDp.y).toBeCloseTo(-r.ejectaMomentum.y, 8)
  })

  it('ejecta leaves along the RELATIVE prograde direction when refVel is given', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const relBefore = sub(titan.vel, saturn.vel)
    const r = extract(titan, 'strip', 0.002, saturn.vel)
    // ejecta momentum is parallel to relative prograde, not absolute velocity
    const cross = r.ejectaMomentum.x * relBefore.y - r.ejectaMomentum.y * relBefore.x
    const dot = r.ejectaMomentum.x * relBefore.x + r.ejectaMomentum.y * relBefore.y
    expect(Math.abs(cross)).toBeLessThan(1e-12)
    expect(dot).toBeGreaterThan(0)
  })

  it('strip blast imparts far more impulse than lattice bore for equal mass', () => {
    const a = buildSystem(); const b = buildSystem()
    const ta = findBody(a, 'titan')!; const tb = findBody(b, 'titan')!
    const sa = findBody(a, 'saturn')!; const sb = findBody(b, 'saturn')!
    const va = { ...ta.vel }; const vb = { ...tb.vel }
    extract(ta, 'strip', 0.002, sa.vel); extract(tb, 'lattice', 0.002, sb.vel)
    const dva = len(sub(ta.vel, va)); const dvb = len(sub(tb.vel, vb))
    expect(dva).toBeGreaterThan(dvb * 5)
  })

  it('returnSlag restores mass', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    extract(titan, 'strip', 0.002, saturn.vel)
    const m = titan.mass
    returnSlag(titan, 0.001, saturn)
    expect(titan.mass).toBeCloseTo(m + 0.001, 10)
  })

  it('extract with dm <= 0 removes nothing and leaves velocity unchanged', () => {
    const bodies = buildSystem()
    const titan = findBody(bodies, 'titan')!
    const saturn = findBody(bodies, 'saturn')!
    const m0 = titan.mass
    const velBefore = { ...titan.vel }
    const result = extract(titan, 'strip', -0.002, saturn.vel)
    expect(titan.mass).toBeCloseTo(m0, 10)
    expect(result.cargo).toBeCloseTo(0, 10)
    expect(titan.vel.x).toBeCloseTo(velBefore.x, 10)
    expect(titan.vel.y).toBeCloseTo(velBefore.y, 10)
  })
})
