import { describe, it, expect } from 'vitest'
import { Sim } from '../src/sim/sim'
import { findBody } from '../src/sim/data'
import { extract } from '../src/sim/mining'

describe('Sim facade', () => {
  it('pristine ticks: harmony stays exactly 100, zero events', () => {
    const sim = new Sim()
    sim.tick(10)
    expect(sim.harmony()).toBe(100)
    expect(sim.drainEvents().length).toBe(0)
  })

  it('savage over-mining produces a catastrophe within the run', () => {
    const sim = new Sim()
    const titan = findBody(sim.bodies, 'titan')!
    const saturn = findBody(sim.bodies, 'saturn')!
    extract(titan, 'strip', titan.mass * 0.45, saturn.vel)
    sim.tick(400)
    const catastrophes = sim.drainEvents().filter(e => e.type === 'catastrophe')
    expect(catastrophes.length).toBeGreaterThan(0)
    expect(catastrophes[0].body).toBe('titan')
  })

  it('an untouched system: full run, zero catastrophes AND zero band events', () => {
    const sim = new Sim()
    sim.tick(1800)
    expect(sim.drainEvents().length).toBe(0)
  })

  it('addFab places a stable circular-orbit body without disturbing the system', () => {
    const sim = new Sim()
    const fab = sim.addFab({ x: 30, y: 0 }, 2)
    expect(fab.kind).toBe('fab')
    sim.tick(50)
    expect(sim.drainEvents().length).toBe(0)
  })
})
