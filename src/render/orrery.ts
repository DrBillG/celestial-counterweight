// Orrery scene (Task 12): the living 3D solar system laid over the glorious
// sky. Textured sun/planets/moons on their real xy orbits (positions read
// straight from the live Sim), luminous stability-colored orbit trails, the
// gold Harmony Ring encircling the system, the ship cone, and fabrication
// octahedra that pop in mid-run. Wired to the Director's Sim — this module
// only READS the sim (body.pos, tracker.heldBand, harmony); it never mutates
// sim/game state.
import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { Body } from '../sim/body'
import type { Band } from '../sim/stability'

// Solar System Scope 2k texture filenames (public/textures). Moons without a
// texture (europa/titan/oberon/triton) fall through to FALLBACK_COLOR.
const TEXTURE_FILE: Record<string, string> = {
  sun: '2k_sun.jpg',
  mercury: '2k_mercury.jpg',
  venus: '2k_venus_atmosphere.jpg',
  earth: '2k_earth_daymap.jpg',
  moon: '2k_moon.jpg',
  mars: '2k_mars.jpg',
  jupiter: '2k_jupiter.jpg',
  saturn: '2k_saturn.jpg',
  uranus: '2k_uranus.jpg',
  neptune: '2k_neptune.jpg',
}

// Flat colors used until/instead of a texture (missing file or failed load).
const FALLBACK_COLOR: Record<string, number> = {
  sun: 0xffd75e, mercury: 0x9a8a7a, venus: 0xd9b98a, earth: 0x5a8fd0, moon: 0xb0b0b8,
  mars: 0xd0745a, jupiter: 0xcaa77e, europa: 0xc8d8e0, saturn: 0xd8c8a0, titan: 0xd0a860,
  uranus: 0x9ad0d8, oberon: 0xbcb0c8, neptune: 0x6a8ad8, triton: 0x9ec8d8,
}

// Trails glow in the body's held stability band (bright, additive → bloom).
const BAND_COLOR: Record<Band, number> = {
  green: 0x54d18f, amber: 0xf0c040, red: 0xff5a5a, critical: 0xff2a2a,
}

const TRAIL_LEN = 240

// The system spans out to neptune at r=344 — positions are used directly as
// scene coordinates (matches the renderer's -260/200 god-view pose). No scale
// factor applied.
const POS_SCALE = 1
const RING_RADIUS = 348 // just outside neptune
// Click proxies are scaled each frame so a minable body subtends a roughly
// CONSTANT screen-space hit zone regardless of how far it is from the camera —
// otherwise a distant moon (Titan) would be far harder to click than a near one.
// worldRadius = max(body.radius*1.6, PICK_SCREEN_FRAC * cameraDistance).
// ~0.045 ≈ a generous, moving-target-friendly zone; nearest-hit keeps the
// tightly-packed Jupiter moons individually selectable even where zones overlap.
const PICK_SCREEN_FRAC = 0.045
const MIN_PROXY_WORLD = 3

// Loss-cinematic timeline (seconds from state → 'lost').
const CATA = {
  fall: 2.4, // how long a body takes to spiral into the sun once it starts
  swell: 2.7, // sun begins to swell
  nova: 3.7, // supernova detonates
  total: 6.2, // cinematic length; HUD end-screen appears near the end
} as const

// A growing orbit trail: a fixed-capacity dynamic position buffer driven by a
// draw range (see note in addBody on why setFromPoints can't be reused here).
interface Trail {
  line: THREE.Line
  positions: Float32Array
  count: number
}

export class Orrery {
  group = new THREE.Group()
  private meshes = new Map<string, THREE.Object3D>()
  private trails = new Map<string, Trail>()
  // Static orbit skeleton: a faint full circle at each body's rNom, re-centred
  // each frame on its parent's CURRENT position (planets → sun, moons → planet).
  private guides = new Map<string, { loop: THREE.LineLoop; parentName: string }>()
  // Invisible, generously-sized click targets for the MINABLE bodies. Moons are
  // tiny and moving, so raycasting their visible mesh is fiddly; each proxy is a
  // big invisible sphere carrying userData.bodyName that pick() raycasts instead.
  // Only minable bodies get one, so a click resolves to a valid mining target
  // (or misses → deselect) rather than landing on scenery like Venus.
  private pickProxies: THREE.Mesh[] = []
  private pickProxyByName = new Map<string, THREE.Mesh>()
  // Bright ring drawn around the currently-selected body so a click has obvious,
  // immediate feedback in the 3D scene (not just the side panel).
  private selectionRing: THREE.Mesh
  private selected: string | null = null
  // A big band-colored beacon around the body the HUD is telling the player to
  // reach (a wobbling moon) so a tiny moon in a cluster is easy to FIND.
  private attentionRing: THREE.Mesh
  private attention: string | null = null
  private harmonyRing: THREE.Mesh
  // Loss cinematic ("cataclysm"): planets spiral into the sun, explode, and the
  // sun goes supernova. Purely visual, time-driven — the sim is already stopped.
  private cataStart = -1
  private cataCaptured = new Map<string, { x: number; y: number; ang: number; r: number; delay: number }>()
  private cataFlashed = new Set<string>()
  private cataFlashes: { mesh: THREE.Mesh; born: number; life: number; max: number }[] = []
  private cataNova?: THREE.Mesh
  private cataShock?: THREE.Mesh
  private cataDebris?: THREE.Points
  private novaFired = false
  private loader = new THREE.TextureLoader()

  constructor(private sim: Sim) {
    for (const b of sim.bodies) this.addBody(b)

    // Harmony Ring: a thin gold torus enclosing the whole system. Its opacity
    // and flicker are driven by sim.harmony() in update().
    this.harmonyRing = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 1.2, 12, 256),
      new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.5 }),
    )
    this.group.add(this.harmonyRing)

    // Selection reticle: a bright cyan torus, hidden until a body is selected,
    // then parked on it and pulsed in update(). Faces the camera plane (xy).
    this.selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.12, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x57c8ff, transparent: true, opacity: 0.9 }),
    )
    this.selectionRing.visible = false
    this.group.add(this.selectionRing)

    // Attention beacon: a bold ring re-colored to the danger band each frame,
    // strongly pulsing, sized generously so a tiny moon is easy to spot.
    this.attentionRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.16, 10, 56),
      new THREE.MeshBasicMaterial({ color: 0xe05e5e, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.attentionRing.visible = false
    this.group.add(this.attentionRing)

    // Sun light + low ambient so textured planets read with a lit day side.
    // High intensity, gentle decay (1.2) so both the inner planets (r~38) and
    // the outer chain (r~344) catch enough light to show their day side;
    // planets are additionally given a soft emissive so their night side and
    // the faint outer worlds never fall to pure black against the bright sky.
    const sunlight = new THREE.PointLight(0xfff2d0, 6000, 0, 1.2)
    this.group.add(sunlight)
    this.group.add(new THREE.AmbientLight(0x445577, 1.8))
  }

  private addBody(b: Body): void {
    let mesh: THREE.Object3D
    if (b.kind === 'ship') {
      // Small bright cone, pointing "up" out of the plane so it reads.
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 2.6, 8),
        new THREE.MeshBasicMaterial({ color: 0xdceaff }),
      )
      cone.rotation.x = Math.PI / 2
      mesh = cone
    } else if (b.kind === 'fab') {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.6),
        new THREE.MeshBasicMaterial({ color: 0x7ff0d0, wireframe: true }),
      )
    } else if (b.kind === 'star') {
      // Sun: bright unlit sphere so it burns under bloom. Texture (if it
      // loads) is applied to the same basic material and kept bright.
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 })
      this.loadTexture(b.name, (t) => {
        mat.map = t
        mat.color.set(0xffffff)
        mat.needsUpdate = true
      })
      mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 48, 48), mat)
    } else {
      // planet / moon: lit standard material, textured where available, with a
      // soft self-emissive so every world reads against the bright sky even on
      // its night side (the sun lights the day side on top of this).
      // Emissive is a FAINT fill so night sides / far worlds don't fall to pure
      // black against the bright sky — NOT a light source. It is deliberately
      // low (0.12 / 0.1) so it never trips the bloom threshold (0.32) when a
      // planet fills the bridge view; the sun PointLight does the real lighting
      // and preserves surface texture detail up close (Task 13 bridge fix).
      const base = FALLBACK_COLOR[b.name] ?? 0x888888
      const mat = new THREE.MeshStandardMaterial({
        color: base,
        emissive: base,
        emissiveIntensity: 0.12,
        roughness: 0.9,
        metalness: 0.0,
      })
      this.loadTexture(b.name, (t) => {
        mat.map = t
        mat.emissiveMap = t
        mat.color.set(0xffffff)
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = 0.1
        mat.needsUpdate = true
      })
      const seg = b.kind === 'planet' ? 32 : 20
      mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, seg, seg), mat)
    }

    mesh.userData.bodyName = b.name
    this.group.add(mesh)
    this.meshes.set(b.name, mesh)

    // Easy-click hit zone for minable bodies: a big invisible sphere (colorWrite
    // & depthWrite off so it draws nothing and never occludes) sized to at least
    // MIN_PICK_RADIUS game units, so tiny moving moons are comfortable to click.
    if (b.minable) {
      // Unit sphere; update() scales it to the target screen size each frame.
      const proxy = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 12),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      )
      proxy.userData.bodyName = b.name
      proxy.userData.bodyRadius = b.radius
      proxy.renderOrder = -1
      this.group.add(proxy)
      this.pickProxies.push(proxy)
      this.pickProxyByName.set(b.name, proxy)
    }

    if ((b.kind === 'planet' || b.kind === 'moon') && b.parentName && b.rNom > 0) {
      // Static guide-ring: a faint steel-blue circle of radius rNom in the xy
      // plane, drawn once and re-centred on the parent each frame. This shows
      // the whole orbital STRUCTURE immediately (even at t=0, no motion), so
      // the system reads as an orrery rather than a cluster of dots.
      const segs = 160
      const gpts: THREE.Vector3[] = []
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2
        gpts.push(new THREE.Vector3(Math.cos(a) * b.rNom, Math.sin(a) * b.rNom, 0))
      }
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(gpts),
        new THREE.LineBasicMaterial({
          color: 0x5a7ba8,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      loop.frustumCulled = false
      this.group.add(loop)
      this.guides.set(b.name, { loop, parentName: b.parentName })
    }

    if (b.kind === 'planet' || b.kind === 'moon') {
      // Additive blending so the trail reads as a luminous stability-colored
      // arc that catches the renderer's bloom, not a flat hairline.
      //
      // NOTE: we drive a PREALLOCATED dynamic buffer via setDrawRange rather
      // than BufferGeometry.setFromPoints per frame. In three r0.171
      // setFromPoints REUSES an existing position attribute and writes only
      // min(points, existingCount) verts — so a geometry first sized at 1
      // point (frame 0) stays stuck at 1 vertex forever and the trail never
      // draws. A fixed capacity + draw range sidesteps that entirely.
      const positions = new Float32Array(TRAIL_LEN * 3)
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
      geom.setDrawRange(0, 0)
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({
          color: BAND_COLOR.green,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      // Trails are dynamic and always near the system centre; skip frustum
      // culling (its bounding sphere would go stale as the buffer fills).
      line.frustumCulled = false
      this.group.add(line)
      this.trails.set(b.name, { line, positions, count: 0 })
    }
  }

  // Load a body's texture if one is mapped; on missing file/failed load the
  // mesh keeps its FALLBACK_COLOR (onError is a no-op, so a 404 never spams).
  private loadTexture(name: string, apply: (t: THREE.Texture) => void): void {
    const file = TEXTURE_FILE[name]
    if (!file) return
    this.loader.load(
      `textures/${file}`,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        apply(t)
      },
      undefined,
      () => {
        /* texture missing — keep fallback flat color, stay silent */
      },
    )
  }

  update(time: number, camera?: THREE.Camera): void {
    for (const b of this.sim.bodies) {
      let mesh = this.meshes.get(b.name)
      if (!mesh) {
        // Fabs are added mid-run — build their mesh (and no trail) on sight.
        this.addBody(b)
        mesh = this.meshes.get(b.name)!
      }
      mesh.position.set(b.pos.x * POS_SCALE, b.pos.y * POS_SCALE, 0)
      if (b.kind === 'planet' || b.kind === 'moon' || b.kind === 'star') {
        mesh.rotation.z = time * 0.1
      }
      // Minable bodies gently "breathe" so they read as interactive targets.
      if (b.minable) {
        const s = 1 + 0.12 * Math.sin(time * 2.2)
        mesh.scale.setScalar(s)
      }
      // Keep the invisible click-proxy glued to its (moving) body, and scale it
      // to a roughly constant screen size based on distance from the camera.
      const proxy = this.pickProxyByName.get(b.name)
      if (proxy) {
        proxy.position.set(b.pos.x * POS_SCALE, b.pos.y * POS_SCALE, 0)
        const camDist = camera ? camera.position.distanceTo(proxy.position) : 250
        const r = Math.max((proxy.userData.bodyRadius as number) * 1.6, MIN_PROXY_WORLD, PICK_SCREEN_FRAC * camDist)
        proxy.scale.setScalar(r)
      }

      // Re-centre this body's guide-ring on its parent's current position
      // (moons track their planet as it orbits; planets track the sun).
      const guide = this.guides.get(b.name)
      if (guide) {
        const parent = this.sim.bodies.find((p) => p.name === guide.parentName)
        if (parent) guide.loop.position.set(parent.pos.x * POS_SCALE, parent.pos.y * POS_SCALE, 0)
      }

      const trail = this.trails.get(b.name)
      if (trail) {
        const x = b.pos.x * POS_SCALE
        const y = b.pos.y * POS_SCALE
        if (trail.count < TRAIL_LEN) {
          // Append.
          trail.positions[trail.count * 3] = x
          trail.positions[trail.count * 3 + 1] = y
          trail.positions[trail.count * 3 + 2] = 0
          trail.count++
        } else {
          // Full: slide the buffer back one point and write the newest at the end.
          trail.positions.copyWithin(0, 3, TRAIL_LEN * 3)
          const last = (TRAIL_LEN - 1) * 3
          trail.positions[last] = x
          trail.positions[last + 1] = y
          trail.positions[last + 2] = 0
        }
        const geom = trail.line.geometry
        geom.setDrawRange(0, trail.count)
        geom.getAttribute('position').needsUpdate = true

        const band = this.sim.tracker.heldBand(b.name)
        const m = trail.line.material as THREE.LineBasicMaterial
        m.color.set(BAND_COLOR[band])
        m.opacity = band === 'red' || band === 'critical' ? 0.55 + 0.4 * Math.abs(Math.sin(time * 6)) : 0.85
      }
    }

    // Harmony Ring integrity: brighter/steady when harmonious, dim + flicker
    // as harmony falls.
    const h = this.sim.harmony()
    const rm = this.harmonyRing.material as THREE.MeshBasicMaterial
    rm.opacity = 0.15 + 0.5 * (h / 100) + (h < 60 ? 0.15 * Math.sin(time * 10) : 0)

    // Selection reticle: park on the selected body and pulse, or hide.
    const sel = this.selected ? this.sim.bodies.find((b) => b.name === this.selected) : undefined
    if (sel) {
      const ring = this.selectionRing
      ring.visible = true
      ring.position.set(sel.pos.x * POS_SCALE, sel.pos.y * POS_SCALE, 0)
      const r = Math.max(sel.radius * 2.2, 5) * (1 + 0.08 * Math.sin(time * 5))
      ring.scale.setScalar(r)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.35 * Math.abs(Math.sin(time * 4))
    } else {
      this.selectionRing.visible = false
    }

    // Attention beacon: a big, hard-pulsing ring in the danger band's colour on
    // the body the HUD is telling the player to reach, so it's easy to FIND.
    const att = this.attention ? this.sim.bodies.find((b) => b.name === this.attention) : undefined
    if (att && att.parentName && att.kind !== 'ship' && att.kind !== 'fab') {
      const ring = this.attentionRing
      ring.visible = true
      ring.position.set(att.pos.x * POS_SCALE, att.pos.y * POS_SCALE, 0)
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(time * 3.5))
      ring.scale.setScalar(Math.max(att.radius * 4, 9) * (0.8 + 0.35 * pulse))
      const m = ring.material as THREE.MeshBasicMaterial
      const band = this.sim.tracker.heldBand(att.name)
      m.color.set(BAND_COLOR[band === 'green' ? 'amber' : band])
      m.opacity = 0.45 + 0.55 * pulse
    } else {
      this.attentionRing.visible = false
    }
  }

  // Tell the orrery which body is selected (drives the reticle). null = none.
  setSelected(name: string | null): void {
    this.selected = name
  }

  // Tell the orrery which body needs attention (a wobbling moon the HUD is
  // pointing the player toward). null = none.
  setAttention(name: string | null): void {
    this.attention = name
  }

  // ---- loss cinematic -----------------------------------------------------

  // Returns true while the cinematic is still playing. main.ts calls this
  // instead of update() once the run is lost. `time` is seconds (perf clock).
  playCataclysm(time: number, camera?: THREE.Camera): boolean {
    if (this.cataStart < 0) this.startCataclysm(time)
    const e = time - this.cataStart
    const sun = this.meshes.get('sun')!
    this.selectionRing.visible = false

    // Bodies spiral into the sun, spinning and shrinking, then flash on impact.
    for (const [name, mesh] of this.meshes) {
      if (name === 'sun') continue
      const c = this.cataCaptured.get(name)
      if (!c) continue
      const p = Math.min(1, Math.max(0, (e - c.delay) / CATA.fall))
      const ease = p * p * p // accelerate inward
      const ang = c.ang + ease * Math.PI * 3 // spiral
      const r = c.r * (1 - ease)
      mesh.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0)
      mesh.scale.setScalar(Math.max(0.001, 1 - ease))
      mesh.rotation.z += 0.3
      if (p >= 0.86 && !this.cataFlashed.has(name)) {
        this.cataFlashed.add(name)
        this.spawnFlash(mesh.position.x, mesh.position.y, time, 1.4 + c.r * 0.03)
      }
      if (p >= 1) mesh.visible = false
    }

    // Sun swells and whitens, then detonates.
    if (e >= CATA.swell) {
      const s = 1 + (e - CATA.swell) * 2.4
      sun.scale.setScalar(Math.min(s, 4))
      const sm = (sun as THREE.Mesh).material as THREE.MeshBasicMaterial
      const w = Math.min(1, (e - CATA.swell) / (CATA.nova - CATA.swell))
      sm.color.setRGB(1, 0.91 + 0.09 * w, 0.63 + 0.37 * w) // → white-hot
    }
    if (e >= CATA.nova && !this.novaFired) {
      this.novaFired = true
      this.fireNova(time)
      this.spawnDebris(time)
    }
    this.updateNova(time, e)
    this.updateFlashes(time)

    // Harmony ring + guide rings fade away as the system dies.
    const fade = Math.max(0, 1 - e / CATA.nova)
    ;(this.harmonyRing.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade
    for (const [, g] of this.guides) (g.loop.material as THREE.LineBasicMaterial).opacity = 0.16 * fade
    for (const [, t] of this.trails) (t.line.material as THREE.LineBasicMaterial).opacity = 0.6 * fade

    void camera
    return e < CATA.total
  }

  private startCataclysm(time: number): void {
    this.cataStart = time
    const sun = this.meshes.get('sun')!
    const sx = sun.position.x
    const sy = sun.position.y
    let maxR = 1
    for (const b of this.sim.bodies) {
      if (b.name === 'sun' || b.kind === 'fab' || b.kind === 'ship') continue
      const dx = b.pos.x * POS_SCALE - sx
      const dy = b.pos.y * POS_SCALE - sy
      maxR = Math.max(maxR, Math.hypot(dx, dy))
    }
    for (const b of this.sim.bodies) {
      if (b.name === 'sun') continue
      const mesh = this.meshes.get(b.name)
      if (!mesh) continue
      const dx = b.pos.x * POS_SCALE - sx
      const dy = b.pos.y * POS_SCALE - sy
      const r = Math.hypot(dx, dy)
      // closer bodies fall first (staggered), farthest starts ~1.1s later
      this.cataCaptured.set(b.name, { x: dx, y: dy, ang: Math.atan2(dy, dx), r, delay: (r / maxR) * 1.1 })
    }
  }

  private spawnFlash(x: number, y: number, time: number, max: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    mesh.position.set(x, y, 0)
    this.group.add(mesh)
    this.cataFlashes.push({ mesh, born: time, life: 0.6, max })
  }

  private updateFlashes(time: number): void {
    for (let i = this.cataFlashes.length - 1; i >= 0; i--) {
      const f = this.cataFlashes[i]
      const a = (time - f.born) / f.life
      if (a >= 1) {
        this.group.remove(f.mesh)
        f.mesh.geometry.dispose()
        ;(f.mesh.material as THREE.Material).dispose()
        this.cataFlashes.splice(i, 1)
        continue
      }
      f.mesh.scale.setScalar(0.2 + a * f.max)
      ;(f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - a
    }
  }

  private fireNova(time: number): void {
    this.cataNova = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.cataShock = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xffd090, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.group.add(this.cataNova, this.cataShock)
    void time
  }

  private spawnDebris(time: number): void {
    const N = 600
    const pos = new Float32Array(N * 3)
    const vel: number[] = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.3
      const sp = 40 + Math.random() * 260
      vel.push(Math.cos(a) * sp, Math.sin(a) * sp)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffdca0, size: 3, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    pts.userData.vel = vel
    pts.userData.born = time
    this.group.add(pts)
    this.cataDebris = pts
  }

  private updateNova(time: number, e: number): void {
    if (this.cataNova) {
      const t = e - CATA.nova
      const scale = t < 0.35 ? t / 0.35 * 55 : 55 - (t - 0.35) * 30
      this.cataNova.scale.setScalar(Math.max(0.1, scale))
      ;(this.cataNova.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t * 0.7)
    }
    if (this.cataShock) {
      const t = e - CATA.nova
      this.cataShock.scale.setScalar(2 + t * 240)
      ;(this.cataShock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - t * 0.6)
    }
    if (this.cataDebris) {
      const dt = time - (this.cataDebris.userData.born as number)
      const attr = this.cataDebris.geometry.getAttribute('position') as THREE.BufferAttribute
      const vel = this.cataDebris.userData.vel as number[]
      for (let i = 0; i < attr.count; i++) {
        attr.setXY(i, vel[i * 2] * dt, vel[i * 2 + 1] * dt)
      }
      attr.needsUpdate = true
      ;(this.cataDebris.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - dt * 0.5)
    }
  }

  // Click-picking → minable body name, or null (a miss → the caller deselects).
  // Only the invisible pick proxies are tested, so clicks land on valid mining
  // targets with a generous, moon-friendly hit zone and never on scenery/trails.
  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.pickProxies, false)
    for (const h of hits) {
      const name = h.object.userData.bodyName
      if (name) return name as string
    }
    return null
  }
}
