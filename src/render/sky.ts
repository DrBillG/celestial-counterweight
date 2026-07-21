import * as THREE from 'three'

function starLayer(count: number, radius: number, size: number, seed: number): THREE.Points {
  const pos = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  const tint = new Float32Array(count * 3)
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  // A few star "spectral" tints for subtle color variety among the whites.
  const palette: Array<[number, number, number]> = [
    [1.0, 0.97, 0.92], // warm white
    [1.0, 1.0, 1.0], // pure white
    [0.82, 0.9, 1.0], // blue-white
    [1.0, 0.86, 0.72], // amber
    [1.0, 0.78, 0.78], // faint red
  ]
  for (let i = 0; i < count; i++) {
    // random directions on a far sphere
    const th = rand() * Math.PI * 2,
      ph = Math.acos(2 * rand() - 1)
    pos[i * 3] = radius * Math.sin(ph) * Math.cos(th)
    pos[i * 3 + 1] = radius * Math.sin(ph) * Math.sin(th)
    pos[i * 3 + 2] = radius * Math.cos(ph)
    phase[i] = rand() * Math.PI * 2
    // Weight heavily toward white; occasional colored star.
    const pick = rand()
    const c = pick < 0.7 ? palette[0] : palette[Math.floor(rand() * palette.length)]
    tint[i * 3] = c[0]
    tint[i * 3 + 1] = c[1]
    tint[i * 3 + 2] = c[2]
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: size } },
    vertexShader: `
      attribute float phase; attribute vec3 tint;
      uniform float uTime; uniform float uSize;
      varying float vTwinkle; varying vec3 vTint;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * (0.8 + fract(phase) * 2.0) + phase * 7.0);
        vTint = tint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * vTwinkle;
      }`,
    fragmentShader: `
      varying float vTwinkle; varying vec3 vTint;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vTint * glow, glow * vTwinkle);
      }`,
  })
  return new THREE.Points(geo, mat)
}

function nebulaSprite(color: string, size: number, pos: THREE.Vector3): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, color)
  g.addColorStop(0.4, color.replace(/0?\.\d+\)$/, '0.25)'))
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(size)
  sprite.position.copy(pos)
  return sprite
}

export class Sky {
  group = new THREE.Group()
  private layers: THREE.Points[]
  private nebulae: THREE.Sprite[] = []

  constructor(quality: 1 | 2 | 3 = 3) {
    const counts = { 1: [800, 300, 80], 2: [2000, 700, 160], 3: [4500, 1500, 300] }[quality]
    this.layers = [
      starLayer(counts[0], 2400, 1.6, 11), // far dust
      starLayer(counts[1], 1900, 2.6, 22), // mid
      starLayer(counts[2], 1500, 4.5, 33), // near bright
    ]
    this.layers.forEach((l) => this.group.add(l))
    const nebulaSpecs: Array<[string, number, THREE.Vector3]> = [
      ['rgba(122,66,196,0.8)', 1600, new THREE.Vector3(-900, 600, -1400)],
      ['rgba(18,160,176,0.7)', 1800, new THREE.Vector3(1000, -500, -1500)],
      ['rgba(208,74,146,0.6)', 1200, new THREE.Vector3(700, 800, -1300)],
      ['rgba(224,138,60,0.4)', 2000, new THREE.Vector3(0, 0, -1700)],
      ['rgba(66,120,220,0.5)', 1400, new THREE.Vector3(-1100, -700, -1600)],
    ]
    for (const [c, s, p] of nebulaSpecs) this.nebulae.push(nebulaSprite(c, s, p))
    this.nebulae.forEach((n) => this.group.add(n))
  }

  // Parallax: sky group counter-rotates slightly against camera movement,
  // with each layer at a different radius the depth reads naturally.
  update(time: number, harmonyPct: number) {
    for (const l of this.layers) (l.material as THREE.ShaderMaterial).uniforms.uTime.value = time
    // Slow differential drift gives the layers real parallax depth.
    this.layers[0].rotation.z = time * 0.003
    this.layers[1].rotation.z = time * 0.006
    this.layers[2].rotation.z = time * 0.01
    // ambient mood ring: warm when harmonious, cold/red as instability spreads
    const cold = 1 - harmonyPct / 100
    for (const n of this.nebulae) {
      const m = n.material as THREE.SpriteMaterial
      m.color.setRGB(1 + cold * 0.3, 1 - cold * 0.25, 1 - cold * 0.15)
    }
  }
}
