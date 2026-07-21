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
// texture (phobos/io/europa/ganymede/titan) fall through to FALLBACK_COLOR.
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
  mars: 0xd0745a, phobos: 0x8a7a6a, jupiter: 0xcaa77e, io: 0xd8c060, europa: 0xc8d8e0,
  ganymede: 0xa89a8a, saturn: 0xd8c8a0, titan: 0xd0a860, uranus: 0x9ad0d8, neptune: 0x6a8ad8,
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
  private harmonyRing: THREE.Mesh
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
      const base = FALLBACK_COLOR[b.name] ?? 0x888888
      const mat = new THREE.MeshStandardMaterial({
        color: base,
        emissive: base,
        emissiveIntensity: 0.35,
        roughness: 0.9,
        metalness: 0.0,
      })
      this.loadTexture(b.name, (t) => {
        mat.map = t
        mat.emissiveMap = t
        mat.color.set(0xffffff)
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = 0.3
        mat.needsUpdate = true
      })
      const seg = b.kind === 'planet' ? 32 : 20
      mesh = new THREE.Mesh(new THREE.SphereGeometry(b.radius, seg, seg), mat)
    }

    mesh.userData.bodyName = b.name
    this.group.add(mesh)
    this.meshes.set(b.name, mesh)

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

  update(time: number): void {
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
  }

  // Click-picking → body name for target selection.
  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.group.children, false)
    for (const h of hits) {
      const name = h.object.userData.bodyName
      if (name) return name as string
    }
    return null
  }
}
