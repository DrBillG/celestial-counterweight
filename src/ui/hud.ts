// Task 14: the holographic HUD — the DOM overlay that makes the sim playable.
//
// Everything here is driven each frame by update(director, events): the Hud
// only READS the Director's public API (state, cargo, sphereProgress,
// currentTarget, activeExtraction, bodyRisk, decisionRemaining,
// transitRemaining, sim.harmony, sim.tracker.heldBand) and the ONE per-frame
// drained event array. It never mutates the sim/director except through the
// player-action callbacks wired by main.ts (onChoice). It touches no
// src/sim/* or src/game/* file.
//
// Mounted in #hud (pointer-events:none). Every interactive element carries
// class 'clickable' so only buttons re-enable pointer-events — the rest of the
// overlay stays click-through so orrery picking keeps working underneath.
//
// Adaptations from the plan's (pre-API-change) HUD snippet, per the task brief:
//  - events are the GameEvent union (SimEvent | DirectorEvent), not SimEvent[].
//  - Return Slag is director.chooseExtraction('slag') (there is no dumpSlag),
//    and the card only shows with cargo > 0 (amendment 9/11 — slag returns
//    held cargo).
//  - Inspector surfaces bodyRisk() as a badge (fragile ⚠ red / trophy gold /
//    standard none) and stability via sim.tracker.heldBand (amendment 13b).
//  - riskWarning / fabLost / extractionFloor / placementRejected DirectorEvents
//    feed the alert stack and the transient fragile-body banner (amendment 13b,
//    12d — phobos/mars are unrescuable traps the HUD must telegraph).
//  - Alarm (bridge red edge-glow, amendment 13/Task 13 setAlarm) is owned here:
//    driven off an event-tracked set of red/critical bodies so it clears when
//    nothing is actively red/critical, and latches on for catastrophe (game
//    over). main.ts does NOT also toggle setAlarm — single owner, no fighting.
import type { Director, GameEvent, BodyRisk } from '../game/director'
import type { BridgeFrame } from '../render/bridge'

// Holographic palette.
const CYAN = '#57c8ff'
const GOLD = '#ffd75e'
const GREEN = '#4a9d6f'
const AMBER = '#e0b34e'
const RED = '#e05e5e'
const INK = '#cfe3ff'

const PANEL =
  'position:absolute;background:rgba(10,16,32,.86);border:1px solid rgba(87,200,255,.35);' +
  'border-radius:6px;color:#cfe3ff;padding:10px 14px;font-size:13px;letter-spacing:.4px;' +
  'font-family:ui-monospace,monospace;backdrop-filter:blur(3px);box-shadow:0 0 18px rgba(20,60,110,.35),inset 0 0 12px rgba(40,110,180,.10);'

// Static composition flavor per selectable body (cosmetic — omitted for bodies
// not in the map, e.g. gas giants the player never mines directly).
const COMPOSITION: Record<string, string> = {
  titan: 'CH₄ · H₂O · Si',
  moon: 'Si · Fe · O₂',
  phobos: 'C · Si · Fe',
  mars: 'Fe₂O₃ · Si · CO₂',
  io: 'S · SiO₂',
  europa: 'H₂O · Si',
  ganymede: 'H₂O · Fe · Si',
}

const BAND_COLOR: Record<string, string> = {
  green: GREEN,
  amber: AMBER,
  red: RED,
  critical: RED,
}

export class Hud {
  private top: HTMLDivElement
  private inspector: HTMLDivElement
  private cards: HTMLDivElement
  private alerts: HTMLDivElement
  private banner: HTMLDivElement
  private endScreen: HTMLDivElement
  private coach: HTMLDivElement
  private danger: HTMLDivElement
  private transit: HTMLDivElement
  private toast: HTMLDivElement
  private cardsSig = ''
  private inspectorSig = ''

  private alertLines: string[] = []
  // Bodies currently in a red/critical band (event-tracked): the alarm is on
  // iff this set is non-empty (or a catastrophe latched it). Clears cleanly
  // when every red body recovers to amber/green.
  private redBodies = new Set<string>()
  private alarmLatched = false
  private bannerUntil = 0
  private lastCause = ''

  // Player-action callback — main.ts wires this to director actions. Set by
  // main after construction; bindClicks() delegates all button clicks here.
  onChoice: (id: string) => void = () => {}

  // bridge is optional so the Hud can be unit-constructed without a BridgeFrame;
  // in the real app main.ts always passes it so the alarm edge-glow works.
  constructor(root: HTMLElement, private bridge?: BridgeFrame) {
    // Global button feedback: hover lifts, press depresses + brightens, and a
    // JS-added .cc-hit class flashes on click. Buttons are now stable DOM (see
    // the signature guards in renderCards/renderInspector) so these actually show.
    root.insertAdjacentHTML(
      'beforeend',
      `<style>
        .cc-btn{transition:transform .08s,box-shadow .12s,filter .08s}
        .cc-btn:hover{filter:brightness(1.25);transform:translateY(-1px)}
        .cc-btn:active{transform:scale(.95);filter:brightness(1.6)}
        .cc-hit{animation:ccflash .28s ease-out}
        @keyframes ccflash{0%{filter:brightness(2.2)}100%{filter:brightness(1)}}
      </style>`,
    )
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="cc-top" style="${PANEL}top:10px;left:50%;transform:translateX(-50%);display:flex;gap:22px;align-items:center;white-space:nowrap"></div>
       <div id="cc-inspector" class="clickable" style="${PANEL}top:64px;right:12px;width:236px;display:none"></div>
       <div id="cc-cards" class="clickable" style="position:absolute;bottom:26px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:stretch"></div>
       <div id="cc-alerts" style="${PANEL}bottom:26px;right:12px;width:236px;border-color:rgba(224,94,94,.55);display:none"></div>
       <div id="cc-banner" style="${PANEL}top:118px;left:50%;transform:translateX(-50%);max-width:70vw;text-align:center;border-color:rgba(224,94,94,.7);color:${RED};font-size:15px;font-weight:bold;text-shadow:0 0 10px rgba(224,60,60,.6);display:none"></div>
       <div id="cc-end" class="clickable" style="${PANEL}top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;padding:26px 34px;display:none"></div>
       <div id="cc-coach" style="${PANEL}top:58px;left:50%;transform:translateX(-50%);max-width:64vw;text-align:center;border-color:rgba(87,200,255,.45);color:${CYAN};font-size:13px;display:none"></div>
       <div id="cc-danger" style="${PANEL}top:58px;left:50%;transform:translateX(-50%);max-width:70vw;text-align:center;font-weight:bold;font-size:14px;display:none"></div>
       <div id="cc-transit" style="${PANEL}top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;padding:16px 26px;border-color:rgba(87,200,255,.6);min-width:260px;display:none"></div>
       <div id="cc-toast" style="${PANEL}bottom:150px;left:50%;transform:translateX(-50%);text-align:center;font-weight:bold;font-size:15px;border-color:rgba(87,200,255,.7);color:${CYAN};text-shadow:0 0 10px ${CYAN}88;display:none"></div>`,
    )
    this.top = root.querySelector('#cc-top')!
    this.inspector = root.querySelector('#cc-inspector')!
    this.cards = root.querySelector('#cc-cards')!
    this.alerts = root.querySelector('#cc-alerts')!
    this.banner = root.querySelector('#cc-banner')!
    this.endScreen = root.querySelector('#cc-end')!
    this.coach = root.querySelector('#cc-coach')!
    this.danger = root.querySelector('#cc-danger')!
    this.transit = root.querySelector('#cc-transit')!
    this.toast = root.querySelector('#cc-toast')!
  }

  // If any body is wobbling (amber+), return the WORST one with an actionable
  // instruction tailored to what the player can do right now. null = all calm.
  private dangerGuidance(d: Director): { color: string; text: string } | null {
    const order: Record<string, number> = { green: 0, amber: 1, red: 2, critical: 3 }
    let worst: { name: string; band: string } | null = null
    for (const b of d.sim.bodies) {
      if (!b.parentName || b.kind === 'ship' || b.kind === 'fab') continue
      const band = d.sim.tracker.heldBand(b.name)
      if (band === 'green') continue
      if (!worst || order[band] > order[worst.band]) worst = { name: b.name, band }
    }
    if (!worst) return null
    const N = worst.name.toUpperCase()
    const atThisBody = d.state === 'mining' && d.currentTarget() === worst.name
    let action: string
    if (atThisBody && d.cargo > 0) action = 'press ↩ RETURN SLAG to hold it, or 🚀 DEPART and build a counterweight'
    else if (atThisBody) action = '🚀 DEPART and build a counterweight to save it'
    else action = 'deliver cargo at the fab and press ⬡ COUNTERWEIGHT PLACEMENT to steady it'
    const urgency = worst.band === 'critical' ? ' — ACT NOW or lose it!' : ''
    return { color: BAND_COLOR[worst.band as 'amber' | 'red' | 'critical'], text: `⚠ ${N} orbit is ${worst.band.toUpperCase()} — ${action}${urgency}` }
  }

  // Brief centre-screen confirmation of a player action ("▸ DEPARTING", etc.).
  private toastHideAt = 0
  flash(msg: string): void {
    this.toast.textContent = msg
    this.toast.style.display = 'block'
    this.toast.classList.remove('cc-hit')
    void this.toast.offsetWidth // restart the flash animation
    this.toast.classList.add('cc-hit')
    this.toastHideAt = performance.now() + 1100
  }

  // The single most useful "what do I do next" line, by game state. Keeps a
  // first-time player oriented without a full tutorial.
  private coachText(d: Director): string {
    switch (d.state) {
      case 'orrery':
        if (!d.currentTarget()) return 'Click a glowing moon (they pulse) to pick a mining target.'
        if (d.currentTarget() === 'fab') return 'Press ▸ PLOT COURSE to fly to the sun and build.'
        if (d.cargo > 0) return 'You have cargo — press ▸ DELIVER TO FAB to build the sphere.'
        return 'Press ▸ PLOT COURSE & LAUNCH to travel to the selected body.'
      case 'transit':
        return ''
      case 'mining':
        if (!d.activeExtraction()) return 'Press ⛏ LATTICE BORE to mine gently (STRIP BLAST is faster but risky).'
        if (d.cargo > 0) return 'Mining… press 🚀 DEPART TO FAB when you have enough cargo.'
        return 'Mining…'
      case 'constructing':
        return 'Press ⬡ COUNTERWEIGHT PLACEMENT before the timer runs out.'
      default:
        return ''
    }
  }

  // Delegate every data-id button/element click in the HUD to onChoice.
  bindClicks(root: HTMLElement): void {
    // Use pointerdown, not click: it fires instantly on press (no wait for
    // mouseup) so the action feels immediate, and it can't be dropped by a
    // button rebuild between down and up.
    root.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null
      if (!el) return
      // Instant visual pop on the pressed button.
      el.classList.remove('cc-hit')
      void el.offsetWidth
      el.classList.add('cc-hit')
      this.onChoice(el.dataset.id!)
    })
  }

  private riskBadge(risk: BodyRisk): string {
    if (risk === 'fragile')
      return `<span style="color:${RED};text-shadow:0 0 8px rgba(224,60,60,.7)">⚠ FRAGILE</span>`
    if (risk === 'trophy') return `<span style="color:${GOLD}">★ TROPHY</span>`
    return `<span style="opacity:.5">STANDARD</span>`
  }

  private card(id: string, color: string, title: string, sub: string, active = false): string {
    const glow = active ? `box-shadow:0 0 0 2px ${color},0 0 16px ${color};` : ''
    const tag = active ? ` <span style="font-size:10px">● ACTIVE</span>` : ''
    return (
      `<button class="clickable cc-btn" data-id="${id}" style="${PANEL}position:static;border-color:${color};${glow}` +
      `cursor:pointer;min-width:158px;text-align:left">` +
      `<div style="color:${color};font-weight:bold;text-shadow:0 0 8px ${color}88">${title}${tag}</div>` +
      `<div style="opacity:.7;font-size:11px;margin-top:3px">${sub}</div></button>`
    )
  }

  update(d: Director, events: GameEvent[]): void {
    this.ingest(events)
    this.renderTop(d)
    this.renderInspector(d)
    this.renderCards(d)
    this.renderAlerts()
    this.renderBanner()
    this.renderTransit(d)
    this.renderCoachAndDanger(d)
    this.renderEnd(d)
    if (this.toastHideAt && performance.now() > this.toastHideAt) {
      this.toast.style.display = 'none'
      this.toastHideAt = 0
    }
    this.bridge?.setAlarm(this.alarmLatched || this.redBodies.size > 0)
  }

  private renderCoachAndDanger(d: Director): void {
    const over = d.state === 'won' || d.state === 'lost' || d.state === 'transit'
    // Danger guidance wins the slot when a moon is in trouble — it's the more
    // urgent message. The gentle next-step coach shows only when all is calm.
    const danger = over ? null : this.dangerGuidance(d)
    if (danger) {
      this.coach.style.display = 'none'
      this.danger.style.display = 'block'
      this.danger.textContent = danger.text
      this.danger.style.color = danger.color
      this.danger.style.borderColor = danger.color + '99'
      this.danger.style.textShadow = `0 0 10px ${danger.color}66`
      return
    }
    this.danger.style.display = 'none'
    const text = over ? '' : this.coachText(d)
    if (!text) {
      this.coach.style.display = 'none'
      return
    }
    this.coach.style.display = 'block'
    this.coach.textContent = text
  }

  private renderTransit(d: Director): void {
    if (d.state !== 'transit') {
      this.transit.style.display = 'none'
      return
    }
    const dest = (d.currentTarget() ?? '').toUpperCase()
    const pct = Math.round(d.transitProgress() * 100)
    this.transit.style.display = 'block'
    this.transit.innerHTML =
      `<div style="color:${CYAN};font-weight:bold;letter-spacing:1px;text-shadow:0 0 10px ${CYAN}88">▸ EN ROUTE — ${dest}</div>` +
      `<div style="height:8px;background:#0c1526;border-radius:5px;margin:10px 0 4px;overflow:hidden">` +
      `<div style="height:100%;width:${pct}%;background:${CYAN};box-shadow:0 0 8px ${CYAN}"></div></div>` +
      `<div style="opacity:.7;font-size:11px">arriving in ${d.transitRemaining().toFixed(1)}s · click 🔥 SLINGSHOT BURN to speed up</div>`
  }

  // ---- event ingestion ----------------------------------------------------

  private ingest(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'band': {
          if (ev.to === 'red' || ev.to === 'critical') this.redBodies.add(ev.body)
          else this.redBodies.delete(ev.body) // recovered to amber/green
          if (ev.to === 'amber' || ev.to === 'red' || ev.to === 'critical')
            this.pushAlert(`⚠ ${ev.body.toUpperCase()} → ${ev.to.toUpperCase()}`, BAND_COLOR[ev.to])
          break
        }
        case 'catastrophe': {
          this.alarmLatched = true
          this.lastCause = `${ev.body.toUpperCase()} ${ev.kind.toUpperCase()}`
          this.pushAlert(`☄ ${this.lastCause}`, RED)
          break
        }
        case 'fabLost':
          this.pushAlert(`⚙ FAB LOST (${ev.cause})`, AMBER)
          break
        case 'riskWarning': {
          const body = ev.body.toUpperCase()
          const moon = ev.body === 'mars' ? ' — mining its moon Phobos is unrecoverable' : ''
          this.pushAlert(`⚠ ${body} FRAGILE`, RED)
          this.banner.innerHTML = `⚠ ${body} IS UNSTABLE${moon}`
          this.bannerUntil = performance.now() + 5000
          break
        }
        case 'extractionFloor':
          this.pushAlert(`⛏ ${ev.body.toUpperCase()} DEPLETED (floor)`, CYAN)
          break
        case 'placementRejected':
          this.pushAlert(`⬡ PLACEMENT REJECTED — cargo held`, AMBER)
          break
      }
    }
  }

  private pushAlert(text: string, color: string): void {
    this.alertLines.unshift(`<span style="color:${color}">${text}</span>`)
    this.alertLines = this.alertLines.slice(0, 5)
  }

  // ---- panels -------------------------------------------------------------

  private renderTop(d: Director): void {
    const h = d.sim.harmony()
    const hColor = h > 80 ? GREEN : h > 55 ? AMBER : RED
    const pct = Math.min(100, d.sphereProgress())
    this.top.innerHTML =
      `<span style="color:${GOLD};text-shadow:0 0 8px ${GOLD}66">◉ DYSON SPHERE ${pct.toFixed(1)}%` +
      `<span style="display:inline-block;width:80px;height:6px;margin-left:8px;vertical-align:middle;` +
      `background:rgba(255,255,255,.10);border-radius:3px;overflow:hidden;border:1px solid ${GOLD}55">` +
      `<span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:${GOLD};box-shadow:0 0 8px ${GOLD}"></span></span></span>` +
      `<span style="color:#7fb3ff;opacity:.85">⏱ TEMPORAL COMPRESSORATOR ×80,000</span>` +
      `<span style="color:${hColor};text-shadow:0 0 8px ${hColor}55">HARMONY ${h.toFixed(0)}%</span>` +
      `<span style="color:${CYAN}">CARGO ${d.cargo.toFixed(4)}</span>`
  }

  private renderInspector(d: Director): void {
    const t = d.currentTarget()
    const show = t && t !== 'fab' && (d.state === 'orrery' || d.state === 'mining')
    if (!show) {
      this.inspector.style.display = 'none'
      return
    }
    const name = t!
    const body = d.sim.bodies.find((b) => b.name === name)
    if (!body) {
      this.inspector.style.display = 'none'
      return
    }
    this.inspector.style.display = 'block'
    const comp = COMPOSITION[name]
    const active = d.state === 'mining' ? d.activeExtraction() : null
    // Signature guard: rebuild the panel (and its buttons) only when the button
    // SET / structural content changes — never every frame — so a click can't be
    // dropped by an innerHTML rebuild mid-press. Volatile numbers (mass %,
    // stability band) live in child spans updated below without a rebuild.
    const sig = `${name}|${d.state}|${d.cargo > 0}|${d.bodyRisk(name)}|${active}`
    if (sig !== this.inspectorSig) {
      this.inspectorSig = sig
      const deselect =
        d.state === 'orrery'
          ? `<button class="clickable cc-btn" data-id="deselect" title="deselect" style="${PANEL}position:absolute;top:8px;right:8px;` +
            `padding:0 7px;line-height:20px;border-color:${CYAN};color:${CYAN};cursor:pointer">✕</button>`
          : ''
      this.inspector.innerHTML =
        deselect +
        `<div style="color:${CYAN};font-weight:bold;letter-spacing:1px">◈ ${name.toUpperCase()}</div>` +
        `<div style="margin:4px 0 6px">${this.riskBadge(d.bodyRisk(name))}</div>` +
        (comp ? `<div style="opacity:.6;font-size:11px">composition ${comp}</div>` : '') +
        `<div style="opacity:.75;margin-top:4px">mass extracted <b id="cc-insp-spent">—</b></div>` +
        `<div style="opacity:.75">stability <span id="cc-insp-stab">—</span></div>` +
        (active ? `<div style="color:${CYAN};opacity:.85;margin-top:4px">▸ ${active.toUpperCase()} ENGAGED</div>` : '') +
        (d.state === 'orrery'
          ? `<button class="clickable cc-btn" data-id="launch" style="${PANEL}position:static;display:block;width:100%;margin-top:10px;` +
            `border-color:${CYAN};color:${CYAN};cursor:pointer;text-align:center">▸ PLOT COURSE &amp; LAUNCH</button>`
          : '') +
        (d.state === 'orrery' && d.cargo > 0
          ? `<button class="clickable cc-btn" data-id="to-fab" style="${PANEL}position:static;display:block;width:100%;margin-top:6px;` +
            `border-color:${GOLD};color:${GOLD};cursor:pointer;text-align:center">▸ DELIVER TO FAB</button>`
          : '')
    }
    // Volatile numbers, updated without rebuilding the buttons.
    const spentEl = this.inspector.querySelector('#cc-insp-spent')
    if (spentEl) spentEl.textContent = `${((1 - body.mass / body.m0) * 100).toFixed(1)}%`
    const stabEl = this.inspector.querySelector('#cc-insp-stab') as HTMLElement | null
    if (stabEl) {
      if (body.parentName && body.kind !== 'ship' && body.kind !== 'fab') {
        const band = d.sim.tracker.heldBand(name)
        stabEl.textContent = band.toUpperCase()
        stabEl.style.color = BAND_COLOR[band]
      } else {
        stabEl.textContent = '—'
        stabEl.style.color = ''
      }
    }
  }

  private renderCards(d: Director): void {
    // CRITICAL: only rebuild the button DOM when the button SET changes, never
    // every frame — a click that spanned a frame's innerHTML rebuild used to be
    // silently dropped (buttons destroyed mid-press). Volatile numbers (the
    // transit/decision countdowns) update via a stable child span instead.
    const mode = d.activeExtraction()
    const sig = `${d.state}|${mode}|${d.cargo > 0}`
    if (sig !== this.cardsSig) {
      this.cardsSig = sig
      if (d.state === 'transit') {
        this.cards.innerHTML = this.card(
          'burn',
          CYAN,
          '🔥 SLINGSHOT BURN',
          'arrive sooner · <span id="cc-cardtimer"></span>',
        )
      } else if (d.state === 'mining') {
        this.cards.innerHTML =
          this.card('strip', AMBER, '⛏ STRIP BLAST', 'fast · HIGH wobble ▲▲▲', mode === 'strip') +
          this.card('lattice', GREEN, '⛏ LATTICE BORE', 'slow · LOW wobble ▲', mode === 'lattice') +
          (d.cargo > 0
            ? this.card('slag', CYAN, '↩ RETURN SLAG', 'give cargo back · heal orbit', mode === 'slag')
            : '') +
          this.card('to-fab', INK, '🚀 DEPART TO FAB', 'stop mining · deliver cargo')
      } else if (d.state === 'constructing') {
        this.cards.innerHTML =
          `<div style="${PANEL}position:static;border-color:${RED};color:${RED};display:flex;align-items:center;` +
          `font-size:16px;font-weight:bold;text-shadow:0 0 10px ${RED}66">DECISION <span id="cc-cardtimer" style="margin-left:6px"></span></div>` +
          this.card('place-suggested', GREEN, '⬡ COUNTERWEIGHT PLACEMENT', 'stabilizes worst orbit') +
          this.card('place-hasty', AMBER, '⬡ HASTY PLACEMENT', 'instant · no rebalance value')
      } else {
        this.cards.innerHTML = ''
      }
    }
    // Volatile countdown text — updated WITHOUT touching the buttons.
    const timer = this.cards.querySelector('#cc-cardtimer')
    if (timer) {
      if (d.state === 'transit') timer.textContent = `${d.transitRemaining().toFixed(1)}s`
      else if (d.state === 'constructing') timer.textContent = `${d.decisionRemaining().toFixed(1)}s`
    }
  }

  private renderAlerts(): void {
    if (!this.alertLines.length) {
      this.alerts.style.display = 'none'
      return
    }
    this.alerts.style.display = 'block'
    this.alerts.innerHTML =
      `<div style="color:${CYAN};font-size:11px;opacity:.6;margin-bottom:4px;letter-spacing:1px">ALERT STACK</div>` +
      this.alertLines.join('<br>')
  }

  private renderBanner(): void {
    this.banner.style.display = performance.now() < this.bannerUntil ? 'block' : 'none'
  }

  private lostShownAt = 0
  private renderEnd(d: Director): void {
    if (d.state !== 'won' && d.state !== 'lost') {
      this.endScreen.style.display = 'none'
      this.lostShownAt = 0
      return
    }
    if (d.state === 'won') {
      this.endScreen.style.display = 'block'
      this.endScreen.innerHTML =
        `<div style="color:${GOLD};font-size:26px;text-shadow:0 0 16px ${GOLD}88">☀ SPHERE COMPLETE</div>` +
        `<div style="font-size:13px;opacity:.85;margin-top:8px">The system hums in balance.</div>` +
        this.restartButton(GOLD)
      return
    }
    // LOST: let the supernova cinematic play first — hold the panel back ~5.2s,
    // then drop the (deliberately celebratory) game-over card over the afterglow.
    if (!this.lostShownAt) this.lostShownAt = performance.now()
    if (performance.now() - this.lostShownAt < 5200) {
      this.endScreen.style.display = 'none'
      return
    }
    const cause = this.lastCause
      ? `<div style="font-size:12px;opacity:.7;margin-top:6px">first to go: ${this.lastCause}</div>`
      : ''
    this.endScreen.style.display = 'block'
    this.endScreen.innerHTML =
      `<div style="color:${GOLD};font-size:24px;text-shadow:0 0 20px ${GOLD}">🎉 CONGRATULATIONS 🎉</div>` +
      `<div style="color:${RED};font-size:19px;font-weight:bold;margin-top:8px;text-shadow:0 0 16px ${RED}88">You just blew up the entire solar system.</div>` +
      `<div style="font-size:13px;opacity:.85;margin-top:8px">Gravity always collects. Every last planet, into the sun.</div>` +
      cause +
      this.restartButton(RED)
  }

  private restartButton(color: string): string {
    return (
      `<button class="clickable" data-id="restart" style="${PANEL}position:static;display:inline-block;margin-top:16px;` +
      `border-color:${color};color:${color};cursor:pointer">↻ Reload to play again</button>`
    )
  }
}
