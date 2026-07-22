import * as THREE from 'three'
import { Renderer, webglAvailable } from './render/renderer'
import { Sky } from './render/sky'
import { Orrery } from './render/orrery'
import { CameraDirector } from './render/cameraDirector'
import { BridgeFrame } from './render/bridge'
import { Director } from './game/director'
import { Hud } from './ui/hud'
import { GameAudio } from './audio/audio'

const app = document.getElementById('app')!
const hud = document.getElementById('hud')!
if (!webglAvailable()) {
  app.innerHTML =
    '<div style="position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;' +
    'color:#cfe3ff;font-family:ui-monospace,monospace;text-align:center;padding:0 24px;line-height:1.6">' +
    '<div style="font-size:20px;letter-spacing:2px;color:#ffd27a">CELESTIAL COUNTERWEIGHT</div>' +
    '<div style="max-width:440px;color:#9fb6d6">This game needs WebGL, which your browser has disabled or does not support. ' +
    'Please try a current desktop browser (Chrome, Firefox, Edge, or Safari) with hardware acceleration enabled.</div>' +
    '</div>'
} else {
  const r = new Renderer(app)
  const director = new Director()
  // `let` (not const): the perf autoscaler below rebuilds the sky at a lower
  // quality tier if frames stay slow.
  let sky = new Sky()
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

  // Synthesized audio + gamepad haptics (Task 15). Pure event-stream consumer:
  // unlocked on the first user gesture (below), then fed the SAME drained event
  // array the HUD gets, each frame. `started` gates the run-start chime to the
  // very first unlock.
  const audio = new GameAudio()
  let audioStarted = false
  hudUi.onChoice = (id) => {
    // Instant audio confirmation on every action (the click already popped the
    // button visually + a toast follows for the big state changes).
    audio.unlock()
    audio.uiConfirm()
    switch (id) {
      case 'launch': director.launch(); hudUi.flash(`▸ PLOTTING COURSE — ${(director.currentTarget() ?? '').toUpperCase()}`); break
      case 'burn': director.burn(); hudUi.flash('🔥 SLINGSHOT'); break
      case 'strip': director.chooseExtraction('strip'); hudUi.flash('⛏ STRIP BLAST ENGAGED'); break
      case 'lattice': director.chooseExtraction('lattice'); hudUi.flash('⛏ LATTICE BORE ENGAGED'); break
      case 'slag': director.chooseExtraction('slag'); hudUi.flash('↩ RETURNING SLAG'); break
      case 'to-fab': director.selectTarget('fab'); director.launch(); hudUi.flash('🚀 DEPARTING TO FAB'); break
      case 'place-suggested': {
        const before = director.sphereProgress()
        director.placeSegment('suggested')
        const gain = director.sphereProgress() - before
        hudUi.flash(gain > 0.01 ? `✓ COUNTERWEIGHT PLACED · +${gain.toFixed(1)}%` : '⚠ NO SPOT — TRY HASTY')
        break
      }
      case 'place-hasty': {
        const before = director.sphereProgress()
        director.placeSegment('hasty')
        const gain = director.sphereProgress() - before
        hudUi.flash(gain > 0.01 ? `✓ SEGMENT PLACED · +${gain.toFixed(1)}%` : '⚠ PLACEMENT BLOCKED')
        break
      }
      case 'deselect': director.clearTarget(); break
      // Restart is a full page reload, NOT a soft in-place reset. This is
      // deliberate (amendment 15): the Sim keeps catastrophe/fabLost bodies in
      // sim.bodies and the Orrery has no dispose(), so a soft reset would leak
      // dead-body meshes and stale GPU buffers. reload() rebuilds the whole
      // scene cleanly and sidesteps both for v1.
      case 'restart': location.reload(); break
    }
  }

  // Click → raycast the orrery → select that body as the transit target.
  // HUD buttons are class 'clickable' and stop here via their own delegated
  // handler; a stray click that hits a body still selects it (harmless).
  const raycaster = new THREE.Raycaster()
  addEventListener('click', (e) => {
    // First user gesture unlocks/resumes audio (browsers require it). On the
    // very first unlock, play the run-start Compressorator chime once.
    audio.unlock()
    if (!audioStarted) {
      audioStarted = true
      audio.compressoratorChime()
    }
    // Ignore clicks that landed on an interactive HUD element — those are
    // player-action buttons, not orrery target picks.
    if ((e.target as HTMLElement).closest('.clickable')) return
    raycaster.setFromCamera(
      new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
      r.camera,
    )
    const name = orrery.pick(raycaster)
    // Hit a minable body → select it. Missed (empty space) → deselect, so the
    // player can back out of a pick by clicking away.
    if (name) director.selectTarget(name)
    else director.clearTarget()
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
    ;(window as unknown as { __cc: unknown }).__cc = { director, cameraDirector, audio }
  }

  // PERFORMANCE AUTOSCALE (Task 16). A rolling-average frame time; if it stays
  // above ~22ms (≈45fps) for ~5 consecutive seconds we step the sky DOWN one
  // quality tier (3→2→1), disposing the old sky so we don't leak GPU buffers.
  // At the lowest tier, if it's STILL slow, bloom is dropped as a last resort.
  // Downscale-only (never back up) so it can't oscillate; once at tier 1 with
  // bloom reduced the whole check goes inert.
  let frameAvg = 16
  let skyQuality: 1 | 2 | 3 = 3
  let slowSince = 0
  let bloomReduced = false
  let lostAt = -1 // perf ms when the loss cinematic began (one-time setup latch)
  let novaFired = false

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
    // Audio reacts to the SAME drained event array (no second drainEvents() —
    // that would clear the queue and starve the HUD).
    audio.react(events)
    // Camera dive is driven AFTER director.advance so it reads the current
    // state (mining/constructing) this frame, not last frame's.
    cameraDirector.update(dt)
    bridgeFrame.setVisible(cameraDirector.isBridge())
    sky.update(t / 1000, director.sim.harmony())
    if (director.state === 'lost') {
      // Loss cinematic: the orrery takes over — planets spiral into the sun and
      // it goes supernova. One-time setup: crank bloom for the blowout + a boom.
      if (lostAt < 0) {
        lostAt = t
        bridgeFrame.setVisible(false)
        r.setBloom(1.9)
      }
      const el = (t - lostAt) / 1000
      if (!novaFired && el >= 3.7) {
        novaFired = true
        audio.supernova()
      }
      orrery.playCataclysm(t / 1000, r.camera)
    } else {
      orrery.setSelected(director.currentTarget())
      // Beacon the wobbling moon the HUD is pointing at, so it's easy to find.
      orrery.setAttention(hudUi.attentionBody())
      orrery.update(t / 1000, r.camera)
    }
    r.render()

    // Autoscale check (see block above the loop). EMA of the per-frame compute
    // time; sustained-slow trips at most one downscale step per 5s window.
    frameAvg = frameAvg * 0.95 + (performance.now() - t) * 0.05
    if (frameAvg > 22 && (skyQuality > 1 || !bloomReduced)) {
      if (!slowSince) slowSince = t
      else if (t - slowSince > 5000) {
        if (skyQuality > 1) {
          skyQuality = (skyQuality - 1) as 1 | 2
          r.scene.remove(sky.group)
          sky.dispose() // free the old sky's GPU buffers/textures before rebuild
          sky = new Sky(skyQuality)
          r.scene.add(sky.group)
          console.warn(`[perf] frame avg ${frameAvg.toFixed(1)}ms — sky quality → ${skyQuality}`)
        } else if (!bloomReduced) {
          bloomReduced = true
          r.reduceBloom()
          console.warn(`[perf] frame avg ${frameAvg.toFixed(1)}ms — bloom reduced (min sky tier)`)
        }
        slowSince = 0 // start a fresh 5s window before the next possible step
      }
    } else {
      slowSince = 0 // recovered (or nothing left to do): reset the timer
    }
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
