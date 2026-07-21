import * as THREE from 'three'
import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'
import { Orrery } from './render/orrery'
import { CameraDirector } from './render/cameraDirector'
import { BridgeFrame } from './render/bridge'
import { Director } from './game/director'
import { Hud } from './ui/hud'

const app = document.getElementById('app')!
const hud = document.getElementById('hud')!
if (!webglAvailable()) {
  app.innerHTML =
    '<div style="color:#cfe3ff;font-family:monospace;padding:40vh 20px;text-align:center">Celestial Counterweight needs WebGL. Please try a modern desktop browser.</div>'
} else {
  const r = new Renderer(app)
  const director = new Director()
  const sky = new Sky()
  const orrery = new Orrery(director.sim)
  r.scene.add(sky.group, orrery.group)

  // Camera director owns the camera each frame (position, lookAt, near plane):
  // it dives from the god view down to a bridge view behind the ship when the
  // Director is mining/constructing, and pulls back out otherwise. The bridge
  // frame is the hull-window dressing that fades in at the bottom of the dive.
  const cameraDirector = new CameraDirector(r.camera, director)
  const bridgeFrame = new BridgeFrame(hud)

  // Holographic HUD: top bar, target inspector, choice cards, alert stack,
  // end screens. Driven each frame by update(director, events). It owns the
  // bridge alarm edge-glow (passed in), so main never toggles setAlarm itself.
  const hudUi = new Hud(hud, bridgeFrame)
  hudUi.bindClicks(hud)
  hudUi.onChoice = (id) => {
    switch (id) {
      case 'launch': director.launch(); break
      case 'burn': director.burn(); break
      case 'strip': director.chooseExtraction('strip'); break
      case 'lattice': director.chooseExtraction('lattice'); break
      case 'slag': director.chooseExtraction('slag'); break
      case 'to-fab': director.selectTarget('fab'); director.launch(); break
      case 'place-suggested': director.placeSegment('suggested'); break
      case 'place-hasty': director.placeSegment('hasty'); break
      case 'restart': location.reload(); break
    }
  }

  // Click → raycast the orrery → select that body as the transit target.
  // HUD buttons are class 'clickable' and stop here via their own delegated
  // handler; a stray click that hits a body still selects it (harmless).
  const raycaster = new THREE.Raycaster()
  addEventListener('click', (e) => {
    // Ignore clicks that landed on an interactive HUD element — those are
    // player-action buttons, not orrery target picks.
    if ((e.target as HTMLElement).closest('.clickable')) return
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
  const demo = new URLSearchParams(location.search).has('demo')

  // Dev aid (gated strictly by `?demo`): expose the director + camera director
  // so an automated preview can script a run to a given state (e.g. drive to
  // 'mining' on titan) and observe the cinematic dive. Never present in the
  // default (no-param) path, so there is no debug residue in production.
  if (demo) {
    ;(window as unknown as { __cc: unknown }).__cc = { director, cameraDirector }
  }

  let last = performance.now()
  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1)
    last = t
    if (demo || !document.hidden) director.advance(dt) // tab-hidden pause (unless ?demo)
    // drainEvents() CLEARS the queue and must be called exactly ONCE per frame;
    // the single drained array is the sole event source for every consumer this
    // frame. (The orrery reads tracker/band state directly, so it is not an
    // event consumer and is not starved by this drain.) When advance() was
    // skipped this frame, the queue is empty and this is a harmless no-op.
    const events = director.drainEvents()
    // HUD owns the bridge alarm internally (via events + red/critical tracking).
    hudUi.update(director, events)
    // Camera dive is driven AFTER director.advance so it reads the current
    // state (mining/constructing) this frame, not last frame's.
    cameraDirector.update(dt)
    bridgeFrame.setVisible(cameraDirector.isBridge())
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
