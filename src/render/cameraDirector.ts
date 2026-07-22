// Camera Director (Task 13): the cinematic dive. In the orrery/transit/won/lost
// states the camera holds the god-view pose baked into the Renderer; when the
// Director enters 'mining' or 'constructing' the camera eases DOWN behind the
// ship until the worked body fills the frame (the "bridge view"), then eases
// back out on departure. This module only READS the frozen game/sim core
// (Director.state, Director.currentTarget(), director.sim.bodies) — it never
// mutates game state. It DOES own the camera each frame (position, lookAt, and
// the near plane) while a dive is in progress.
//
// Amendment compliance (AMENDMENTS LOG — binding):
//  - 15: dead/lost bodies are kept in sim.bodies and integrated forever, and
//        deadness is not yet exposed (Task 16). So the dive must not NaN if the
//        target can't be resolved: we guard a missing/undefined target and reuse
//        the last known-good framing rather than snapping the camera to origin.
//  - Director.currentTarget() is PUBLIC (Task 9) — used here instead of reaching
//        into the private `target` field the plan's example illustrated.
import * as THREE from 'three'
import type { Director } from '../game/director'
import { findBody } from '../sim/data'

// God-view pose — must match the Renderer's baked camera pose (renderer.ts:
// camera.position.set(0, -190, 150); lookAt(0,0,0)). blend=0 returns here.
const GOD_POS = new THREE.Vector3(0, -190, 150)
const GOD_LOOK = new THREE.Vector3(0, 0, 0)

// Time (seconds) for a full god-view <-> bridge transition.
const DIVE_SECONDS = 2.5

// Bridge framing: camera sits `radius * FRAME_K + FRAME_PAD` from the target
// body, on the side the ship is stationed, lifted `LIFT_FRAC` of that distance
// above the orbital plane so we look slightly down onto the deck.
const FRAME_K = 3.5
const FRAME_PAD = 2.2
const LIFT_FRAC = 0.35

// Near-plane ramp (Task 12 z-fighting fix): far out the god view needs a tiny
// near plane (0.1) to keep the whole system in depth; diving to within a few
// units of a body, that tiny near plane z-fights the close geometry, so we
// raise near toward NEAR_BRIDGE as the dive passes NEAR_RAMP_START.
const NEAR_GOD = 0.1
const NEAR_BRIDGE = 1.0
const NEAR_RAMP_START = 0.3

export class CameraDirector {
  private blend = 0 // 0 = orrery god view, 1 = bridge view
  // Last resolved framing, reused if the target ever fails to resolve mid-dive
  // (amendment 15: a lost body isn't exposed, but a null/undefined target must
  // never poison the camera with NaN or a hard snap to origin).
  private lastTarget = new THREE.Vector3(0, 0, 0)
  private lastShip = new THREE.Vector3(0, 0, 0)

  constructor(
    private camera: THREE.PerspectiveCamera,
    private director: Director,
  ) {}

  update(dt: number): void {
    const wantBridge =
      this.director.state === 'mining' || this.director.state === 'constructing'
    // Ease blend toward the wanted pose over ~DIVE_SECONDS (dt is real seconds,
    // clamped by the caller's frame-dt cap so a long pause can't jump the dive).
    this.blend = THREE.MathUtils.clamp(
      this.blend + ((wantBridge ? 1 : -1) * dt) / DIVE_SECONDS,
      0,
      1,
    )

    // easeInOutQuad — a soft, cinematic acceleration in and out of the dive.
    const b = this.blend
    const eased = b < 0.5 ? 2 * b * b : 1 - ((-2 * b + 2) ** 2) / 2

    // Resolve the framing points. On any failure keep the last good values so
    // the camera glides instead of snapping or NaN-ing.
    const tp = this.resolveTarget()
    const sp = this.resolveShip()

    // Bridge pose: back off the target along the target->ship direction so the
    // body is dead ahead and framed by its own radius, lifted a touch above the
    // plane. Deriving the distance from the target (not the ship) keeps framing
    // stable even if the stationed ship position goes stale during a long run.
    const radius = this.targetRadius()
    const camDist = radius * FRAME_K + FRAME_PAD
    let view = new THREE.Vector3().subVectors(sp, tp)
    if (view.lengthSq() < 1e-6) {
      // Ship and target coincide (degenerate) — view the body from the
      // sunward-radial side so we still get a sensible, non-NaN direction.
      view = tp.lengthSq() > 1e-6 ? tp.clone().normalize() : new THREE.Vector3(0, -1, 0)
    } else {
      view.normalize()
    }
    const bridgePos = tp
      .clone()
      .addScaledVector(view, camDist)
      .add(new THREE.Vector3(0, 0, camDist * LIFT_FRAC))

    // Interpolate position and lookAt between god view and bridge pose.
    this.camera.position.lerpVectors(GOD_POS, bridgePos, eased)
    const look = new THREE.Vector3().lerpVectors(GOD_LOOK, tp, eased)
    this.camera.lookAt(look)

    // Near-plane ramp: only once the dive is meaningfully underway, and restored
    // on the way out. updateProjectionMatrix only when near actually changes.
    const nearT = THREE.MathUtils.clamp(
      (this.blend - NEAR_RAMP_START) / (1 - NEAR_RAMP_START),
      0,
      1,
    )
    const near = THREE.MathUtils.lerp(NEAR_GOD, NEAR_BRIDGE, nearT)
    if (Math.abs(near - this.camera.near) > 1e-4) {
      this.camera.near = near
      this.camera.updateProjectionMatrix()
    }
  }

  // True once the dive has essentially arrived at the bridge pose — used to fade
  // in the hull dressing (BridgeFrame) and, later, bridge-only HUD (Task 14).
  isBridge(): boolean {
    return this.blend > 0.85
  }

  // ---- framing helpers ---------------------------------------------------

  // The body the camera should look at: the worked target while mining, or the
  // most-recent fab while constructing. Falls back to the last good point.
  private resolveTarget(): THREE.Vector3 {
    const name =
      this.director.state === 'constructing'
        ? this.nearestFab()
        : this.director.currentTarget()
    const body = name && name !== 'fab' ? findBody(this.director.sim.bodies, name) : undefined
    if (body) this.lastTarget.set(body.pos.x, body.pos.y, 0)
    return this.lastTarget.clone()
  }

  private resolveShip(): THREE.Vector3 {
    const ship = findBody(this.director.sim.bodies, 'ship')
    if (ship) this.lastShip.set(ship.pos.x, ship.pos.y, 0)
    return this.lastShip.clone()
  }

  private targetRadius(): number {
    const name =
      this.director.state === 'constructing'
        ? this.nearestFab()
        : this.director.currentTarget()
    const body = name && name !== 'fab' ? findBody(this.director.sim.bodies, name) : undefined
    return body ? body.radius : 1
  }

  // Most recently placed fab (the one just built), or null when none exist yet
  // — resolveTarget/targetRadius then fall back to the last good framing.
  private nearestFab(): string | null {
    const fabs = this.director.sim.bodies.filter((b) => b.kind === 'fab')
    return fabs.length ? fabs[fabs.length - 1].name : null
  }
}
