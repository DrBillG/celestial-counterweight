import * as THREE from 'three'
import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'
import { Orrery } from './render/orrery'
import { Director } from './game/director'

const app = document.getElementById('app')!
if (!webglAvailable()) {
  app.innerHTML =
    '<div style="color:#cfe3ff;font-family:monospace;padding:40vh 20px;text-align:center">Celestial Counterweight needs WebGL. Please try a modern desktop browser.</div>'
} else {
  const r = new Renderer(app)
  const director = new Director()
  const sky = new Sky()
  const orrery = new Orrery(director.sim)
  r.scene.add(sky.group, orrery.group)

  // Click → raycast the orrery → select that body as the transit target.
  const raycaster = new THREE.Raycaster()
  addEventListener('click', (e) => {
    raycaster.setFromCamera(
      new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
      r.camera,
    )
    const name = orrery.pick(raycaster)
    if (name) director.selectTarget(name)
  })

  // Dev aid: `?demo` advances the sim even when the tab is hidden, so the live
  // orrery (orbital motion + growing stability-colored trails) can be verified
  // in an automated/background preview. Default (no param) still pauses on hide.
  const demo = location.search.includes('demo')

  let last = performance.now()
  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1)
    last = t
    if (demo || !document.hidden) director.advance(dt) // tab-hidden pause (unless ?demo)
    sky.update(t / 1000, director.sim.harmony())
    orrery.update(t / 1000)
    r.render()
  }
  const loop = (t: number) => {
    frame(t)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // Browsers throttle requestAnimationFrame to ~0 in a hidden tab, so ?demo
  // needs a timer fallback to keep advancing while backgrounded (this is what
  // makes live motion + trails observable in an automated/headless preview).
  // Only runs when hidden, so it never double-drives the rAF loop when visible.
  if (demo) setInterval(() => { if (document.hidden) frame(performance.now()) }, 33)
}
