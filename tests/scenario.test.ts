// Task 10 — Scenario bots: the proofs that the game is winnable, losable,
// and honest, plus the reference bot the final balance pass was tuned to.
//
// These bots are deterministic (no Math.random; the sim carries no RNG) and
// drive ONLY the public Director API a real player uses:
//   selectTarget · launch · burn · chooseExtraction · placeSegment ·
//   advance · state · cargo · sphereProgress · currentTarget · bodyRisk ·
//   drainEvents  (plus two read-only stability signals a HUD would surface:
//   sim.tracker.heldBand — the held stability band — and body mass, both of
//   which Tasks 11–14 will render). No bot pokes private director fields or
//   fabricates physics.
//
// Measured balance (see the block comment on SPHERE_MASS_REQUIRED in
// constants.ts, recorded from these bots): the EFFICIENT bot's achievable
// delivered pool under sustained best play is ≈0.021; SPHERE_MASS_REQUIRED
// was set to 0.012 (≈57% of it) so a careful player wins with comfortable
// margin while a reckless one reliably loses.
import { describe, it, expect } from 'vitest'
import { Director, type GameEvent, type DirectorState } from '../src/game/director'
import { computeBaselineEnvelope } from '../src/sim/stability'
import { findBody } from '../src/sim/data'
import { RUN_DURATION, SIM_RATE, EXTRACTION_FLOOR } from '../src/constants'

// Coordinator convention (sim.test.ts / director.test.ts): the ~0.3s
// deterministic null probe is computed ONCE at module top and shared into
// every Director (which forwards it to its Sim), so spinning up many bots
// stays cheap.
const envelope = computeBaselineEnvelope()

// One advance() granularity for every bot, in real-time units. With
// SIM_RATE=1 this is 2 tu of sim per step — coarse enough to be fast, fine
// enough that catastrophe/band detection (which runs per-DT substep inside
// tick) is never skipped.
const STEP = 2

// ---- read-only helpers a HUD would also use ------------------------------

function bodyMass(d: Director, name: string): number {
  const b = findBody(d.sim.bodies, name)
  return b ? b.mass : 0
}
function bodyFloor(d: Director, name: string): number {
  const b = findBody(d.sim.bodies, name)
  return b ? EXTRACTION_FLOOR * b.m0 : 0
}
// Held stability band (the signal Task 14's HUD renders as the klaxon). Safe
// before a body is ever perturbed — the tracker seeds every orbital body at
// construction — but guarded anyway.
function heldBand(d: Director, name: string): string {
  try {
    return d.sim.tracker.heldBand(name)
  } catch {
    return 'green'
  }
}

// Read the live director state as the WIDE union. Bots mutate d.state
// through method calls (advance/placeSegment/launch) that TS's control-flow
// analysis can't see into, so a bare `d.state` stays narrowed to whatever a
// prior `if` proved and later comparisons wrongly read as impossible. Going
// through this helper returns the full DirectorState each time and defeats
// that stale narrowing.
function stateOf(d: Director): DirectorState {
  return d.state
}

// Fly to a target and consume the whole transit. Returns tu elapsed.
function fly(d: Director, target: string): number {
  d.selectTarget(target)
  d.launch()
  const dt = d.transitRemaining() / SIM_RATE + 0.01
  d.advance(dt)
  return dt
}

// Scan freshly drained events; record any catastrophe (the loss trigger).
interface Loss {
  lost: boolean
  cause: string
  atTu: number
}
function scanLoss(d: Director, elapsed: number, loss: Loss): GameEvent[] {
  const evs = d.drainEvents()
  for (const e of evs) {
    if (e.type === 'catastrophe' && !loss.lost) {
      loss.lost = true
      loss.cause = `${e.kind}:${e.body}${e.other ? `->${e.other}` : ''}`
      loss.atTu = elapsed
    }
  }
  return evs
}

// ---- GREEDY BOT ----------------------------------------------------------
// Strip-mines the richest body (titan) relentlessly: never backs off, never
// rescues (no counterweight, no slag), dumps cargo HASTY the instant it is
// high, then charges straight back to keep stripping. The reckless-player
// proxy — banks fast, ignores the klaxon, and dies.
interface GreedyResult {
  state: string
  peakProgress: number
  loss: Loss
  elapsed: number
}
function runGreedy(d: Director): GreedyResult {
  const loss: Loss = { lost: false, cause: 'none', atTu: -1 }
  let elapsed = 0
  let peakProgress = 0
  elapsed += fly(d, 'titan')
  scanLoss(d, elapsed, loss)
  d.chooseExtraction('strip')
  while (elapsed < RUN_DURATION && stateOf(d) !== 'lost') {
    // keep stripping — re-arm if the floor auto-stopped the mode
    if (stateOf(d) === 'mining' && d.activeExtraction() == null) d.chooseExtraction('strip')
    // cargo high → dump it HASTY wherever we are, then run back to titan
    if (stateOf(d) === 'mining' && d.cargo > 0.004) {
      elapsed += fly(d, 'fab')
      scanLoss(d, elapsed, loss)
      d.placeSegment('hasty')
      for (let i = 0; i < 10 && stateOf(d) === 'constructing'; i++) {
        d.advance(STEP)
        elapsed += STEP
        scanLoss(d, elapsed, loss)
      }
      peakProgress = Math.max(peakProgress, d.sphereProgress())
      if (stateOf(d) === 'orrery') {
        elapsed += fly(d, 'titan')
        scanLoss(d, elapsed, loss)
        d.chooseExtraction('strip')
      }
      continue
    }
    d.advance(STEP)
    elapsed += STEP
    scanLoss(d, elapsed, loss)
  }
  peakProgress = Math.max(peakProgress, d.sphereProgress())
  return { state: stateOf(d), peakProgress, loss, elapsed }
}

// ---- EFFICIENT BOT -------------------------------------------------------
// Encodes the measured winning cadence (amendments 11–13): pick the richest
// SAFE body (never a 'fragile' one — that gate excludes mars & phobos),
// lattice-mine until its held band leaves green (amber = time to back off)
// OR the extraction floor auto-stops the mode, depart, and deliver the cargo
// as a 'suggested' segment. 'suggested' both credits the sphere AND drops a
// counterweight next to the just-mined body, whose PD assist holds it while
// its orbit heals back to green — so the next round can mine it again. The
// richest-first rule naturally realizes the titan → moon → jupiter-trio
// priority (the trio has the least headroom, so it is only ever reached if
// the real pool is exhausted, which never happens before the win).
//
// This is ALSO the reference bot the balance pass was tuned against.
const SAFE_ROTATION = ['titan', 'moon', 'io', 'europa', 'ganymede']

interface EfficientResult {
  state: string
  progress: number
  rounds: number
  loss: Loss
  elapsed: number
}
function runEfficient(d: Director): EfficientResult {
  const loss: Loss = { lost: false, cause: 'none', atTu: -1 }
  let elapsed = 0
  let rounds = 0
  while (elapsed < RUN_DURATION && stateOf(d) !== 'won' && stateOf(d) !== 'lost') {
    // richest SAFE body with mining headroom left above its floor
    let target: string | null = null
    let bestHeadroom = 1e-6
    for (const name of SAFE_ROTATION) {
      if (d.bodyRisk(name) === 'fragile') continue // NEVER mars/phobos
      const headroom = bodyMass(d, name) - bodyFloor(d, name)
      if (headroom > bestHeadroom) {
        bestHeadroom = headroom
        target = name
      }
    }
    if (!target) break

    elapsed += fly(d, target)
    scanLoss(d, elapsed, loss)
    if (stateOf(d) !== 'mining') break

    // Lattice-mine until the held band leaves green (back off at amber) or
    // the floor auto-stops the mode. heldBand is the polled stability signal;
    // band DirectorEvents in the drained stream say the same thing.
    d.chooseExtraction('lattice')
    while (elapsed < RUN_DURATION && stateOf(d) === 'mining' && d.activeExtraction() != null) {
      d.advance(STEP)
      elapsed += STEP
      scanLoss(d, elapsed, loss)
      if (heldBand(d, target) !== 'green') break // amber → back off
    }
    if (stateOf(d) === 'lost') break

    // Depart (ends any stationing) and deliver as a counterweight segment.
    if (stateOf(d) === 'mining' && d.cargo > 0) {
      elapsed += fly(d, 'fab')
      scanLoss(d, elapsed, loss)
      d.placeSegment('suggested')
      for (let i = 0; i < 12 && stateOf(d) === 'constructing'; i++) {
        d.advance(STEP)
        elapsed += STEP
        scanLoss(d, elapsed, loss)
      }
    }
    rounds++
    if (rounds > 400) break // safety valve; the real win takes < 10 rounds
  }
  return { state: stateOf(d), progress: d.sphereProgress(), rounds, loss, elapsed }
}

describe('Scenario bots (Task 10): winnable · losable · honest', () => {
  // 1. GREEDY LOSES ---------------------------------------------------------
  it('greedy bot (relentless titan strip, no rescue) loses within RUN_DURATION', () => {
    const d = new Director(envelope)
    const r = runGreedy(d)
    expect(r.state).toBe('lost')
    expect(r.loss.lost).toBe(true)
    expect(r.loss.atTu).toBeGreaterThan(0)
    expect(r.loss.atTu).toBeLessThan(RUN_DURATION)
    // The cause is a real physics catastrophe (titan cascade), not a timeout.
    expect(r.loss.cause).toContain('titan')
    // eslint-disable-next-line no-console
    console.log(`  greedy: lost at t=${r.loss.atTu} (${r.loss.cause}), peak ${r.peakProgress.toFixed(1)}%`)
  })

  // 2. EFFICIENT WINS -------------------------------------------------------
  it('efficient bot (mine→amber→counterweight cadence) wins within RUN_DURATION', () => {
    const d = new Director(envelope)
    const r = runEfficient(d)
    expect(r.loss.lost).toBe(false)
    expect(r.state).toBe('won')
    expect(r.progress).toBeGreaterThanOrEqual(100)
    expect(r.elapsed).toBeLessThan(RUN_DURATION)
    // Comfortable, not knife-edge: the win lands with most of the run to spare.
    expect(r.elapsed).toBeLessThan(RUN_DURATION * 0.75)
    // eslint-disable-next-line no-console
    console.log(`  efficient: won at t=${r.elapsed.toFixed(0)} in ${r.rounds} rounds, ${r.progress.toFixed(1)}%`)
  })

  // 3. HONESTY: care beats recklessness ------------------------------------
  it('honesty property: efficient delivers strictly more sphere mass than greedy ever banks', () => {
    // Identical starting system (deterministic buildSystem + shared envelope).
    const greedy = runGreedy(new Director(envelope))
    const efficient = runEfficient(new Director(envelope))
    expect(greedy.state).toBe('lost')
    expect(efficient.state).toBe('won')
    // The core design goal, as an EXISTENCE proof: there exists a careful
    // strategy that wins and a reckless one that loses, on the identical
    // system. (This is not a universal claim that every reckless strategy
    // loses — the greedy bot here is one relentless-single-body-strip line;
    // it dies fast at t~87. Stronger honesty guarantees would need a family
    // of adversarial greedy variants.)
    expect(efficient.progress).toBeGreaterThan(greedy.peakProgress)
    // eslint-disable-next-line no-console
    console.log(`  honesty: efficient ${efficient.progress.toFixed(1)}% > greedy peak ${greedy.peakProgress.toFixed(1)}%`)
  })

  // 4. MARS IS A TELEGRAPHED TRAP (amendment 13) ----------------------------
  it('mars is a trap and the game says so: selecting warns, mining it loses', () => {
    // (a) selecting mars emits the riskWarning the HUD surfaces.
    const warnDir = new Director(envelope)
    warnDir.selectTarget('mars')
    const warned = warnDir
      .drainEvents()
      .some(e => e.type === 'riskWarning' && e.body === 'mars')
    expect(warned).toBe(true)

    // (b) a bot that ignores the warning and mines mars anyway loses — mining
    // mars in any mode fatally destabilizes phobos, which is unrescuable.
    const d = new Director(envelope)
    const loss: Loss = { lost: false, cause: 'none', atTu: -1 }
    let elapsed = 0
    elapsed += fly(d, 'mars')
    scanLoss(d, elapsed, loss)
    d.chooseExtraction('strip')
    while (elapsed < RUN_DURATION && stateOf(d) !== 'lost') {
      if (stateOf(d) === 'mining' && d.activeExtraction() == null) d.chooseExtraction('strip')
      d.advance(STEP)
      elapsed += STEP
      scanLoss(d, elapsed, loss)
    }
    expect(stateOf(d)).toBe('lost')
    expect(loss.cause).toContain('phobos') // the poisoned moon is what dies
    // eslint-disable-next-line no-console
    console.log(`  mars trap: lost at t=${loss.atTu} (${loss.cause})`)
  })

  // 5. NO-INPUT SAFETY ------------------------------------------------------
  it('no-input safety: a pristine system just advancing never self-destructs', () => {
    const d = new Director(envelope)
    let catastrophes = 0
    let bandEvents = 0
    for (let t = 0; t < RUN_DURATION; t += 10) {
      d.advance(10)
      for (const e of d.drainEvents()) {
        if (e.type === 'catastrophe') catastrophes++
        if (e.type === 'band') bandEvents++
      }
    }
    expect(catastrophes).toBe(0)
    expect(bandEvents).toBe(0) // the equilibrium holds the envelope — zero alarms
    expect(stateOf(d)).toBe('orrery') // still a valid, playable, non-lost state
    expect(d.sphereProgress()).toBe(0)
  })
})
