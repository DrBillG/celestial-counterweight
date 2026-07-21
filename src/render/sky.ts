import * as THREE from 'three'

// A few star "spectral" tints for subtle color variety among the whites.
const STAR_PALETTE: Array<[number, number, number]> = [
  [1.0, 0.97, 0.92], // warm white
  [1.0, 1.0, 1.0], // pure white
  [0.82, 0.9, 1.0], // blue-white
  [1.0, 0.86, 0.72], // amber
  [1.0, 0.78, 0.78], // faint red
]

// Deterministic PRNG so the sky is stable across reloads.
function makeRand(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/**
 * A spherical shell of stars. `heroScale` controls the tail of the size
 * distribution: with heroScale>1 a handful of stars are notably large/bright
 * (hero stars that BURN under bloom) among many small ones, while far/mid
 * layers stay small and dim for depth.
 */
function starLayer(
  count: number,
  radius: number,
  size: number,
  seed: number,
  opts: { heroScale?: number; brightness?: number } = {},
): THREE.Points {
  const heroScale = opts.heroScale ?? 1
  const brightness = opts.brightness ?? 1
  const rand = makeRand(seed)
  const pos = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  const tint = new Float32Array(count * 3)
  const scale = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const th = rand() * Math.PI * 2,
      ph = Math.acos(2 * rand() - 1)
    pos[i * 3] = radius * Math.sin(ph) * Math.cos(th)
    pos[i * 3 + 1] = radius * Math.sin(ph) * Math.sin(th)
    pos[i * 3 + 2] = radius * Math.cos(ph)
    phase[i] = rand() * Math.PI * 2
    // Skewed size: rand^4 keeps most stars tiny, a rare few large.
    const r = rand()
    scale[i] = 0.55 + Math.pow(r, 4) * heroScale
    // Weight heavily toward white; occasional colored star.
    const c = rand() < 0.7 ? STAR_PALETTE[0] : STAR_PALETTE[Math.floor(rand() * STAR_PALETTE.length)]
    tint[i * 3] = c[0] * brightness
    tint[i * 3 + 1] = c[1] * brightness
    tint[i * 3 + 2] = c[2] * brightness
  }
  return buildPoints(pos, phase, tint, scale, size)
}

/**
 * A dense Milky Way band: micro-stars concentrated along a tilted great circle
 * with gaussian falloff perpendicular to the band. Built in local space with
 * the band along the equator, then the returned object is tilted diagonally.
 */
function milkyWayBand(count: number, radius: number, seed: number): THREE.Points {
  const rand = makeRand(seed)
  // approx normal in [-1.5,1.5] via sum of uniforms
  const gauss = () => rand() + rand() + rand() - 1.5
  const pos = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  const tint = new Float32Array(count * 3)
  const scale = new Float32Array(count)
  const thickness = 0.16 // band half-width in radians-ish
  for (let i = 0; i < count; i++) {
    const u = rand() * Math.PI * 2 // longitude around the band
    const lat = gauss() * thickness // gaussian offset off the band plane
    // clumpiness: a second gaussian creates knots of density
    const clump = gauss() * thickness * 0.5
    const l = lat + clump
    const cl = Math.cos(l)
    pos[i * 3] = radius * cl * Math.cos(u)
    pos[i * 3 + 1] = radius * cl * Math.sin(u)
    pos[i * 3 + 2] = radius * Math.sin(l)
    phase[i] = rand() * Math.PI * 2
    scale[i] = 0.4 + Math.pow(rand(), 3) * 1.6
    // faint, slightly cool dust with occasional warm knot
    const warm = rand() < 0.15
    const b = 0.35 + rand() * 0.35
    tint[i * 3] = (warm ? 0.9 : 0.75) * b
    tint[i * 3 + 1] = (warm ? 0.82 : 0.8) * b
    tint[i * 3 + 2] = (warm ? 0.78 : 0.95) * b
  }
  const points = buildPoints(pos, phase, tint, scale, 1.5)
  // Tilt the whole band diagonally across the sky.
  points.rotation.set(0.5, 0.35, 0.9)
  return points
}

function buildPoints(
  pos: Float32Array,
  phase: Float32Array,
  tint: Float32Array,
  scale: Float32Array,
  size: number,
): THREE.Points {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
  geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: size } },
    vertexShader: `
      attribute float phase; attribute vec3 tint; attribute float aScale;
      uniform float uTime; uniform float uSize;
      varying float vTwinkle; varying vec3 vTint;
      void main() {
        vTwinkle = 0.5 + 0.5 * sin(uTime * (0.8 + fract(phase) * 2.0) + phase * 7.0);
        vTint = tint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aScale * (0.65 + 0.7 * vTwinkle);
      }`,
    fragmentShader: `
      varying float vTwinkle; varying vec3 vTint;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        // tight core + soft halo so bright stars read as glowing points
        float core = smoothstep(0.5, 0.0, d);
        float halo = pow(core, 3.0);
        gl_FragColor = vec4(vTint * (core + halo * 0.6), (core * 0.85 + halo) * (0.55 + 0.45 * vTwinkle));
      }`,
  })
  return new THREE.Points(geo, mat)
}

/** Radial-gradient gas sprite. `rotation` skews it for elongated wisps. */
function nebulaSprite(
  inner: string,
  mid: string,
  size: number,
  pos: THREE.Vector3,
  opacity: number,
  aspect = 1,
  rotation = 0,
): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, inner)
  g.addColorStop(0.35, mid)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    rotation,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(size * aspect, size / aspect, 1)
  sprite.position.copy(pos)
  return sprite
}

// A structured gas region = several overlapping sprites of related-but-varied
// hues, sizes and offsets so it reads as a cloud, not a single blob.
type SpriteSpec = { inner: string; mid: string; size: number; off: [number, number, number]; opacity: number; aspect?: number; rot?: number }
type Region = { center: THREE.Vector3; sprites: SpriteSpec[] }

const REGIONS: Region[] = [
  {
    // Violet region: deep-violet core + magenta edge + faint blue wisp
    center: new THREE.Vector3(-950, 520, -1400),
    sprites: [
      { inner: 'rgba(150,70,230,0.95)', mid: 'rgba(96,44,168,0.45)', size: 1250, off: [0, 0, 0], opacity: 0.5 },
      { inner: 'rgba(224,86,190,0.85)', mid: 'rgba(150,40,120,0.35)', size: 820, off: [340, 180, 60], opacity: 0.42 },
      { inner: 'rgba(90,120,240,0.6)', mid: 'rgba(50,70,180,0.25)', size: 1500, off: [-260, -220, -80], opacity: 0.3, aspect: 1.6, rot: 0.7 },
    ],
  },
  {
    // Teal/cyan region: cyan core + green edge + deep-blue haze
    center: new THREE.Vector3(1020, -460, -1500),
    sprites: [
      { inner: 'rgba(40,210,220,0.9)', mid: 'rgba(20,150,166,0.4)', size: 1150, off: [0, 0, 0], opacity: 0.46 },
      { inner: 'rgba(70,230,150,0.7)', mid: 'rgba(30,150,110,0.3)', size: 760, off: [-300, 200, 50], opacity: 0.36 },
      { inner: 'rgba(50,90,220,0.55)', mid: 'rgba(24,50,150,0.22)', size: 1650, off: [280, -180, -90], opacity: 0.28, aspect: 1.7, rot: -0.5 },
    ],
  },
  {
    // Rose/magenta region high up: pink core + amber edge
    center: new THREE.Vector3(640, 820, -1300),
    sprites: [
      { inner: 'rgba(232,80,150,0.85)', mid: 'rgba(160,44,96,0.38)', size: 900, off: [0, 0, 0], opacity: 0.42 },
      { inner: 'rgba(240,150,70,0.6)', mid: 'rgba(170,90,40,0.28)', size: 700, off: [260, -160, 40], opacity: 0.32, aspect: 1.4, rot: 0.9 },
    ],
  },
  {
    // Faint warm haze near the galactic center, low and broad
    center: new THREE.Vector3(-120, -120, -1750),
    sprites: [
      { inner: 'rgba(224,150,80,0.5)', mid: 'rgba(150,90,50,0.2)', size: 2100, off: [0, 0, 0], opacity: 0.24, aspect: 1.8, rot: 0.3 },
    ],
  },
]

export class Sky {
  group = new THREE.Group()
  private layers: THREE.Points[]
  private nebulae: THREE.Sprite[] = []

  constructor(quality: 1 | 2 | 3 = 3) {
    const q = {
      1: { far: 800, mid: 300, near: 160, mw: 1200 },
      2: { far: 2000, mid: 700, near: 380, mw: 3000 },
      3: { far: 4500, mid: 1500, near: 700, mw: 6000 },
    }[quality]
    this.layers = [
      // Milky Way band sits farthest out, dense and dim.
      milkyWayBand(q.mw, 2600, 77),
      starLayer(q.far, 2400, 1.6, 11, { brightness: 0.85 }), // far dust
      starLayer(q.mid, 1900, 2.8, 22, { heroScale: 1.5 }), // mid
      starLayer(q.near, 1500, 6.5, 33, { heroScale: 6, brightness: 1.15 }), // near bright / hero stars
    ]
    this.layers.forEach((l) => this.group.add(l))

    // Faint elongated glow behind the Milky Way band for a galactic-plane wash.
    const bandGlow = nebulaSprite('rgba(120,130,190,0.5)', 'rgba(70,80,140,0.18)', 3400, new THREE.Vector3(0, 0, -2100), 0.22, 3.4, 0.9)
    this.group.add(bandGlow)
    this.nebulae.push(bandGlow)

    for (const region of REGIONS) {
      for (const s of region.sprites) {
        const p = region.center.clone().add(new THREE.Vector3(...s.off))
        const sprite = nebulaSprite(s.inner, s.mid, s.size, p, s.opacity, s.aspect ?? 1, s.rot ?? 0)
        this.group.add(sprite)
        this.nebulae.push(sprite)
      }
    }
  }

  // Parallax: each layer drifts at a different rate so depth reads naturally.
  update(time: number, harmonyPct: number) {
    for (const l of this.layers) (l.material as THREE.ShaderMaterial).uniforms.uTime.value = time
    // Milky Way keeps its tilt but drifts slowest; near layer drifts fastest.
    this.layers[0].rotation.z = 0.9 + time * 0.002
    this.layers[1].rotation.z = time * 0.003
    this.layers[2].rotation.z = time * 0.006
    this.layers[3].rotation.z = time * 0.01
    // ambient mood: warm/vibrant when harmonious, cold/red as instability spreads
    const cold = 1 - harmonyPct / 100
    for (const n of this.nebulae) {
      const m = n.material as THREE.SpriteMaterial
      m.color.setRGB(1 + cold * 0.3, 1 - cold * 0.25, 1 - cold * 0.15)
    }
  }

  // Free GPU buffers/textures so the sky can be rebuilt (e.g. Task 16 lowers
  // quality) without leaking. Star layers include the Milky Way band; nebulae
  // carry canvas-texture maps that must be released too.
  dispose() {
    for (const l of this.layers) {
      l.geometry.dispose()
      ;(l.material as THREE.Material).dispose()
    }
    for (const n of this.nebulae) {
      const m = n.material as THREE.SpriteMaterial
      m.map?.dispose()
      m.dispose()
    }
    this.group.clear()
  }
}
