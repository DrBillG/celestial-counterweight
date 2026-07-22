// Bridge dressing (Task 13): the "bridge view" is the same live 3D scene seen
// up close — the bridge-ness is set dressing, not geometry. A fixed HTML/CSS
// overlay draws a hull-window vignette (dark angled struts left/right/top + a
// deep inner shadow) that fades in when the camera dive arrives and out when it
// pulls back. Cheaper and crisper than modelling a cockpit in three, and it
// composits cleanly over the WebGL canvas without touching the render pipeline.
//
// The fade is eased in JS (time-based) each setVisible() call rather than via a
// CSS opacity transition: the frame's first show can land before the browser
// has committed a paint of the opacity:0 baseline (heavy WebGL init on the same
// first frame), and a CSS transition that never sees that baseline gets stuck
// at 0. A per-frame JS ease is paint-timing independent and always fades.
//
// setAlarm() adds a red edge glow for the Task 14 alarm wiring — implemented and
// wired to the visual here so Task 14 only has to toggle it.
export class BridgeFrame {
  private el: HTMLDivElement
  private alarm = false
  private opacity = 0
  private target = 0
  private lastT = performance.now()

  // Seconds for a full 0<->1 hull-frame fade.
  private static readonly FADE_SECONDS = 0.5

  // Base shadow when the frame is visible: a deep interior vignette PLUS a
  // faint blue-white inner rim (the lit edge of the viewport glass) and a soft
  // inner glow, so the frame clearly reads as a ship window rather than a vague
  // darkening. setAlarm swaps the rim/glow to red on top of the same vignette.
  private static readonly BASE_SHADOW =
    'inset 0 0 200px 30px rgba(0,0,0,0.95), inset 0 0 0 2px rgba(150,180,225,0.3), inset 0 0 28px rgba(120,160,210,0.14)'
  private static readonly ALARM_SHADOW =
    'inset 0 0 200px 30px rgba(0,0,0,0.95), inset 0 0 0 2px rgba(235,90,90,0.5), inset 0 0 70px rgba(224,60,60,0.55)'

  constructor(hud: HTMLElement) {
    this.el = document.createElement('div')
    // Angled corner struts (the hull window frame) via layered linear-gradients:
    //  - the 105deg pair darkens the left/right edges into slanted struts,
    //  - the 180deg pair caps the top/bottom,
    // leaving a bright central "pane" the scene shows through. Opacity is driven
    // frame-by-frame from setVisible() (no CSS transition — see header note).
    this.el.style.cssText = `
      position:absolute; inset:0; opacity:0; pointer-events:none;
      background:
        linear-gradient(105deg, #04060b 0%, #04060b 6%, rgba(6,9,15,0.9) 13%, transparent 26%, transparent 74%, rgba(6,9,15,0.9) 87%, #04060b 94%, #04060b 100%),
        linear-gradient(180deg, #04060b 0%, #04060b 4%, rgba(6,9,15,0.88) 10%, transparent 22%, transparent 80%, rgba(6,9,15,0.9) 90%, #04060b 96%, #04060b 100%);
      box-shadow: ${BridgeFrame.BASE_SHADOW};`
    hud.appendChild(this.el)
  }

  // Fade the hull frame in (camera at bridge pose) or out (pulled back to god
  // view). Called every frame with cameraDirector.isBridge(); the opacity eases
  // toward the target over FADE_SECONDS using a real-time delta so the fade is
  // smooth and frame-rate independent.
  setVisible(v: boolean): void {
    this.target = v ? 1 : 0
    const now = performance.now()
    const dt = Math.min((now - this.lastT) / 1000, 0.1)
    this.lastT = now
    const step = dt / BridgeFrame.FADE_SECONDS
    if (this.opacity < this.target) this.opacity = Math.min(this.target, this.opacity + step)
    else if (this.opacity > this.target) this.opacity = Math.max(this.target, this.opacity - step)
    this.el.style.opacity = this.opacity.toFixed(3)
  }

  // Red edge glow for the alarm state (Task 14 wires this to critical-band
  // events). Idempotent; safe to call every frame.
  setAlarm(on: boolean): void {
    if (on === this.alarm) return
    this.alarm = on
    this.el.style.boxShadow = on ? BridgeFrame.ALARM_SHADOW : BridgeFrame.BASE_SHADOW
  }

  // Tear-down for scene rebuilds (Task 16 autoscale/restart), mirroring the
  // dispose() pattern on Renderer/Orrery.
  dispose(): void {
    this.el.remove()
  }
}
