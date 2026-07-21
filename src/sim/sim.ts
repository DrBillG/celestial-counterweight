import type { Body } from './body'
import { makeBody } from './body'
import { buildSystem, findBody } from './data'
import { stepHierarchical, circularSpeed, type ExtraAccel } from './integrator'
import {
  StabilityTracker,
  deviationOf,
  computeBaselineEnvelope,
  harmony as harmonyOf,
  type BandEvent,
} from './stability'
import { dist, norm, sub, v, type Vec } from './vec'
import { DT, RUNAWAY_ACCEL, EJECT_RADIUS, ASSIST_K, ASSIST_RANGE } from '../constants'

export type SimEvent =
  | ({ type: 'band' } & BandEvent)
  | { type: 'catastrophe'; kind: 'collision' | 'ejection' | 'sundive'; body: string; other?: string }
  // Fab losses are gameplay setbacks (invested mass gone), not game-over
  // events — Task 9's director loses only on 'catastrophe'. Fired instead of
  // 'catastrophe' whenever the DYING body is a fab (collision, ejection, or
  // sundive); the celestial body it hit, if any, survives.
  | { type: 'fabLost'; fab: string; cause: 'collision' | 'ejection' | 'sundive'; other?: string }

// Sim: the facade tests/game/director.ts talks to. Wires together the
// hierarchical integrator, the envelope-calibrated stability tracker, and
// the game-designed extra accelerations (runaway instability + fab
// station-keeping assist), then layers catastrophe detection on top
// (amendment 6 — see AMENDMENTS LOG item 6 in the plan doc).
export class Sim {
  bodies: Body[] = buildSystem()
  // Computed once per Sim (fresh deterministic null run, ~0.3s) — never
  // hard-coded (amendment 4) unless the caller supplies a precomputed one.
  envelope: Record<string, number>
  tracker: StabilityTracker

  private events: SimEvent[] = []
  private dead = new Set<string>()

  // envelope: optional precomputed baseline envelope (from
  // computeBaselineEnvelope()) — test suites / scenario bots that spin up
  // many Sim instances can compute it once and share it, skipping the ~0.3s
  // null probe on every construction. Omit to compute fresh (default,
  // correct-by-construction behavior for real gameplay).
  constructor(envelope?: Record<string, number>) {
    this.envelope = envelope ?? computeBaselineEnvelope()
    this.tracker = new StabilityTracker(this.bodies, this.envelope)
  }

  // Mass-read workaround (sanctioned pattern, amendment 2 + Task 7 prompt):
  // extraAccel is forbidden from reading ANY body's .mass (or .vel) because
  // stepHierarchical temporarily boosts a planet's mass by its moons' mass
  // during layer 1 evaluation. Fab mass only changes between ticks (via
  // game actions like addFab / future refuel), never mid-tick, so we
  // snapshot it once at the top of tick() and read the snapshot (never
  // `fab.mass`) inside the callback. Positions are read live because those
  // ARE safe under the contract.
  private fabMasses = new Map<string, number>()

  harmony(): number {
    return harmonyOf(this.bodies, this.envelope)
  }

  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // Fabs orbit the sun in a circular orbit at r = |pos|, placed on the SAME
  // bodies array the tracker already holds a reference to — we must NOT
  // construct a new StabilityTracker here (amendment 7: that would discard
  // every other body's held instant-worsen/slow-recover alarm state).
  // Fabs themselves are never score-tracked (StabilityTracker.tracked()
  // excludes kind 'fab'), so there is no track() call to make for the fab
  // itself either.
  addFab(pos: Vec, mass: number): Body {
    const sun = findBody(this.bodies, 'sun')!
    const r = dist(pos, sun.pos)
    const vCirc = circularSpeed(sun.mass, r)
    const radial = norm(sub(pos, sun.pos))
    const tangent = v(-radial.y, radial.x)
    const name = `fab-${this.bodies.filter(b => b.kind === 'fab').length + 1}`
    const fab = makeBody({
      name,
      kind: 'fab',
      mass,
      pos: { ...pos },
      vel: { x: sun.vel.x + tangent.x * vCirc, y: sun.vel.y + tangent.y * vCirc },
      radius: 1.2,
      parentName: 'sun',
      rNom: r,
    })
    this.bodies.push(fab)
    return fab
  }

  // Extra accelerations injected into stepHierarchical. Position/game-state
  // only — see the doc comment on ExtraAccel in integrator.ts and amendment
  // 2: no b.vel, no b.mass (or any other body's .mass) may be read here.
  private extraAccel: ExtraAccel = (b) => {
    if (!b.parentName) return v(0, 0)
    const parent = findBody(this.bodies, b.parentName)
    if (!parent) return v(0, 0)

    let ax = 0
    let ay = 0
    const d = dist(b.pos, parent.pos)
    const radial = d === 0 ? v(0, 0) : norm(sub(b.pos, parent.pos))

    // 1. Designed runaway: past critical, deviation compounds outward (or
    // inward, if the body has already contracted past nominal — e.g. a
    // post-mining moon recoiling retrograde toward its parent, amendment 6).
    if (b.kind !== 'ship' && b.kind !== 'fab' && this.tracker.heldBand(b.name) === 'critical') {
      const dev = deviationOf(b, this.bodies)
      const sign = d >= b.rNom ? 1 : -1
      // Retuned ×100 -> ×10 (coordinator fix #2): ~0.47x central gravity at
      // the critical threshold — still positive-feedback compounding, but
      // rescuable early via station-keeping assist (Task 8).
      const mag = RUNAWAY_ACCEL * dev * 10 * sign
      ax += radial.x * mag
      ay += radial.y * mag
    }

    // 2. Station-keeping assist: every fab within ASSIST_RANGE of this body
    // pulls it back toward its own nominal radius. Uses the fab-mass
    // SNAPSHOT taken at the top of tick(), never fab.mass directly (that
    // read would violate the position/state-only ExtraAccel contract).
    for (const fab of this.bodies) {
      if (fab.kind !== 'fab' || fab === b) continue
      const fabMass = this.fabMasses.get(fab.name)
      if (fabMass === undefined) continue
      const fd = dist(fab.pos, b.pos)
      if (fd === 0 || fd > ASSIST_RANGE) continue
      const restore = (ASSIST_K * fabMass) / (fd * fd)
      const sign = d >= b.rNom ? -1 : 1 // pull back toward nominal radius
      ax += radial.x * restore * sign
      ay += radial.y * restore * sign
    }

    return v(ax, ay)
  }

  tick(tu: number): void {
    // Snapshot fab masses OUTSIDE the integrator callback, ONCE per tick()
    // call (not once per substep, coordinator fix #5) — fab mass only
    // changes BETWEEN ticks via game actions (addFab / future refuel),
    // never mid-tick, so one snapshot is consistent for every substep and
    // every extraAccel invocation (layer-1 a1/a2 plus layer-2 per-moon
    // evaluations) within this tick.
    this.fabMasses.clear()
    for (const b of this.bodies) {
      if (b.kind === 'fab') this.fabMasses.set(b.name, b.mass)
    }

    const steps = Math.ceil(tu / DT)
    for (let i = 0; i < steps; i++) {
      stepHierarchical(this.bodies, DT, this.extraAccel)
      for (const ev of this.tracker.update(this.bodies)) {
        this.events.push({ type: 'band', ...ev })
      }
      this.detectCatastrophes()
    }
  }

  // Amendment 6 — fully replaces the plan's original catastrophe model.
  // Coordinator fixes #1 (fabLost semantics) and #4 (zombie moons) layered
  // on top.
  private detectCatastrophes(): void {
    const sun = findBody(this.bodies, 'sun')!
    for (const b of this.bodies) {
      if (b.kind === 'star' || b.kind === 'ship' || this.dead.has(b.name)) continue

      let isZombieMoon = false

      if (b.kind === 'moon') {
        // Moons are evaluated RELATIVE to their parent, not heliocentric
        // EJECT_RADIUS (which stays for planets/heliocentric bodies) —
        // UNLESS the parent is already dead (zombie moon, coordinator fix
        // #4): there is no meaningful "relative to parent" frame once the
        // parent itself has had its catastrophe, so we fall through to the
        // heliocentric checks below instead of skipping detection entirely.
        const parent = findBody(this.bodies, b.parentName!)
        const parentAlive = !!parent && !this.dead.has(parent.name)
        if (parentAlive) {
          const relDist = dist(b.pos, parent!.pos)
          if (relDist < parent!.radius + b.radius) {
            this.dead.add(b.name)
            this.events.push({ type: 'catastrophe', kind: 'collision', body: b.name, other: parent!.name })
            continue
          }
          if (relDist > 3 * b.rNom) {
            this.dead.add(b.name)
            this.events.push({ type: 'catastrophe', kind: 'ejection', body: b.name })
            continue
          }
        } else {
          isZombieMoon = true
        }
      }

      if (b.kind !== 'moon' || isZombieMoon) {
        // Heliocentric checks: planets and fabs always; zombie moons too.
        const dSun = dist(b.pos, sun.pos)
        if (dSun > EJECT_RADIUS) {
          this.dead.add(b.name)
          if (b.kind === 'fab') this.events.push({ type: 'fabLost', fab: b.name, cause: 'ejection' })
          else this.events.push({ type: 'catastrophe', kind: 'ejection', body: b.name })
          continue
        }
        if (dSun < sun.radius + b.radius) {
          this.dead.add(b.name)
          if (b.kind === 'fab') this.events.push({ type: 'fabLost', fab: b.name, cause: 'sundive' })
          else this.events.push({ type: 'catastrophe', kind: 'sundive', body: b.name })
          continue
        }
      }

      // Body-body collisions among planets/moons/fabs (skip ship/sun pairs,
      // already handled above via parent-relative / heliocentric checks).
      for (const o of this.bodies) {
        if (o === b) continue
        if (o.kind === 'ship' || o.kind === 'star') continue
        if (this.dead.has(o.name)) continue

        // Coordinator fix #1a: moon<->fab pairs never interact — different
        // simulation layers (stepHierarchical), zero mutual gravity, so a
        // distance-only overlap check here would be a phantom collision.
        if ((b.kind === 'moon' && o.kind === 'fab') || (b.kind === 'fab' && o.kind === 'moon')) continue

        const overlap = (b.radius + o.radius) * 0.8
        if (dist(b.pos, o.pos) >= overlap) continue

        if (b.kind === 'fab') {
          // Coordinator fix #1b/c: the FAB dies (fabLost), never a
          // catastrophe; the celestial body it hit survives. fab<->fab
          // overlaps kill both fabs.
          this.dead.add(b.name)
          this.events.push({ type: 'fabLost', fab: b.name, cause: 'collision', other: o.name })
          if (o.kind === 'fab') {
            this.dead.add(o.name)
            this.events.push({ type: 'fabLost', fab: o.name, cause: 'collision', other: b.name })
          }
          break
        }
        if (o.kind === 'fab') {
          // b (planet/moon) survives an impact with a fab — the fab's own
          // death is handled when it is processed as `b` in its own turn.
          continue
        }

        this.dead.add(b.name)
        this.events.push({ type: 'catastrophe', kind: 'collision', body: b.name, other: o.name })
        break
      }
    }
  }
}
