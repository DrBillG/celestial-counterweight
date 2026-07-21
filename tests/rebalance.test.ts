import { describe, it, expect } from 'vitest'
import { Sim, type SimEvent } from '../src/sim/sim'
import { findBody } from '../src/sim/data'
import { extract, returnSlag } from '../src/sim/mining'
import { deviationOf, scoreOf, computeBaselineEnvelope } from '../src/sim/stability'
import { norm, sub } from '../src/sim/vec'

// Computed ONCE at module top (coordinator convention, see sim.test.ts) and
// passed to every Sim instance in this file — avoids re-running the ~0.3s
// deterministic null probe on every `new Sim()` call.
const envelope = computeBaselineEnvelope()

function isCatastrophe(e: SimEvent): e is Extract<SimEvent, { type: 'catastrophe' }> {
  return e.type === 'catastrophe'
}
function isBand(e: SimEvent): e is Extract<SimEvent, { type: 'band' }> {
  return e.type === 'band'
}
function isFabLost(e: SimEvent): e is Extract<SimEvent, { type: 'fabLost' }> {
  return e.type === 'fabLost'
}

describe('rebalance efficacy: PD assist at real fab masses (Task 8, amendment 11)', () => {
  // --- Sacred proof 1: grid-robust rescue ---------------------------------
  //
  // Amendment 11(b)/(d): the assist is a PD controller and the rescue proof
  // must hold across a small parameter GRID, not a single knife-edge point.
  // Scenario (amendment 10 measured timeline): titan strip dose 0.0002 →
  // amber t≈33, red t≈46, critical t≈59, unassisted parent collision t≈104.
  // We intervene LATE (t=70, deviation ≈11%, held score already 0) with a
  // single REAL-mass fab (cargo-built, ≤0.05 — amendment 11(a)) and require
  // a full save for EVERY grid cell:
  //   - no titan catastrophe through t=600,
  //   - held band exits 'critical' by t=600 (held recovery is capped at
  //     HELD_RECOVERY_PER_TU=0.25/tu from 0, so exit can't happen before
  //     t≈190 — the PD must PIN deviation near the envelope for 120+ tu
  //     against the still-active runaway, not just nudge it),
  //   - no ejection-style overshoot: end deviation < deviation at
  //     intervention (the old constant-magnitude assist failed exactly here
  //     — arrest-or-overshoot knife edge, overshoot reinforced by runaway
  //     into ejection).
  it('grid-robust rescue: every fabMass × offset cell fully saves titan from late-critical', () => {
    for (const fabMass of [0.03, 0.05]) {
      for (const offset of [2, 4]) {
        const label = `fabMass=${fabMass} offset=${offset}`
        const sim = new Sim(envelope)
        const titan = findBody(sim.bodies, 'titan')!
        const saturn = findBody(sim.bodies, 'saturn')!
        extract(titan, 'strip', 0.0002, saturn.vel)

        sim.tick(70)
        sim.drainEvents()
        expect(sim.tracker.heldBand('titan'), label).toBe('critical')
        const devAtIntervention = deviationOf(titan, sim.bodies)

        const radial = norm(sub(titan.pos, saturn.pos))
        sim.addFab({ x: titan.pos.x + radial.x * offset, y: titan.pos.y + radial.y * offset }, fabMass)

        const titanCatastrophes: SimEvent[] = []
        for (let t = 70; t < 600; t += 2) {
          sim.tick(2)
          for (const e of sim.drainEvents()) {
            if (isCatastrophe(e) && e.body === 'titan') titanCatastrophes.push(e)
          }
        }

        const endDev = deviationOf(titan, sim.bodies)
        const endBand = sim.tracker.heldBand('titan')
        // eslint-disable-next-line no-console
        console.log(`rescue grid ${label}: catastrophes=${titanCatastrophes.length}`,
          `endBand=${endBand} devAtIntervention=${devAtIntervention.toFixed(4)} endDev=${endDev.toFixed(4)}`)

        expect(titanCatastrophes, label).toEqual([])
        expect(endBand, label).not.toBe('critical')
        expect(endDev, label).toBeLessThan(devAtIntervention)
      }
    }
  })

  // --- Sacred proof 2: ship-assist healing kills the flapping zone --------
  //
  // Amendment 10: dose 0.00005 on titan is the permanent flapping-klaxon
  // zone — band events forever (~283 tu epicyclic period), no cascade, and
  // (pre-PD) no healing: returnSlag's vis-viva accretion at the literal
  // extracted mass is provably negligible for a body titan's size. The PD
  // ship assist (amendment 11(c)) does the ORBITAL healing; the slag mass
  // does the budget/coupling healing. Durability: after the ship leaves
  // (setShipAssist(null)), the healed orbit must stay quiet on its own —
  // healing is a genuinely re-circularized orbit, not a force-dependent hold.
  it('ship-assist healing: heals titan out of the flapping zone, durably', () => {
    // Control: flapping continues for the whole 600 tu window, including
    // late (after t=300) — this is a real perpetual-klaxon zone, not a
    // transient that dies down by itself.
    const control = new Sim(envelope)
    const ct = findBody(control.bodies, 'titan')!
    const cs = findBody(control.bodies, 'saturn')!
    extract(ct, 'strip', 0.00005, cs.vel)
    let controlEventsLate = 0
    for (let t = 0; t < 600; t += 10) {
      control.tick(10)
      const n = control.drainEvents().filter(e => isBand(e) && e.body === 'titan').length
      if (t + 10 > 300) controlEventsLate += n
    }
    expect(controlEventsLate).toBeGreaterThan(0)

    // Healed: at t=100, station the ship (PD assist) and return the literal
    // extracted mass via vis-viva accretion.
    const healed = new Sim(envelope)
    const ht = findBody(healed.bodies, 'titan')!
    const hs = findBody(healed.bodies, 'saturn')!
    extract(ht, 'strip', 0.00005, hs.vel)
    healed.tick(100)
    healed.drainEvents()
    healed.setShipAssist('titan')
    returnSlag(ht, 0.00005, hs)

    let firstScore100At = -1
    let bandEventsAfter100 = 0
    for (let t = 100; t < 600; t += 10) {
      healed.tick(10)
      const titanBand = healed.drainEvents().filter(e => isBand(e) && e.body === 'titan').length
      // Events strictly after the sampled point where the score first read 100.
      if (firstScore100At >= 0) bandEventsAfter100 += titanBand
      if (firstScore100At < 0 && scoreOf(ht, healed.bodies, envelope) === 100) firstScore100At = t + 10
    }
    const finalBand = healed.tracker.heldBand('titan')
    // eslint-disable-next-line no-console
    console.log('healing: firstScore100At=', firstScore100At,
      'bandEventsAfter100=', bandEventsAfter100, 'finalBand=', finalBand)

    expect(firstScore100At).toBeGreaterThan(100)
    expect(bandEventsAfter100).toBe(0)
    expect(finalBand).toBe('green')

    // Durability: healing survives the ship leaving.
    healed.setShipAssist(null)
    healed.tick(50)
    expect(healed.drainEvents()).toEqual([])
  })

  // --- Sacred proof 3: real-mass fab proximity is inert -------------------
  //
  // Amendment 11(a)/(e): fabs are cargo-built — the whole minable pool is
  // ≈0.148, so a real fab weighs ≤~0.05. At that mass a fab parked right
  // outside a moon's orbit is dynamically irrelevant: no capture chaos, no
  // planet perturbation past envelope+margin, no false alarms — and the
  // envelope-gated PD force is exactly zero for every healthy body by
  // construction. (The moons themselves can NEVER feel fab gravity at all —
  // cross-layer bodies are gravitationally invisible, amendment 1.)
  //
  // MEASURED FINDING (ganymede fab attrition — reported per this task's
  // "try offset 8-12 before weakening anything" instruction): the titan
  // fab (13+6 = 19 from saturn, 1.07 Hill radii) parks cleanly — zero
  // events of ANY type through t=300, verified at offsets 6 through 15.
  // The GANYMEDE fab cannot park at all: ganymede orbits at 20.5 from
  // jupiter — OUTSIDE jupiter's Hill radius (13.9) — which only a moon can
  // do (moons integrate in the tide-exempt layer-2 frame, amendment 1);
  // any HELIO-layer body placed 6-15 units further out (1.9-2.6 r_H) is in
  // jupiter's chaotic co-orbital annulus, where every init family tried
  // (sun-circular, circular-retrograde DRO, quasi-satellite epicycle —
  // wrong- and right-phased) is captured and swallowed by jupiter within
  // 300 tu. That loss is a quiet gameplay setback (fabLost), NOT chaos:
  // it perturbs nothing — zero band events, zero catastrophes, and the
  // jupiter trio never notices. This test asserts exactly that measured
  // reality: full inertness everywhere, titan-fab parking survives, and
  // the ONLY event the run may produce is the ganymede fab's own silent
  // fabLost. (Task 9 placement guidance: park counterweights at
  // 0.3-1.2 r_H of the parent planet — the ganymede/io/europa assist fab
  // belongs INSIDE jupiter's Hill sphere, where ASSIST_RANGE=40 still
  // covers the whole trio.)
  it('real-mass fab proximity is inert: no false alarms, no chaos, titan parking survives', () => {
    const sim = new Sim(envelope)
    const titan = findBody(sim.bodies, 'titan')!
    const saturn = findBody(sim.bodies, 'saturn')!
    const tRadial = norm(sub(titan.pos, saturn.pos))
    const titanFab = sim.addFab({ x: titan.pos.x + tRadial.x * 6, y: titan.pos.y + tRadial.y * 6 }, 0.05)

    const ganymede = findBody(sim.bodies, 'ganymede')!
    const jupiter = findBody(sim.bodies, 'jupiter')!
    const gRadial = norm(sub(ganymede.pos, jupiter.pos))
    const ganymedeFab = sim.addFab({ x: ganymede.pos.x + gRadial.x * 6, y: ganymede.pos.y + gRadial.y * 6 }, 0.05)

    sim.tick(300)
    const events = sim.drainEvents()
    // eslint-disable-next-line no-console
    console.log('proximity events:', events)
    expect(events.filter(isBand)).toEqual([])
    expect(events.filter(isCatastrophe)).toEqual([])
    // Titan-side parking is stable — that fab must survive untouched.
    expect(events.filter(e => isFabLost(e) && e.fab === titanFab.name)).toEqual([])
    // Only permissible event: the ganymede fab's own silent loss (see the
    // measured-finding comment above — it orbits outside jupiter's Hill
    // radius, unreachable parking for any helio-layer body).
    expect(events.filter(e => !(isFabLost(e) && e.fab === ganymedeFab.name))).toEqual([])
  })
})
