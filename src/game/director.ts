// Game director (Task 9): the run state machine that turns the closed
// physics core (Sim facade) into gameplay — target selection, transits,
// extraction, slag healing, sphere-segment construction, win/lose.
//
// Amendment compliance (AMENDMENTS LOG, docs/superpowers/plans/
// 2026-07-21-celestial-counterweight.md — binding):
//  - 9:  extract() is always called with the 4-arg refVel form (the orbital
//        PARENT's velocity, resolved via parentName), and the director
//        enforces the EXTRACTION_FLOOR husk guard.
//  - 10: 'catastrophe' events end the run; 'fabLost' is only a setback.
//  - 11: slag mode stations the ship (setShipAssist) — the PD force does the
//        orbital healing, the returned mass does the budget healing; fabs are
//        built FROM cargo, so segment mass = delivered cargo.
//  - 12: addFab may return null (mass-ratio / separation guards) — placement
//        tries fallbacks, keeps cargo on rejection, and the decision-window
//        expiry retries a guaranteed-legal far spot; launch() ends stationing;
//        phobos is flagged 'fragile' (effectively unrescuable — mars is a
//        fab-exclusion zone).
import { Sim, type SimEvent } from '../sim/sim'
import type { Body } from '../sim/body'
import { findBody } from '../sim/data'
import { circularSpeed } from '../sim/integrator'
import { bandOf } from '../sim/stability'
import { extract, returnSlag } from '../sim/mining'
import { dist, norm, sub, v, type Vec } from '../sim/vec'
import {
  RATE, RATE_SLAG, EXTRACTION_FLOOR, SPHERE_MASS_REQUIRED,
  SIM_RATE, TRAVEL_SPEED, MIN_TRANSIT, MAX_TRANSIT, SLINGSHOT_BONUS, DECISION_WINDOW,
  FAB_MASS_RATIO_MAX, FAB_MIN_SEPARATION,
} from '../constants'

export type DirectorState = 'orrery' | 'transit' | 'mining' | 'constructing' | 'won' | 'lost'
export type ExtractionMode = 'strip' | 'lattice' | 'slag'
export type BodyRisk = 'standard' | 'fragile' | 'trophy'

export type DirectorEvent =
  | { type: 'placementRejected' }
  | { type: 'extractionFloor'; body: string }
  | { type: 'riskWarning'; body: string; risk: 'fragile' }
export type GameEvent = SimEvent | DirectorEvent

// Construction anchor: where sphere segments are assembled — a spot on a
// sun orbit inside mercury's. Sun-bound placements skip the mass-ratio
// guard, and radius 25–35 is the guaranteed-legal band the expiry retry
// scans (see placeFar).
const FAB_ANCHOR_RADIUS = 30

// Where the ship "parks" relative to a body it is stationed at.
const STATION_OFFSET = 2

export class Director {
  sim: Sim
  state: DirectorState = 'orrery'
  cargo = 0

  private sphereMass = 0
  private target: string | null = null // 'fab' or a body name
  // Where the ship currently is (for transit distances and hasty placement).
  // 'start' = the sim's initial ship body position (near earth).
  private location: { kind: 'start' } | { kind: 'body'; name: string } | { kind: 'anchor' } =
    { kind: 'start' }
  private transitLeft = 0
  private transitTotal = 1 // full transit duration, for the visual fly-along + HUD bar
  private transitFrom = v(0, 0) // ship position at launch, lerped toward the target
  private burnUsed = false
  private decisionLeft = 0
  private mode: ExtractionMode | null = null
  private pending: GameEvent[] = []

  // envelope: optional precomputed baseline envelope, passed straight
  // through to Sim (test/bot speedup — see the Sim constructor doc).
  constructor(envelope?: Record<string, number>) {
    this.sim = new Sim(envelope)
  }

  // ---- read-only queries -------------------------------------------------

  sphereProgress(): number {
    return (100 * this.sphereMass) / SPHERE_MASS_REQUIRED
  }

  transitRemaining(): number {
    return this.state === 'transit' ? this.transitLeft : 0
  }

  // 0→1 progress along the current transit (for the HUD "en route" bar).
  transitProgress(): number {
    if (this.state !== 'transit' || this.transitTotal <= 0) return 0
    return Math.min(1, Math.max(0, 1 - this.transitLeft / this.transitTotal))
  }

  decisionRemaining(): number {
    return this.state === 'constructing' ? Math.max(0, this.decisionLeft) : 0
  }

  currentTarget(): string | null {
    return this.target
  }

  // The extraction mode currently running (null when none is engaged — e.g.
  // not mining, or the floor auto-stopped it). The HUD (Task 14) surfaces
  // this as the active mining-mode indicator; scenario bots (Task 10) poll
  // it to detect the extraction-floor auto-stop without touching internals.
  activeExtraction(): ExtractionMode | null {
    return this.mode
  }

  // Risk tag for the HUD/mining UI.
  //  - phobos: ~40× more dose-fragile than titan AND effectively unrescuable
  //    (mars-bound fabs are rejected by the mass-ratio guard, amendment 12(d)).
  //  - mars: the biggest fairness trap in the build — it holds 73% of the
  //    nominal minable pool, but mining it in ANY mode fatally destabilizes
  //    phobos, and mars is a fab-exclusion zone (amendment 12(a)) so no
  //    counterweight can save phobos. Telegraphed 'fragile' so the HUD can
  //    warn before a player wastes a run on the poisoned pool.
  //  - jupiter trio: near-massless (amendment 3), negligible cargo — trophy
  //    targets only.
  bodyRisk(name: string): BodyRisk {
    if (name === 'phobos' || name === 'mars') return 'fragile'
    if (name === 'io' || name === 'europa' || name === 'ganymede') return 'trophy'
    return 'standard'
  }

  // Director-level events (placementRejected / extractionFloor) merged with
  // the sim's own, in the order they occurred.
  drainEvents(): GameEvent[] {
    const out: GameEvent[] = [...this.pending, ...this.sim.drainEvents()]
    this.pending = []
    return out
  }

  // ---- player actions ----------------------------------------------------

  selectTarget(name: string): void {
    if (this.state !== 'orrery' && this.state !== 'mining' && this.state !== 'constructing') return
    if (name !== 'fab' && !findBody(this.sim.bodies, name)) {
      throw new Error(`selectTarget: unknown target '${name}'`)
    }
    this.target = name
    // Telegraph the fairness traps (mars/phobos) the moment they're picked —
    // the HUD (Task 14) surfaces this before the player commits a transit.
    if (name !== 'fab' && this.bodyRisk(name) === 'fragile') {
      this.pending.push({ type: 'riskWarning', body: name, risk: 'fragile' })
    }
  }

  // Clear the current selection. Only meaningful in 'orrery' (before a course is
  // plotted) — once transiting/mining/constructing the ship is committed to its
  // target, so deselect is a no-op there. Lets the player click empty space (or
  // the HUD ✕) to back out of a pick.
  clearTarget(): void {
    if (this.state === 'orrery') this.target = null
  }

  launch(): void {
    if (this.state !== 'orrery' && this.state !== 'mining' && this.state !== 'constructing') return
    if (!this.target) return
    // Amendment 12(b/c): departure ENDS stationing — the ship-assist PD hold
    // is gone the moment the ship leaves (a held body may resume dying);
    // any extraction in progress stops too.
    this.sim.setShipAssist(null)
    this.mode = null
    this.decisionLeft = 0
    // Clamp every trip to a snappy, always-visible window regardless of how far
    // the target is — a raw distance/speed transit made far bodies (Titan) a
    // ~13s silent wait, which reads as "nothing is happening".
    const from = this.shipPos()
    const d = dist(from, this.targetPos(this.target))
    this.transitFrom = from
    this.transitLeft = Math.min(Math.max(d / TRAVEL_SPEED, MIN_TRANSIT), MAX_TRANSIT)
    this.transitTotal = this.transitLeft
    this.burnUsed = false
    this.state = 'transit'
  }

  // Slingshot: once per transit, cut the remaining time.
  burn(): void {
    if (this.state !== 'transit' || this.burnUsed) return
    this.transitLeft *= 1 - SLINGSHOT_BONUS
    this.burnUsed = true
  }

  chooseExtraction(mode: ExtractionMode): void {
    if (this.state !== 'mining' || !this.target || this.target === 'fab') return
    this.mode = mode
    // Amendment 11(c): Return Slag stations the ship — its PD assist does
    // the orbital healing while the returned mass heals the budget. The
    // assist stays on after the cargo runs out (stationed) until launch().
    //
    // chooseExtraction('slag') with cargo === 0 is an INTENTIONAL move, not a
    // no-op edge case: it engages ship-assist and holds the body at its
    // envelope while no mass flows — "station and hold this orbit while I go
    // fetch a counterweight fab". The PD hold buys time; the mass (when a
    // later slag run brings some) does the durable budget/coupling healing.
    if (mode === 'slag') this.sim.setShipAssist(this.target)
  }

  placeSegment(flavor: 'suggested' | 'hasty'): void {
    if (this.state !== 'constructing' || this.cargo <= 0) return
    let fab: Body | null
    if (flavor === 'suggested') {
      const base = this.suggestedBase()
      fab = base ? this.tryPlaceWithFallbacks(base) : this.placeFar()
    } else {
      fab = this.tryPlaceWithFallbacks(this.shipPos())
    }
    if (fab) {
      this.commitPlacement()
    } else {
      // Amendment 12(a): addFab legitimately rejected every candidate. KEEP
      // the cargo and stay in the decision window — expiry auto-retries at a
      // guaranteed-legal far spot. Cargo is never silently lost.
      this.pending.push({ type: 'placementRejected' })
    }
  }

  // ---- the clock ---------------------------------------------------------

  advance(dtReal: number): void {
    if (this.state === 'won' || this.state === 'lost') return
    const dt = dtReal * SIM_RATE
    this.sim.tick(dt)
    const evs = this.sim.drainEvents()
    this.pending.push(...evs)
    // Amendment 10: any 'catastrophe' ends the run; 'fabLost' is a setback
    // (invested mass gone) and the run continues.
    if (evs.some(e => e.type === 'catastrophe')) {
      this.state = 'lost'
      return
    }

    if (this.state === 'transit') {
      this.transitLeft -= dt
      // Fly the ship marker from its launch point to the (moving) target so the
      // journey is visible on screen — smoothstep for an ease-in/out glide.
      const to = this.targetPos(this.target!)
      const p = this.transitProgress()
      const e = p * p * (3 - 2 * p)
      const ship = findBody(this.sim.bodies, 'ship')
      if (ship) {
        ship.pos = v(
          this.transitFrom.x + (to.x - this.transitFrom.x) * e,
          this.transitFrom.y + (to.y - this.transitFrom.y) * e,
        )
      }
      if (this.transitLeft <= 0) this.arrive()
      return
    }

    if (this.state === 'mining' && this.mode) {
      this.stepExtraction(dt)
      return
    }

    if (this.state === 'constructing') {
      this.decisionLeft -= dt
      if (this.decisionLeft <= 0) this.expireDecision()
    }
  }

  // ---- internals ---------------------------------------------------------

  private arrive(): void {
    this.transitLeft = 0
    if (this.target === 'fab') {
      this.location = { kind: 'anchor' }
      this.state = 'constructing'
      this.decisionLeft = DECISION_WINDOW
    } else {
      this.location = { kind: 'body', name: this.target! }
      this.state = 'mining'
    }
    this.syncShipBody()
  }

  private stepExtraction(dt: number): void {
    const body = findBody(this.sim.bodies, this.target!)
    const parent = body?.parentName ? findBody(this.sim.bodies, body.parentName) : undefined
    if (!body || !parent) return

    if (this.mode === 'slag') {
      const dm = Math.min(RATE_SLAG * dt, this.cargo)
      if (dm > 0) {
        returnSlag(body, dm, parent)
        this.cargo -= dm
      }
      if (this.cargo <= 1e-12) {
        this.cargo = 0
        // Mode auto-clears; the ship-assist stationing STAYS on (amendment
        // 11(c)) — cleared only by launch().
        this.mode = null
      }
      return
    }

    // strip / lattice. Husk guard (amendment 9): mine the PARTIAL dose down
    // toward the floor rather than refusing the whole dose — this leaves no
    // stranded mass and keeps accounting dt-invariant. Note extract() clamps
    // each call to mass/2, so a body converges to its floor over REPEATED
    // advances (mass halves until < 2·floor, then lands exactly on floor); a
    // single big-dt advance does not exhaust it in one step. Task 10 bots must
    // loop until `mode` clears, not assume one tick drains a body. Only when
    // there is zero headroom left do we refuse and auto-stop the mode
    // (extractionFloor fires once per (re)selection).
    const floor = EXTRACTION_FLOOR * body.m0
    const dm = Math.min(RATE[this.mode as 'strip' | 'lattice'] * dt, body.mass - floor)
    if (dm <= 0) {
      this.mode = null
      this.pending.push({ type: 'extractionFloor', body: body.name })
      return
    }
    // refVel is REQUIRED (amendment 9): the orbital parent's velocity —
    // moons use the parent planet's vel, mars (parent 'sun') the sun's.
    const result = extract(body, this.mode as 'strip' | 'lattice', dm, parent.vel)
    this.cargo += result.cargo
  }

  private expireDecision(): void {
    this.decisionLeft = 0
    if (this.cargo <= 0) {
      this.state = 'orrery'
      return
    }
    // Auto-place hasty; if the ship's spot (and its fallbacks) are all
    // rejected, fall back to the guaranteed-legal far scan.
    const fab = this.tryPlaceWithFallbacks(this.shipPos()) ?? this.placeFar()
    if (fab) {
      this.commitPlacement()
      return
    }
    // Effectively unreachable (placeFar scans a whole sun-bound annulus,
    // where only the separation guard applies) — but cargo is sacred: emit
    // and keep the window running rather than ever losing it.
    this.pending.push({ type: 'placementRejected' })
    this.decisionLeft = DECISION_WINDOW
  }

  private commitPlacement(): void {
    this.sphereMass += this.cargo
    this.cargo = 0
    this.state = this.sphereProgress() >= 100 ? 'won' : 'orrery'
  }

  // Try the base position, then up to 4 fallbacks at increasing offsets and
  // rotating angles (each hop clears FAB_MIN_SEPARATION, so a base rejected
  // for sitting on a live fab is recovered by the first fallback).
  private tryPlaceWithFallbacks(base: Vec): Body | null {
    const candidates: Vec[] = [base]
    for (let k = 1; k <= 4; k++) {
      const ang = (k * Math.PI) / 2
      const off = FAB_MIN_SEPARATION * (1 + 0.35 * k)
      candidates.push(v(base.x + Math.cos(ang) * off, base.y + Math.sin(ang) * off))
    }
    for (const pos of candidates) {
      const fab = this.sim.addFab(pos, this.cargo)
      if (fab) return fab
    }
    return null
  }

  // 'suggested' placement: near the worst-heldScore tracked body whose
  // primary passes the mass-ratio guard (amendment 12(a) — e.g. mars-bound
  // placements are skipped for any cargo > FAB_MASS_RATIO_MAX·0.11), offset
  // a few units outside the body. For moons the planet-centric radius is
  // clamped to 1.2 Hill radii — the Task 8 measured stability limit
  // (ganymede orbits OUTSIDE jupiter's Hill sphere; a fab parked beyond it
  // is swallowed within ~300 tu, so the trio's counterweight belongs inside,
  // where ASSIST_RANGE still covers all three).
  private suggestedBase(): Vec | null {
    let best: Body | null = null
    let bestScore = Infinity
    for (const b of this.sim.bodies) {
      if (!b.parentName || b.kind === 'ship' || b.kind === 'fab' || b.rNom === 0) continue
      const primary = b.kind === 'moon' ? findBody(this.sim.bodies, b.parentName) : b
      if (!primary) continue
      if (this.cargo / primary.mass > FAB_MASS_RATIO_MAX) continue
      const score = this.sim.tracker.heldScore(b.name)
      if (score < bestScore) {
        bestScore = score
        best = b
      }
    }
    // All-green fallback: if nothing is wobbling (every candidate at a green
    // heldScore) there is no body worth counterweighting — park the segment
    // in the sun annulus (via placeFar) rather than crowding a calm planet.
    if (!best || bandOf(bestScore) === 'green') return null
    const parent = findBody(this.sim.bodies, best.parentName!)!
    const radial = norm(sub(best.pos, parent.pos))
    if (best.kind === 'moon') {
      const sun = findBody(this.sim.bodies, 'sun')!
      const aP = dist(parent.pos, sun.pos)
      const rHill = aP * Math.cbrt(parent.mass / (3 * sun.mass))
      const r = Math.min(dist(best.pos, parent.pos) + best.radius + 4, 1.2 * rHill)
      return v(parent.pos.x + radial.x * r, parent.pos.y + radial.y * r)
    }
    const off = best.radius + 4
    return v(best.pos.x + radial.x * off, best.pos.y + radial.y * off)
  }

  // Guaranteed-legal placement of last resort: scan a sun-bound annulus
  // (radius 25–35 — sun-bound placements skip the mass-ratio guard, so only
  // the FAB_MIN_SEPARATION guard applies) until addFab accepts.
  private placeFar(): Body | null {
    const sun = findBody(this.sim.bodies, 'sun')!
    for (const r of [FAB_ANCHOR_RADIUS, 25, 35, 28, 33]) {
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * 2 * Math.PI
        const pos = v(sun.pos.x + Math.cos(ang) * r, sun.pos.y + Math.sin(ang) * r)
        const fab = this.sim.addFab(pos, this.cargo)
        if (fab) return fab
      }
    }
    return null
  }

  private anchorPos(): Vec {
    const sun = findBody(this.sim.bodies, 'sun')!
    return v(sun.pos.x + FAB_ANCHOR_RADIUS, sun.pos.y)
  }

  private targetPos(name: string): Vec {
    if (name === 'fab') return this.anchorPos()
    return { ...findBody(this.sim.bodies, name)!.pos }
  }

  // The ship's effective position: stationed just outside its current body
  // (along the radial from that body's parent), at the construction anchor,
  // or wherever the sim's ship body started.
  private shipPos(): Vec {
    if (this.location.kind === 'body') {
      const b = findBody(this.sim.bodies, this.location.name)
      if (b) {
        const parent = b.parentName ? findBody(this.sim.bodies, b.parentName) : undefined
        const radial = parent ? norm(sub(b.pos, parent.pos)) : v(1, 0)
        const off = b.radius + STATION_OFFSET
        return v(b.pos.x + radial.x * off, b.pos.y + radial.y * off)
      }
    }
    if (this.location.kind === 'anchor') return this.anchorPos()
    const ship = findBody(this.sim.bodies, 'ship')!
    return { ...ship.pos }
  }

  // Cosmetic sync of the sim's ship body (mass 1e-9, catastrophe-immune) so
  // renderers/HUD (Tasks 11-14) see the ship where the director says it is.
  private syncShipBody(): void {
    const ship = findBody(this.sim.bodies, 'ship')
    if (!ship) return
    const pos = this.shipPos()
    ship.pos = { ...pos }
    if (this.location.kind === 'body') {
      const b = findBody(this.sim.bodies, this.location.name)
      if (b) ship.vel = { ...b.vel }
    } else if (this.location.kind === 'anchor') {
      const sun = findBody(this.sim.bodies, 'sun')!
      const radial = norm(sub(pos, sun.pos))
      const vc = circularSpeed(sun.mass, dist(pos, sun.pos))
      ship.vel = v(sun.vel.x - radial.y * vc, sun.vel.y + radial.x * vc)
    }
  }
}
