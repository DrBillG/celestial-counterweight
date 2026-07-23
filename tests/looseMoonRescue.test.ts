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

  it('director flags the trio as loose moons (and titan as a normal moon)', () => {
    const d = new Director(envelope)
    expect(d.isLooseMoon('ganymede')).toBe(true)
    expect(d.isLooseMoon('io')).toBe(true)
    expect(d.isLooseMoon('europa')).toBe(true)
    expect(d.isLooseMoon('titan')).toBe(false)
    expect(d.isLooseMoon('moon')).toBe(false)
  })
})
