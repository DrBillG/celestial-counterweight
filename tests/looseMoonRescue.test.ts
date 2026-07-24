// Loose-moon (jupiter trio) rescue behavior — the guided Return-Slag save.
//
// The trio (io/europa/ganymede) orbit OUTSIDE jupiter's Hill sphere, so a
// fixed counterweight can't hold them (they fall radially out of its range).
// Mining them destabilizes them; the ONLY rescue is RETURN SLAG — station the
// ship ON the moon (it tracks the moon) and give back ALL cargo, which
// re-circularizes the orbit. These tests pin both halves of that contract:
//   1. reckless play (mine and leave, no rescue) still LOSES the moon, and
//   2. a Return-Slag-all rescue SAVES it durably (survives the whole run after
//      the ship leaves).
// Both drive ONLY the public player API, like the scenario bots.
import { describe, it, expect } from 'vitest'
import { Director } from '../src/game/director'
import { computeBaselineEnvelope } from '../src/sim/stability'
import { findBody } from '../src/sim/data'
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

describe('loose-moon (jupiter trio) rescue contract', () => {
  it('RECKLESS: mining ganymede then leaving (no rescue) still loses the run', () => {
    const d = new Director(envelope)
    fly(d, 'ganymede')
    d.chooseExtraction('lattice')
    for (let i = 0; i < 30 && d.state === 'mining' && d.activeExtraction() != null; i++) d.advance(STEP)
    fly(d, 'titan') // move on without stabilizing ganymede — ends any stationing
    expect(lostToCatastrophe(d, RUN_DURATION)).toBe(true)
  })

  it('RESCUE: mine ganymede, RETURN SLAG all cargo, then leave — ganymede survives the run', () => {
    const d = new Director(envelope)
    fly(d, 'ganymede')
    const gan0 = findBody(d.sim.bodies, 'ganymede')!
    const m0 = gan0.m0
    d.chooseExtraction('lattice')
    for (let i = 0; i < 16 && d.state === 'mining' && d.activeExtraction() != null; i++) d.advance(STEP)
    expect(d.cargo).toBeGreaterThan(0)

    // Fairness: the rescue window must be WIDE enough for a human to react (the
    // frame loop advances ~1 tu per real second). Dwell 30 tu (~30 s) BEFORE
    // rescuing — if this fails, the loose-moon runaway crept back and made the
    // window unfair. (With the runaway off, a mined loose moon coasts on a mild
    // eccentric orbit that Return Slag can still re-circularize.)
    for (let i = 0; i < 15 && d.state === 'mining'; i++) d.advance(STEP)
    expect(d.state).not.toBe('lost')

    // Guided rescue: Return Slag stations the ship (tracks the moon) and gives
    // mass back until cargo is exhausted (mode auto-clears; stationing stays).
    d.chooseExtraction('slag')
    let held = 0
    while (held < 400 && d.activeExtraction() === 'slag' && d.state !== 'lost') {
      d.advance(STEP)
      held += STEP
    }
    expect(d.cargo).toBeCloseTo(0, 6) // returned everything (net-zero yield)

    // Leave — ship-assist ends. The re-circularized orbit must hold on its own.
    fly(d, 'titan')
    expect(lostToCatastrophe(d, RUN_DURATION)).toBe(false)

    // Ganymede is alive, mass restored near m0, orbiting near its nominal radius.
    const gan = findBody(d.sim.bodies, 'ganymede')!
    const jup = findBody(d.sim.bodies, 'jupiter')!
    const r = Math.hypot(gan.pos.x - jup.pos.x, gan.pos.y - jup.pos.y)
    expect(gan.mass).toBeGreaterThan(m0 * 0.9)
    expect(r).toBeGreaterThan(gan.rNom * 0.6) // nowhere near a jupiter collision
  })

  it('flags every outside-Hill-sphere moon as loose, and the bound ones as normal', () => {
    const d = new Director(envelope)
    // Loosely bound (outside parent Hill sphere) — counterweight can't hold them.
    for (const n of ['ganymede', 'io', 'europa', 'moon', 'phobos']) {
      expect(d.isLooseMoon(n)).toBe(true)
    }
    // Well bound (inside a heavy parent's Hill sphere) — counterweight-rescuable.
    for (const n of ['titan', 'oberon', 'triton']) {
      expect(d.isLooseMoon(n)).toBe(false)
    }
  })
})

// The new clean targets (Titan-class solo moons of heavy planets) must be
// COUNTERWEIGHT-rescuable — mine to amber, depart, place a segment, and the
// counterweight holds the moon back to green. This is the "more options" fix:
// before it, Titan was the only rescuable target. If a roster/physics change
// makes these fall out of range or cascade, this fails.
describe('clean counterweight targets (titan / oberon / triton)', () => {
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

  for (const target of ['titan', 'oberon', 'triton']) {
    it(`${target}: mine-to-amber → counterweight holds it (recovers toward green)`, () => {
      const r = held(target)
      expect(r.cargo).toBeGreaterThan(0)
      expect(r.held).toBe(true)
      expect(r.endBand).toBe('green')
    })
  }
})
