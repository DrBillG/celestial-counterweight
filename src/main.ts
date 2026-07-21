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

  let last = performance.now()
  const loop = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1)
    last = t
    if (!document.hidden) director.advance(dt) // tab-hidden pause
    sky.update(t / 1000, director.sim.harmony())
    orrery.update(t / 1000)
    r.render()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
