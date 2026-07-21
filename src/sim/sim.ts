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
import {
  G, DT, RUNAWAY_ACCEL, EJECT_RADIUS, ASSIST_K, ASSIST_MAX, ASSIST_RANGE, ENV_MARGIN,
  SHIP_ASSIST, DAMP_RATIO, ASSIST_SNAPSHOT_TU, FAB_MASS_RATIO_MAX, FAB_MIN_SEPARATION,
} from '../constants'

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

  // PD-controller snapshots (amendment 11(b), same sanctioned pattern as
  // fabMasses): the damping term needs a deviation RATE, but the ExtraAccel
  // contract forbids velocity reads. So — OUTSIDE the integrator callback —
  // we periodically snapshot each tracked body's signed radial deviation
  // s = (dist(body,parent) − rNom)/rNom and derive its finite-difference
  // rate sDot = (s − sPrev)/elapsed.
  //
  // Cadence (coordinator fix, Task 8 review): the snapshot pass re-runs
  // every ASSIST_SNAPSHOT_TU of substeps INSIDE tick(), keyed to the
  // ABSOLUTE substep count (stepCount), not to tick() call boundaries.
  // Two reasons: (1) a sDot frozen across a whole large tick is a stale
  // derivative at high gain — measured: tick(10)-frozen snapshots turned a
  // clean rescue into an ejection (relDist 5021); (2) substep-count keying
  // makes the trajectory EXACTLY independent of how callers partition
  // their tick() calls (tick(0.1)×6000 ≡ tick(10)×60, bitwise — pinned by
  // the tick-partition-invariance test in tests/rebalance.test.ts).
  // Edge cases: at the very first snapshot sDot = 0 (no history); a
  // tick(0) call runs zero substeps and touches nothing; `elapsed` is
  // derived from substep counts (integer) × DT, so it is exact and
  // identical for every partition of the same total time.
  private prevS = new Map<string, number>()
  private sDots = new Map<string, number>()
  private stepCount = 0      // total substeps ever run (absolute time base)
  private lastSnapStep = -1  // stepCount at the previous PD snapshot; -1 = never
  // Fractional-substep remainder (coordinator fix #5): tick(tu) runs
  // floor((remainder+tu)/DT) substeps and carries the rest forward, so
  // 60×tick(0.016) advances 0.96 tu (48 substeps), not 1.2. Part of Sim
  // state — determinism across identical call sequences is preserved.
  private tuRemainder = 0

  // Ship-assist target (amendment 11(c)): while set, the named body's PD
  // gain K gains a direct SHIP_ASSIST contribution — the ship stationed at
  // a body actively station-keeps it. Task 9 sets this during Return Slag
  // stationing (the ship does the ORBITAL healing; the returned slag mass
  // does the budget/coupling healing) and clears it when the ship leaves.
  //
  // Design intent (coordinator, Task 8 review): ship-only assist on a
  // CRITICAL body is an indefinite HOLD, not a recovery — SHIP_ASSIST
  // alone pins the deviation against the runaway but a full rescue needs a
  // counterweight fab's gain on top. That is the intentional "hold the
  // moon while you build the fab" mechanic, not a bug.
  private shipAssistTarget: string | null = null

  setShipAssist(bodyName: string | null): void {
    if (bodyName !== null && !findBody(this.bodies, bodyName)) {
      throw new Error(`setShipAssist: '${bodyName}' is not a body in this sim`)
    }
    this.shipAssistTarget = bodyName
  }

  // One PD snapshot pass — see the doc comment on prevS/sDots above.
  private snapshotPD(): void {
    const elapsed = this.lastSnapStep < 0 ? 0 : (this.stepCount - this.lastSnapStep) * DT
    for (const b of this.bodies) {
      if (!b.parentName || b.kind === 'ship' || b.kind === 'fab' || b.rNom === 0) continue
      const parent = findBody(this.bodies, b.parentName)
      if (!parent) continue
      const s = (dist(b.pos, parent.pos) - b.rNom) / b.rNom
      const sPrev = this.prevS.get(b.name)
      if (sPrev !== undefined && elapsed > 0) {
        this.sDots.set(b.name, (s - sPrev) / elapsed)
      } else if (!this.sDots.has(b.name)) {
        this.sDots.set(b.name, 0) // first snapshot: no rate history yet
      }
      this.prevS.set(b.name, s)
    }
    this.lastSnapStep = this.stepCount
  }

  harmony(): number {
    return harmonyOf(this.bodies, this.envelope)
  }

  drainEvents(): SimEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // Fabs are placed in a circular orbit around the LOCAL dominant attractor
  // (amendment 11 follow-up). The original Task 7 sun-circular-everywhere
  // init made every counterweight placement near a planet a death
  // sentence: near a moon's orbit the sun-circular velocity is nearly
  // IDENTICAL to the planet's, i.e. near-zero relative velocity deep in
  // the planet's gravity well — a radial free-fall into the planet within
  // ~40–150 tu (measured for both saturn and jupiter placements;
  // mass-independent, so no assist tuning could ever compensate).
  //
  // Criterion: if the sun-circular candidate velocity would leave the fab
  // gravitationally BOUND to a planet (negative two-body energy
  // ½|v_rel|² − G·m/d < 0), that is a capture-and-crash trajectory, so
  // the fab instead parks in a circular RETROGRADE orbit around that
  // planet (the most-bound one). Retrograde because counterweights get
  // stationed at moon-orbit radii, 0.7–1.9 Hill radii, where PROGRADE
  // circular orbits are chaotic (stability limit ≈ 0.5 r_H — measured
  // here too: a prograde fab at 13.6 from saturn pumped to e≈0.5 and
  // wandered off within ~150 tu, aborting the rescue) while the
  // distant-retrograde family (DROs — real astrodynamics) is stable well
  // beyond the Hill radius. Measured: retrograde fabs hold station for
  // the whole rescue window. A binding-energy gate (not a Hill-radius
  // gate) is what makes amendment 11(e)'s "fab placement near planets is
  // safe at real masses" actually true, and what Task 9's counterweight
  // stationing builds on.
  //
  // PLACEMENT GUARDS (coordinator review, Task 8): returns null — placement
  // REJECTED, no body created — when:
  //  - the fab binds to a planet and fabMass/primary.mass exceeds
  //    FAB_MASS_RATIO_MAX (measured on mars: a 0.01 fab false-ambers it,
  //    a 0.05 fab ejects it — real gravity, no gate can prevent it); the
  //    check is skipped for sun-bound placements (sun mass 1000);
  //  - the position is within FAB_MIN_SEPARATION of any LIVE fab
  //    (measured: two 0.05 fabs at ≤6 u mutually capture, collide, and
  //    doom the rescue).
  // Task 9's placement UI should treat null as "invalid spot, pick again".
  //
  // Permanence note (coordinator, Task 8 review): a stationed counterweight
  // is PERMANENT infrastructure. The PD assist pins a rescued moon near its
  // envelope; it does not rewrite the underlying orbit — remove the fab (or
  // let it die) and the residual eccentric orbit re-expresses. Rescue ≠
  // re-circularization; only returnSlag accretion genuinely heals the
  // orbit itself.
  //
  // Placed on the SAME bodies array the tracker already holds a reference
  // to — we must NOT construct a new StabilityTracker here (amendment 7:
  // that would discard every other body's held instant-worsen/slow-recover
  // alarm state). Fabs themselves are never score-tracked
  // (StabilityTracker.tracked() excludes kind 'fab'), so there is no
  // track() call to make for the fab itself either.
  addFab(pos: Vec, mass: number): Body | null {
    const sun = findBody(this.bodies, 'sun')!

    // Separation guard — against LIVE fabs only.
    for (const f of this.bodies) {
      if (f.kind !== 'fab' || this.dead.has(f.name)) continue
      if (dist(pos, f.pos) < FAB_MIN_SEPARATION) return null
    }
    const rSun = dist(pos, sun.pos)
    const sunRadial = norm(sub(pos, sun.pos))
    const vSun = circularSpeed(sun.mass, rSun)
    const cand = v(
      sun.vel.x - sunRadial.y * vSun,
      sun.vel.y + sunRadial.x * vSun,
    )

    let primary = sun
    let bestEps = 0
    for (const p of this.bodies) {
      if (p.kind !== 'planet' || this.dead.has(p.name)) continue
      const d = dist(pos, p.pos)
      const eps = d === 0
        ? -Infinity // degenerate: placed exactly on the planet
        : 0.5 * ((cand.x - p.vel.x) ** 2 + (cand.y - p.vel.y) ** 2) - (G * p.mass) / d
      if (eps < bestEps) {
        bestEps = eps
        primary = p
      }
    }

    // Mass-ratio guard — planet-bound placements only (see doc comment).
    if (primary !== sun && mass / primary.mass > FAB_MASS_RATIO_MAX) return null

    let vel: Vec
    let r: number
    if (primary === sun) {
      vel = cand
      r = rSun
    } else {
      r = dist(pos, primary.pos)
      // Two retrograde branches split at the planet's Hill radius: inside,
      // the bound circular-retrograde (DRO) orbit at sqrt(G·m/r) — the only
      // stable family at moon-orbit radii (PROGRADE circular orbits are
      // chaotic beyond ≈0.5·r_H: measured, a prograde fab at 13.6 from
      // saturn pumped to e≈0.5 and wandered off within ~150 tu, aborting
      // the rescue). Outside, the QUASI-SATELLITE loop — the guiding-center
      // epicyclic solution, a 2:1 retrograde ellipse around the planet
      // (naive circular-retrograde init out there crashes into the planet
      // within 300 tu; measured). In the planet's local orbital frame
      // (x̂ = sun→planet radial, ŷ = prograde tangential) the epicyclic
      // ellipse through local offset (x_r, y_r) has INERTIAL relative
      // velocity
      //   (−n·y_r/2, −n·x_r)
      // (rotating-frame epicycle rate (−A·n·sinφ, −2·A·n·cosφ) PLUS the
      // frame term Ω×offset — dropping the frame term, i.e. using the
      // rotating-frame numbers directly, doubles the eccentricity and was
      // measured to send a saturn-stationed fab onto a jupiter-crossing
      // sun orbit).
      const aP = dist(primary.pos, sun.pos)
      const nP = circularSpeed(sun.mass, aP) / aP // planet mean motion
      const hill = aP * Math.cbrt(primary.mass / (3 * sun.mass))
      const rel = sub(pos, primary.pos)
      // Boundary 1.25·r_H is measured: circular-retrograde holds station up
      // to ~1.2·r_H and crashes by ~1.3·r_H; the QS approximation (which
      // neglects the planet's own gravity) is only valid from ~1.3·r_H out.
      if (r < 1.25 * hill) {
        // Bound branch: circular retrograde around the planet. μ includes
        // the fab's own mass (coordinator fix #3) — the two-body circular
        // speed is sqrt(G·(M+m)/r); at FAB_MASS_RATIO_MAX the fab is up to
        // 5% of its primary, no longer a pure test particle.
        const vCirc = circularSpeed(primary.mass + mass, r)
        const radial = norm(rel)
        const tangent = v(radial.y, -radial.x) // retrograde — see doc comment
        vel = v(primary.vel.x + tangent.x * vCirc, primary.vel.y + tangent.y * vCirc)
      } else {
        // Quasi-satellite branch.
        const xHat = norm(sub(primary.pos, sun.pos))
        const yHat = v(-xHat.y, xHat.x)
        const xR = rel.x * xHat.x + rel.y * xHat.y
        const yR = rel.x * yHat.x + rel.y * yHat.y
        const vx = (-nP * yR) / 2 // local radial component
        const vy = -nP * xR       // local tangential component
        vel = v(
          primary.vel.x + xHat.x * vx + yHat.x * vy,
          primary.vel.y + xHat.y * vx + yHat.y * vy,
        )
      }
    }

    const name = `fab-${this.bodies.filter(b => b.kind === 'fab').length + 1}`
    const fab = makeBody({
      name,
      kind: 'fab',
      mass,
      pos: { ...pos },
      vel,
      radius: 1.2,
      parentName: primary.name,
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

    // 2. Station-keeping assist — PD controller (amendment 11(b), replaces
    // the Task 8 constant-magnitude force whose arrest-or-overshoot knife
    // edge the runaway turned into ejections). Radial acceleration
    //   a = −(Kp·s + Kd·sDot)   along the outward radial unit vector,
    // where s = (d − rNom)/rNom is the LIVE signed deviation (position-
    // derived — allowed), sDot is the per-tick finite-difference snapshot
    // (see prevS/sDots above — no velocity reads), Kp = K, and
    //   Kd = DAMP_RATIO·sqrt(Kp·rNom).
    // Stability reasoning: in radial displacement x = s·rNom the closed
    // loop is x¨ ≈ −(Kp/rNom)·x − (Kd/rNom)·x˙ (+ the body's own epicyclic
    // restoring, + runaway anti-restoring while critical), i.e. stiffness
    // k = Kp/rNom and damping c = Kd/rNom = DAMP_RATIO·sqrt(k) — a damping
    // ratio of ζ = DAMP_RATIO/2, critically damped at DAMP_RATIO = 2, so
    // the approach to rNom is non-oscillatory by construction instead of
    // knife-edge tuned. The gain K = Σ live fabs in range ASSIST_K·m/d²
    // (mass SNAPSHOT, never fab.mass) + SHIP_ASSIST while the ship is
    // stationed here.
    //
    // Envelope-gated (amendment 8 no-false-alarm requirement): the force
    // only switches on once b has drifted beyond its own pristine envelope
    // (+ margin) — a healthy body feels exactly zero assist force by
    // construction, no matter how close a fab parks (so the machinery
    // cannot change any pristine trajectory). deviationOf and the envelope
    // are position-derived, so the gate stays within the ExtraAccel
    // contract (amendment 2: no vel/mass reads).
    const dev = deviationOf(b, this.bodies)
    const envLimit = (this.envelope[b.name] ?? 0) + ENV_MARGIN
    if (dev > envLimit && b.rNom > 0 && !this.dead.has(b.name)) {
      let K = this.shipAssistTarget === b.name ? SHIP_ASSIST : 0
      for (const fab of this.bodies) {
        if (fab.kind !== 'fab' || fab === b) continue
        const fabMass = this.fabMasses.get(fab.name)
        if (fabMass === undefined) continue
        const fd = dist(fab.pos, b.pos)
        if (fd === 0 || fd > ASSIST_RANGE) continue
        K += (ASSIST_K * fabMass) / (fd * fd)
      }
      // Saturate: see the ASSIST_MAX comment in constants.ts — bounds the
      // conjunction-phase gain so ASSIST_K can be sized for the far phase.
      K = Math.min(K, ASSIST_MAX)
      if (K > 0) {
        const s = (d - b.rNom) / b.rNom
        const sDot = this.sDots.get(b.name) ?? 0
        const kd = DAMP_RATIO * Math.sqrt(K * b.rNom)
        const mag = -(K * s + kd * sDot)
        ax += radial.x * mag
        ay += radial.y * mag
      }
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
      // Dead fabs (collided/ejected/sundived) no longer assist anyone.
      if (b.kind === 'fab' && !this.dead.has(b.name)) this.fabMasses.set(b.name, b.mass)
    }

    // Substep budget with fractional-remainder carry (coordinator fix #5) —
    // see the tuRemainder doc comment. The tiny epsilon absorbs float slop
    // in tu/DT ratios (e.g. 0.1/0.02) without ever manufacturing a step.
    this.tuRemainder += tu
    const steps = Math.floor(this.tuRemainder / DT + 1e-9)
    if (steps <= 0) return
    this.tuRemainder -= steps * DT

    // PD snapshots re-run every ASSIST_SNAPSHOT_TU of substeps, keyed to
    // the ABSOLUTE substep count — see the prevS/sDots doc comment
    // (coordinator fix #1: per-tick-frozen sDot destabilized large ticks
    // and made trajectories depend on the caller's tick partition).
    const snapEvery = Math.max(1, Math.round(ASSIST_SNAPSHOT_TU / DT))
    for (let i = 0; i < steps; i++) {
      if (this.stepCount % snapEvery === 0) this.snapshotPD()
      stepHierarchical(this.bodies, DT, this.extraAccel)
      this.stepCount++
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
