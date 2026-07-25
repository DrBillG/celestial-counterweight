// Clean counterweight-rescue contract for the whole minable roster.
//
// After the roster rework every minable body is a clean, counterweight-
// rescuable moon (moon, europa, titan, oberon, triton) — the old loose moons
// (jupiter trio / Return-Slag rescue) and fragile poison-traps (mars/phobos)
// were removed. The contract each moon must honor: mine it to amber, depart to
// the fab, place a 'suggested' segment (which drops a counterweight next to the
// worst wobbler), advance the healing horizon, and the moon must be HELD — the
// run does NOT go 'lost'. The heavy-parent moons (titan/oberon/triton) recover
// all the way to green; the lighter Moon/Europa may hold at red — both are the
// contract (survives), green is a bonus.
//
// All of this drives ONLY the public player API, like the scenario bots.
import { describe, it, expect } from 'vitest'
import { Director } from '../src/game/director'
import { computeBaselineEnvelope } from '../src/sim/stability'
import { SIM_RATE, RUN_DURATION } from '../src/constants'

const envelope = computeBaselineEnvelope()
const STEP = 2

function fly(d: Director, target: string): void {
  d.selectTarget(target)
  d.launch()
  d.advance(d.transitRemaining() / SIM_RATE + 0.01)
}
function lostToCatastrophe(d: Director, tu: number): boolean {
  let el = 0
  while (el < tu && d.state !== 'lost' && d.state !== 'won') {
    d.advance(STEP)
    el += STEP
    d.drainEvents()
  }
  return d.state === 'lost'
}

// Every minable moon must be COUNTERWEIGHT-rescuable — mine to amber, depart,
// place a segment, and the counterweight holds the moon (no catastrophe). If a
// roster/physics change makes one fall out of range or cascade, this fails.
describe('clean counterweight targets (whole minable roster)', () => {
  function held(target: string): { held: boolean; endBand: string; cargo: number } {
    const d = new Director(envelope)
    fly(d, target)
    d.chooseExtraction('lattice')
    let el = 0
    while (el < 400 && d.state === 'mining' && d.activeExtraction() != null) {
      d.advance(STEP); el += STEP
      if (d.sim.tracker.heldBand(target) !== 'green') break // backed off at amber
    }
    const cargo = d.cargo
    fly(d, 'fab')
    d.placeSegment('suggested') // drops a counterweight next to the worst wobbler
    for (let i = 0; i < 12 && d.state === 'constructing'; i++) d.advance(STEP)
    // Run the healing horizon; the counterweight must hold it (no catastrophe).
    const survived = !lostToCatastrophe(d, 430)
    return { held: survived, endBand: d.sim.tracker.heldBand(target), cargo }
  }

  // The whole roster must be HELD (survives — the run never goes 'lost').
  for (const target of ['moon', 'europa', 'titan', 'oberon', 'triton']) {
    it(`${target}: mine-to-amber → counterweight holds it (run survives)`, () => {
      const r = held(target)
      expect(r.cargo).toBeGreaterThan(0)
      expect(r.held).toBe(true)
    })
  }

  // Heavy-parent moons additionally recover all the way to green.
  for (const target of ['titan', 'oberon', 'triton']) {
    it(`${target}: counterweight recovers it back to green`, () => {
      const r = held(target)
      expect(r.held).toBe(true)
      expect(r.endBand).toBe('green')
    })
  }
})
