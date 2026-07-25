// PLAYABILITY CONTRACT — the "is this game actually playable and fun" suite.
//
// This pins the realistic player loop for EVERY minable moon: fly out, mine
// gently until the stability band leaves green, fly to the fab (a real trip,
// during which the held score partially recovers), place a counterweight, and
// carry on. The moon must SURVIVE and the delivery must credit the sphere.
//
// It exists because of two shipped bugs this exact flow exposed:
//  1. The counterweight was placed by "worst non-green body". Held score
//     recovers on a timer, so a moon mined to amber usually reads green again
//     by the time you reach the fab — the segment was then parked in the sun
//     annulus, far outside assist range, and the still-damaged moon decayed
//     into its parent. ("I place a counterweight and nothing happens.")
//  2. Hasty placement drops at the ship, which during construction IS the fab
//     anchor — equally useless as a rescue. ("Even hasty doesn't work.")
// suggestedBase() now falls back to the just-mined body, which fixes both.
import { describe, it, expect } from 'vitest'
import { Director } from '../src/game/director'
import { computeBaselineEnvelope } from '../src/sim/stability'
import { findBody } from '../src/sim/data'
import { SIM_RATE, ASSIST_RANGE } from '../src/constants'

const envelope = computeBaselineEnvelope()
const STEP = 2
const MINABLE = ['moon', 'europa', 'titan', 'oberon', 'triton']

function fly(d: Director, target: string): void {
  d.selectTarget(target)
  d.launch()
  d.advance(d.transitRemaining() / SIM_RATE + 0.01)
}

// One realistic mining round. Returns what the player would care about.
function round(target: string) {
  const d = new Director(envelope)
  fly(d, target)
  d.chooseExtraction('lattice')
  let el = 0
  while (el < 400 && d.state === 'mining' && d.activeExtraction() != null) {
    d.advance(STEP); el += STEP
    if (d.sim.tracker.heldBand(target) !== 'green') break // back off at amber
  }
  const cargo = d.cargo
  fly(d, 'fab')
  const before = d.sphereProgress()
  d.placeSegment('suggested')
  const gain = d.sphereProgress() - before
  // Where did the counterweight actually land relative to the mined moon?
  const moon = findBody(d.sim.bodies, target)!
  const fab = d.sim.bodies.filter((b) => b.kind === 'fab').pop()
  const fabToMoon = fab ? Math.hypot(fab.pos.x - moon.pos.x, fab.pos.y - moon.pos.y) : Infinity
  for (let i = 0; i < 12 && d.state === 'constructing'; i++) d.advance(STEP)
  // Play on for a long while — the moon must not die after we move on.
  let l = 0
  while (l < 500 && d.state !== 'lost' && d.state !== 'won') { d.advance(STEP); l += STEP; d.drainEvents() }
  return { cargo, gain, fabToMoon, lost: d.state === 'lost' }
}

describe('playability: every minable moon supports a full, survivable mining round', () => {
  for (const target of MINABLE) {
    it(`${target}: mine → counterweight lands IN RANGE → moon survives → sphere credited`, () => {
      const r = round(target)
      expect(r.cargo).toBeGreaterThan(0)                    // mining yields cargo
      expect(r.gain).toBeGreaterThan(0)                     // delivery credits the sphere
      expect(r.fabToMoon).toBeLessThan(ASSIST_RANGE)        // counterweight can actually help
      expect(r.lost).toBe(false)                            // and the moon survives
    })
  }
})
