import { describe, it, expect } from 'vitest'
import { v, dist } from '../src/sim/vec'
import { makeBody } from '../src/sim/body'
import { step } from '../src/sim/integrator'
import { G, DT } from '../src/constants'

describe('integrator', () => {
  it('holds a circular two-body orbit for 100 orbits within 0.5%', () => {
    const M = 1000
    const r = 80
    const vCirc = Math.sqrt((G * M) / r)
    const sun = makeBody({ name: 'sun', kind: 'star', mass: M, pos: v(0, 0), vel: v(0, 0), radius: 8, parentName: null, rNom: 0 })
    const planet = makeBody({ name: 'p', kind: 'planet', mass: 0.001, pos: v(r, 0), vel: v(0, vCirc), radius: 1, parentName: 'sun', rNom: r })
    const bodies = [sun, planet]
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * M))
    const steps = Math.ceil((100 * period) / DT)
    let minR = Infinity, maxR = 0
    for (let i = 0; i < steps; i++) {
      step(bodies, DT)
      const d = dist(planet.pos, sun.pos)
      minR = Math.min(minR, d); maxR = Math.max(maxR, d)
    }
    expect(minR).toBeGreaterThan(r * 0.995)
    expect(maxR).toBeLessThan(r * 1.005)
  })
})
