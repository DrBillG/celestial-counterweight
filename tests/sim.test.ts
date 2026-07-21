import { describe, it, expect } from 'vitest'
import { Sim, type SimEvent } from '../src/sim/sim'
import { findBody } from '../src/sim/data'
import { extract } from '../src/sim/mining'
import { computeBaselineEnvelope } from '../src/sim/stability'

// Coordinator fix #6: computed ONCE at module top and passed to every Sim
// instance in this file — avoids re-running the ~0.3s deterministic null
// probe on every `new Sim()` call.
const envelope = computeBaselineEnvelope()

function isCatastrophe(e: SimEvent): e is Extract<SimEvent, { type: 'catastrophe' }> {
  return e.type === 'catastrophe'
}
function isFabLost(e: SimEvent): e is Extract<SimEvent, { type: 'fabLost' }> {
  return e.type === 'fabLost'
}

describe('Sim facade', () => {
  it('pristine ticks: harmony stays exactly 100, zero events', () => {
    const sim = new Sim(envelope)
    sim.tick(10)
    expect(sim.harmony()).toBe(100)
    expect(sim.drainEvents().length).toBe(0)
  })

  it('savage over-mining produces a catastrophe within the run', () => {
    const sim = new Sim(envelope)
    const titan = findBody(sim.bodies, 'titan')!
    const saturn = findBody(sim.bodies, 'saturn')!
    extract(titan, 'strip', titan.mass * 0.45, saturn.vel)
    sim.tick(400)
    const catastrophes = sim.drainEvents().filter(isCatastrophe)
    expect(catastrophes.length).toBeGreaterThan(0)
    expect(catastrophes[0].body).toBe('titan')
  })

  it('an untouched system: full run, zero catastrophes AND zero band events', () => {
    const sim = new Sim(envelope)
    sim.tick(1800)
    expect(sim.drainEvents().length).toBe(0)
  })

  it('addFab places a stable circular-orbit body without disturbing the system', () => {
    const sim = new Sim(envelope)
    const fab = sim.addFab({ x: 30, y: 0 }, 2)
    expect(fab).not.toBeNull()
    expect(fab!.kind).toBe('fab')
    sim.tick(50)
    expect(sim.drainEvents().length).toBe(0)
  })

  // --- Coordinator fix #1: fabLost event semantics -----------------------

  it('fabLost: a fab colliding with a planet dies while the planet survives', () => {
    const sim = new Sim(envelope)
    const earth = findBody(sim.bodies, 'earth')!
    // Guard-legal placement (mass 0.02 / earth 0.5 = 0.04 ≤ FAB_MASS_RATIO_MAX)
    // that still starts exactly coincident with the planet.
    const fab = sim.addFab({ x: earth.pos.x, y: earth.pos.y }, 0.02)
    expect(fab).not.toBeNull()
    sim.tick(0.02) // one substep — bodies start exactly coincident
    const events = sim.drainEvents()
    const fabLost = events.filter(isFabLost)
    expect(fabLost.some(e => e.fab === fab!.name && e.cause === 'collision' && e.other === 'earth')).toBe(true)
    expect(events.filter(isCatastrophe).length).toBe(0) // earth survives — no game-over event
    expect(findBody(sim.bodies, 'earth')).toBeDefined() // bodies are never removed
  })

  // --- Coordinator review (Task 8): placement guards ---------------------

  it('placement guard: a second fab within FAB_MIN_SEPARATION is rejected; beyond it is legal', () => {
    const sim = new Sim(envelope)
    const fabA = sim.addFab({ x: 45, y: 0 }, 2) // clear of mercury(38)/venus(52)
    expect(fabA).not.toBeNull()
    // Overlapping / too-close placements used to mutually capture and
    // collide (measured: two 0.05 fabs at ≤6 u doom a rescue) — now
    // rejected outright.
    expect(sim.addFab({ x: 45, y: 0 }, 2)).toBeNull()
    expect(sim.addFab({ x: 45 + 6, y: 0 }, 0.05)).toBeNull()
    const fabB = sim.addFab({ x: 45 + 8.5, y: 0 }, 0.05)
    expect(fabB).not.toBeNull()
    sim.tick(0.02)
    expect(sim.drainEvents().filter(isFabLost).length).toBe(0)
  })

  it('placement guard: a fab too heavy for its local primary is rejected (mars case)', () => {
    const sim = new Sim(envelope)
    const mars = findBody(sim.bodies, 'mars')!
    const spot = { x: mars.pos.x + 2, y: mars.pos.y } // deep in mars\'s well — binds to mars
    // 0.01/0.11 ≈ 0.09 > FAB_MASS_RATIO_MAX: measured to false-amber mars
    // via real gravity (0.05 ejects it outright) — rejected.
    expect(sim.addFab(spot, 0.01)).toBeNull()
    // 0.005/0.11 ≈ 0.045 ≤ FAB_MASS_RATIO_MAX: legal.
    expect(sim.addFab(spot, 0.005)).not.toBeNull()
  })

  it('fabLost: a fab does not collide with a moon (different simulation layers)', () => {
    const sim = new Sim(envelope)
    const europa = findBody(sim.bodies, 'europa')!
    // Guard-legal real mass (0.05 / jupiter 1.5 ≈ 0.033), exactly coincident.
    expect(sim.addFab({ x: europa.pos.x, y: europa.pos.y }, 0.05)).not.toBeNull()
    sim.tick(0.02)
    const events = sim.drainEvents()
    expect(events.filter(isFabLost).length).toBe(0)
    expect(events.filter(isCatastrophe).length).toBe(0)
  })

  it('fabLost: a fab beyond EJECT_RADIUS or diving into the sun is lost, not a game-over catastrophe', () => {
    const ejectedSim = new Sim(envelope)
    const farFab = ejectedSim.addFab({ x: 650, y: 0 }, 2) // > EJECT_RADIUS (600)
    expect(farFab).not.toBeNull()
    ejectedSim.tick(0.02)
    const ejectedEvents = ejectedSim.drainEvents()
    expect(ejectedEvents.filter(isFabLost).some(e => e.fab === farFab!.name && e.cause === 'ejection')).toBe(true)
    expect(ejectedEvents.filter(isCatastrophe).length).toBe(0)

    const sundiveSim = new Sim(envelope)
    const closeFab = sundiveSim.addFab({ x: 5, y: 0 }, 2) // inside sun.radius(10)+fab.radius(1.2)
    expect(closeFab).not.toBeNull()
    sundiveSim.tick(0.02)
    const sundiveEvents = sundiveSim.drainEvents()
    expect(sundiveEvents.filter(isFabLost).some(e => e.fab === closeFab!.name && e.cause === 'sundive')).toBe(true)
    expect(sundiveEvents.filter(isCatastrophe).length).toBe(0)
  })

  // --- Coordinator fix #3: slow-cascade regression (required 5th test) ---

  it('slow-cascade regression: mild titan strip escalates through bands to a parent collision', () => {
    const sim = new Sim(envelope)
    const titan = findBody(sim.bodies, 'titan')!
    const saturn = findBody(sim.bodies, 'saturn')!
    extract(titan, 'strip', 0.0002, saturn.vel)

    const bandTimes: Partial<Record<string, number>> = {}
    let collisionTime: number | null = null
    let collisionOther: string | undefined
    const STEP = 1 // tu resolution for measuring band transition times
    const LIMIT = 400

    for (let t = STEP; t <= LIMIT && collisionTime === null; t += STEP) {
      sim.tick(STEP)
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'band' && ev.body === 'titan' && !(ev.to in bandTimes)) {
          bandTimes[ev.to] = t
        }
        if (ev.type === 'catastrophe' && ev.body === 'titan' && collisionTime === null) {
          collisionTime = t
          collisionOther = ev.other
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log('slow-cascade timeline (tu):', bandTimes, 'collision at', collisionTime)

    expect(bandTimes.amber).toBeDefined()
    expect(bandTimes.red).toBeDefined()
    expect(bandTimes.critical).toBeDefined()
    expect(bandTimes.amber!).toBeLessThan(bandTimes.red!)
    expect(bandTimes.red!).toBeLessThan(bandTimes.critical!)
    expect(collisionTime).not.toBeNull()
    expect(collisionOther).toBe('saturn')
  })
})
