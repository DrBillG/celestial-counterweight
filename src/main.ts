import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'

const app = document.getElementById('app')!
if (!webglAvailable()) {
  app.innerHTML =
    '<div style="color:#cfe3ff;font-family:monospace;padding:40vh 20px;text-align:center">Celestial Counterweight needs WebGL. Please try a modern desktop browser.</div>'
} else {
  const r = new Renderer(app)
  const sky = new Sky()
  r.scene.add(sky.group)
  const loop = (t: number) => {
    sky.update(t / 1000, 100)
    r.render()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
