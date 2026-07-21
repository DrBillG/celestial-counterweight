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

  it('null test: untouched system deviates < 1% over a full run', () => {
    const bodies = buildSystem()
    const steps = Math.ceil(RUN_DURATION / DT)
    for (let i = 0; i < steps; i++) stepHierarchical(bodies, DT)
    for (const b of bodies) {
      if (!b.parentName || b.kind === 'ship') continue
      const parent = findBody(bodies, b.parentName)!
      const d = dist(b.pos, parent.pos)
      expect(Math.abs(d - b.rNom) / b.rNom, `${b.name} drifted`).toBeLessThan(0.01)
    }
  })
})
