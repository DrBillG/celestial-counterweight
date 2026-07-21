import { describe, it, expect } from 'vitest'
import { Director, type GameEvent } from '../src/game/director'
import { findBody } from '../src/sim/data'
import { extract } from '../src/sim/mining'
import { computeBaselineEnvelope } from '../src/sim/stability'
import { norm, sub } from '../src/sim/vec'
import {
  RATE, EXTRACTION_FLOOR, SPHERE_MASS_REQUIRED, DECISION_WINDOW,
  SLINGSHOT_BONUS, SIM_RATE,
} from '../src/constants'

// Coordinator convention (see sim.test.ts / rebalance.test.ts): the ~0.3s
// deterministic null probe is computed ONCE at module top and passed to
// every Director (which forwards it to its Sim).
const envelope = computeBaselineEnvelope()

// Fly the director's ship to a destination and consume the whole transit.
function flyTo(d: Director, target: string): void {
  d.selectTarget(target)
  d.launch()
  d.advance(d.transitRemaining() / SIM_RATE + 0.01)
}

function drainAll(d: Director): GameEvent[] {
  return d.drainEvents()
}

describe('Director: run state machine (Task 9)', () => {
  it('starts in orrery at 0% sphere; selectTarget+launch → transit → arrival → mining', () => {
    const d = new Director(envelope)
    expect(d.state).toBe('orrery')
    expect(d.sphereProgress()).toBe(0)
    expect(d.currentTarget()).toBeNull()

    d.selectTarget('titan')
    d.launch()
    expect(d.state).toBe('transit')
    expect(d.currentTarget()).toBe('titan')
    const t = d.transitRemaining()
    expect(t).toBeGreaterThan(0)

    d.advance(t / SIM_RATE + 0.01)
    expect(d.state).toBe('mining')
    expect(d.transitRemaining()).toBe(0)
  })

  it('burn() shortens the transit once; second burn is a no-op; arrival still works', () => {
    const d = new Director(envelope)
    d.selectTarget('titan')
    d.launch()
    const t0 = d.transitRemaining()
    d.burn()
    const t1 = d.transitRemaining()
    expect(t1).toBeCloseTo(t0 * (1 - SLINGSHOT_BONUS), 10)
    d.burn() // once per transit — no-op
    expect(d.transitRemaining()).toBe(t1)
    d.advance(t1 / SIM_RATE + 0.01)
    expect(d.state).toBe('mining')
  })

  it('bodyRisk: phobos fragile (amendment 12d), jupiter trio trophies, others standard', () => {
    const d = new Director(envelope)
    expect(d.bodyRisk('phobos')).toBe('fragile')
    for (const trophy of ['io', 'europa', 'ganymede']) expect(d.bodyRisk(trophy)).toBe('trophy')
    for (const std of ['titan', 'moon', 'mars']) expect(d.bodyRisk(std)).toBe('standard')
  })

  it('mining titan (lattice) accumulates cargo and removes exactly that mass', () => {
    const d = new Director(envelope)
    const titan = findBody(d.sim.bodies, 'titan')!
    flyTo(d, 'titan')
    const massBefore = titan.mass
    d.chooseExtraction('lattice')
    for (let i = 0; i < 10; i++) d.advance(1)
    // extract() requires the 4-arg refVel form — a wrong-arity call would
    // throw at compile/run time, so cargo accumulating at all pins it.
    expect(d.cargo).toBeCloseTo(10 * SIM_RATE * RATE.lattice, 12)
    expect(massBefore - titan.mass).toBeCloseTo(d.cargo, 12)
    expect(d.state).toBe('mining')
  })

  it('extraction floor: strip on a near-husk auto-stops, emits once, never breaches the floor', () => {
    const d = new Director(envelope)
    const titan = findBody(d.sim.bodies, 'titan')!
    flyTo(d, 'titan')
    // Pre-drain to just above the floor: headroom of half a 1-tu strip dose.
    const floor = EXTRACTION_FLOOR * titan.m0
    const preMass = floor + RATE.strip * 0.5
    titan.mass = preMass
    d.chooseExtraction('strip')
    const evs: GameEvent[] = []
    for (let i = 0; i < 3; i++) {
      d.advance(1)
      evs.push(...drainAll(d))
    }
    const floorEvents = evs.filter(e => e.type === 'extractionFloor')
    expect(floorEvents.length).toBe(1)
    expect((floorEvents[0] as { body: string }).body).toBe('titan')
    // sacred: the floor is never breached — the refused dose left mass untouched
    expect(titan.mass).toBe(preMass)
    expect(titan.mass).toBeGreaterThanOrEqual(floor)
  })

  it('full loop: mine → fab transit (assist cleared) → constructing → suggested placement → orrery', () => {
    const d = new Director(envelope)
    flyTo(d, 'titan')
    d.chooseExtraction('lattice')
    for (let i = 0; i < 10; i++) d.advance(1)
    expect(d.cargo).toBeGreaterThan(0)

    // Station the ship (as Return Slag would), then depart — amendment 12:
    // launch() must end the stationing.
    d.sim.setShipAssist('titan')
    d.selectTarget('fab')
    d.launch()
    expect((d.sim as unknown as { shipAssistTarget: string | null }).shipAssistTarget).toBeNull()
    expect(d.state).toBe('transit')

    d.advance(d.transitRemaining() / SIM_RATE + 0.01)
    expect(d.state).toBe('constructing')
    expect(d.decisionRemaining()).toBeGreaterThan(0)

    const fabsBefore = d.sim.bodies.filter(b => b.kind === 'fab').length
    const cargoDelivered = d.cargo
    d.placeSegment('suggested')
    const fabs = d.sim.bodies.filter(b => b.kind === 'fab')
    expect(fabs.length).toBe(fabsBefore + 1)
    expect(d.sphereProgress()).toBeCloseTo((100 * cargoDelivered) / SPHERE_MASS_REQUIRED, 8)
    expect(d.sphereProgress()).toBeGreaterThan(0)
    expect(d.cargo).toBe(0)
    expect(d.state).toBe('orrery')
  })

  it('decision-window expiry auto-places (hasty): sphere progresses without a player call', () => {
    const d = new Director(envelope)
    d.cargo = 0.01 // cheat-load a delivery
    d.selectTarget('fab')
    d.launch()
    d.advance(d.transitRemaining() / SIM_RATE + 0.01)
    expect(d.state).toBe('constructing')
    for (let i = 0; i < DECISION_WINDOW + 2 && d.state === 'constructing'; i++) d.advance(1)
    expect(d.state).toBe('orrery')
    expect(d.cargo).toBe(0)
    expect(d.sphereProgress()).toBeCloseTo((100 * 0.01) / SPHERE_MASS_REQUIRED, 8)
  })

  it('placementRejected fallback: hasty next to a live fab still delivers — cargo never silently lost', () => {
    const d = new Director(envelope)
    // Delivery 1: fab parked at the construction anchor.
    d.cargo = 0.01
    d.selectTarget('fab')
    d.launch()
    d.advance(d.transitRemaining() / SIM_RATE + 0.01)
    d.placeSegment('hasty')
    expect(d.state).toBe('orrery')
    expect(d.sim.bodies.filter(b => b.kind === 'fab').length).toBe(1)

    // Delivery 2: ship is still parked at the anchor, i.e. within
    // FAB_MIN_SEPARATION of fab #1 — the base hasty position must be
    // rejected by addFab and recovered via fallbacks (or, failing all
    // fallbacks, via placementRejected + decision-window expiry retry).
    d.cargo = 0.01
    d.selectTarget('fab')
    d.launch()
    d.advance(d.transitRemaining() / SIM_RATE + 0.01)
    expect(d.state).toBe('constructing')
    d.placeSegment('hasty')
    const evs = drainAll(d)
    if (d.state === 'constructing') {
      // full-rejection branch: cargo kept, event emitted, expiry recovers
      expect(evs.some(e => e.type === 'placementRejected')).toBe(true)
      expect(d.cargo).toBe(0.01)
      for (let i = 0; i < DECISION_WINDOW + 2 && d.state === 'constructing'; i++) d.advance(1)
    }
    expect(d.state).toBe('orrery')
    expect(d.cargo).toBe(0)
    expect(d.sim.bodies.filter(b => b.kind === 'fab').length).toBe(2)
    expect(d.sphereProgress()).toBeCloseTo((100 * 0.02) / SPHERE_MASS_REQUIRED, 8)
  })

  it('slag mode: stations ship assist on titan, drips cargo back, heals the flapping zone', () => {
    const d = new Director(envelope)
    const titan = findBody(d.sim.bodies, 'titan')!
    const saturn = findBody(d.sim.bodies, 'saturn')!
    // Flapping-zone dose (amendment 10: 0.00005 strip = perpetual klaxon,
    // no cascade, no self-healing).
    extract(titan, 'strip', 0.00005, saturn.vel)
    flyTo(d, 'titan')
    d.cargo = 0.00005 // the mined mass, cheat-loaded

    const massBefore = titan.mass
    d.chooseExtraction('slag')
    const probe = d.sim as unknown as { shipAssistTarget: string | null }
    expect(probe.shipAssistTarget).toBe('titan')

    d.advance(1) // RATE_SLAG·1 ≥ cargo → fully drained in one step
    expect(d.cargo).toBe(0)
    expect(titan.mass).toBeCloseTo(massBefore + 0.00005, 12)
    // mode auto-cleared, but the ship STAYS stationed until departure
    expect(probe.shipAssistTarget).toBe('titan')

    // Healing (mirrors the Task 8 ship-assist healing proof, earlier
    // intervention): within a modest window titan band events stop and the
    // held band recovers to green.
    let lateTitanBandEvents = 0
    for (let t = 0; t < 400; t += 10) {
      d.advance(10)
      const n = drainAll(d).filter(e => e.type === 'band' && (e as { body: string }).body === 'titan').length
      if (t >= 300) lateTitanBandEvents += n
    }
    expect(lateTitanBandEvents).toBe(0)
    expect(d.sim.tracker.heldBand('titan')).toBe('green')
    expect(d.state).toBe('mining') // still stationed at titan, playable
  })

  it('catastrophe → lost (savage dose), and advance() no-ops afterwards', () => {
    const d = new Director(envelope)
    const titan = findBody(d.sim.bodies, 'titan')!
    const saturn = findBody(d.sim.bodies, 'saturn')!
    extract(titan, 'strip', titan.mass * 0.45, saturn.vel)
    for (let t = 0; t < 400 && d.state !== 'lost'; t += 10) d.advance(10)
    expect(d.state).toBe('lost')
    d.advance(10)
    expect(d.state).toBe('lost')
  })

  it('fabLost is a setback, NOT a loss (amendment 10)', () => {
    const d = new Director(envelope)
    // Measured doomed fab (Task 8 proximity proof): ganymede orbits OUTSIDE
    // jupiter's Hill radius, so a helio-layer fab parked just beyond it is
    // captured and swallowed by jupiter within ~300 tu — quietly.
    const ganymede = findBody(d.sim.bodies, 'ganymede')!
    const jupiter = findBody(d.sim.bodies, 'jupiter')!
    const radial = norm(sub(ganymede.pos, jupiter.pos))
    const fab = d.sim.addFab(
      { x: ganymede.pos.x + radial.x * 6, y: ganymede.pos.y + radial.y * 6 },
      0.05,
    )
    expect(fab).not.toBeNull()
    let sawFabLost = false
    for (let t = 0; t < 320 && !sawFabLost; t += 10) {
      d.advance(10)
      if (drainAll(d).some(e => e.type === 'fabLost')) sawFabLost = true
    }
    expect(sawFabLost).toBe(true)
    expect(d.state).toBe('orrery') // still playable
  })

  it('delivering SPHERE_MASS_REQUIRED wins; advance() no-ops afterwards', () => {
    const d = new Director(envelope)
    d.cargo = SPHERE_MASS_REQUIRED
    d.selectTarget('fab')
    d.launch()
    d.advance(d.transitRemaining() / SIM_RATE + 0.01)
    expect(d.state).toBe('constructing')
    d.placeSegment('hasty')
    expect(d.sphereProgress()).toBeGreaterThanOrEqual(100)
    expect(d.state).toBe('won')
    d.advance(10)
    expect(d.state).toBe('won')
  })
})
