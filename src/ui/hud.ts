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
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="cc-top" style="${PANEL}top:10px;left:50%;transform:translateX(-50%);display:flex;gap:22px;align-items:center;white-space:nowrap"></div>
       <div id="cc-inspector" class="clickable" style="${PANEL}top:64px;right:12px;width:236px;display:none"></div>
       <div id="cc-cards" class="clickable" style="position:absolute;bottom:26px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:stretch"></div>
       <div id="cc-alerts" style="${PANEL}bottom:26px;right:12px;width:236px;border-color:rgba(224,94,94,.55);display:none"></div>
       <div id="cc-banner" style="${PANEL}top:118px;left:50%;transform:translateX(-50%);max-width:70vw;text-align:center;border-color:rgba(224,94,94,.7);color:${RED};font-size:15px;font-weight:bold;text-shadow:0 0 10px rgba(224,60,60,.6);display:none"></div>
       <div id="cc-end" class="clickable" style="${PANEL}top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;padding:26px 34px;display:none"></div>`,
    )
    this.top = root.querySelector('#cc-top')!
    this.inspector = root.querySelector('#cc-inspector')!
    this.cards = root.querySelector('#cc-cards')!
    this.alerts = root.querySelector('#cc-alerts')!
    this.banner = root.querySelector('#cc-banner')!
    this.endScreen = root.querySelector('#cc-end')!
  }

  // Delegate every data-id button/element click in the HUD to onChoice.
  bindClicks(root: HTMLElement): void {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null
      if (el) this.onChoice(el.dataset.id!)
    })
  }

  private riskBadge(risk: BodyRisk): string {
    if (risk === 'fragile')
      return `<span style="color:${RED};text-shadow:0 0 8px rgba(224,60,60,.7)">⚠ FRAGILE</span>`
    if (risk === 'trophy') return `<span style="color:${GOLD}">★ TROPHY</span>`
    return `<span style="opacity:.5">STANDARD</span>`
  }

  private card(id: string, color: string, title: string, sub: string): string {
    return (
      `<button class="clickable" data-id="${id}" style="${PANEL}position:static;border-color:${color};` +
      `cursor:pointer;min-width:158px;text-align:left;transition:box-shadow .15s">` +
      `<div style="color:${color};font-weight:bold;text-shadow:0 0 8px ${color}88">${title}</div>` +
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
    this.renderEnd(d)
    this.bridge?.setAlarm(this.alarmLatched || this.redBodies.size > 0)
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
    const spent = ((1 - body.mass / body.m0) * 100).toFixed(1)
    // heldBand throws for untracked bodies (sun/ship/fab); guard on parentName.
    let stability = '<span style="opacity:.5">—</span>'
    if (body.parentName && body.kind !== 'ship' && body.kind !== 'fab') {
      const band = d.sim.tracker.heldBand(name)
      stability = `<span style="color:${BAND_COLOR[band]}">${band.toUpperCase()}</span>`
    }
    const comp = COMPOSITION[name]
    const active = d.state === 'mining' ? d.activeExtraction() : null
    this.inspector.style.display = 'block'
    // ✕ deselect only in orrery (before committing a course); mining is committed.
    const deselect =
      d.state === 'orrery'
        ? `<button class="clickable" data-id="deselect" title="deselect" style="${PANEL}position:absolute;top:8px;right:8px;` +
          `padding:0 7px;line-height:20px;border-color:${CYAN};color:${CYAN};cursor:pointer">✕</button>`
        : ''
    this.inspector.innerHTML =
      deselect +
      `<div style="color:${CYAN};font-weight:bold;letter-spacing:1px">◈ ${name.toUpperCase()}</div>` +
      `<div style="margin:4px 0 6px">${this.riskBadge(d.bodyRisk(name))}</div>` +
      (comp ? `<div style="opacity:.6;font-size:11px">composition ${comp}</div>` : '') +
      `<div style="opacity:.75;margin-top:4px">mass extracted <b>${spent}%</b></div>` +
      `<div style="opacity:.75">stability ${stability}</div>` +
      (active ? `<div style="color:${CYAN};opacity:.85;margin-top:4px">▸ ${active.toUpperCase()} ENGAGED</div>` : '') +
      (d.state === 'orrery'
        ? `<button class="clickable" data-id="launch" style="${PANEL}position:static;display:block;width:100%;margin-top:10px;` +
          `border-color:${CYAN};color:${CYAN};cursor:pointer;text-align:center">▸ PLOT COURSE &amp; LAUNCH</button>`
        : '') +
      (d.state === 'orrery' && d.cargo > 0
        ? `<button class="clickable" data-id="to-fab" style="${PANEL}position:static;display:block;width:100%;margin-top:6px;` +
          `border-color:${GOLD};color:${GOLD};cursor:pointer;text-align:center">▸ DELIVER TO FAB</button>`
        : '')
  }

  private renderCards(d: Director): void {
    if (d.state === 'transit') {
      this.cards.innerHTML = this.card(
        'burn',
        CYAN,
        '🔥 SLINGSHOT BURN',
        `arrive sooner · transit ${d.transitRemaining().toFixed(0)}s`,
      )
    } else if (d.state === 'mining') {
      this.cards.innerHTML =
        this.card('strip', AMBER, '⛏ STRIP BLAST', 'fast · HIGH wobble ▲▲▲') +
        this.card('lattice', GREEN, '⛏ LATTICE BORE', 'slow · LOW wobble ▲') +
        (d.cargo > 0 ? this.card('slag', CYAN, '↩ RETURN SLAG', 'give cargo back · heal orbit') : '') +
        this.card('to-fab', INK, '🚀 DEPART TO FAB', 'deliver cargo')
    } else if (d.state === 'constructing') {
      const secs = d.decisionRemaining()
      this.cards.innerHTML =
        `<div style="${PANEL}position:static;border-color:${RED};color:${RED};display:flex;align-items:center;` +
        `font-size:16px;font-weight:bold;text-shadow:0 0 10px ${RED}66">DECISION ${secs.toFixed(1)}s</div>` +
        this.card('place-suggested', GREEN, '⬡ COUNTERWEIGHT PLACEMENT', 'stabilizes worst orbit') +
        this.card('place-hasty', AMBER, '⬡ HASTY PLACEMENT', 'instant · no rebalance value')
    } else {
      this.cards.innerHTML = ''
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

  private renderEnd(d: Director): void {
    if (d.state !== 'won' && d.state !== 'lost') {
      this.endScreen.style.display = 'none'
      return
    }
    this.endScreen.style.display = 'block'
    if (d.state === 'won') {
      this.endScreen.innerHTML =
        `<div style="color:${GOLD};font-size:26px;text-shadow:0 0 16px ${GOLD}88">☀ SPHERE COMPLETE</div>` +
        `<div style="font-size:13px;opacity:.85;margin-top:8px">The system hums in balance.</div>` +
        this.restartButton(GOLD)
    } else {
      const cause = this.lastCause ? `<div style="font-size:12px;opacity:.7;margin-top:4px">cause: ${this.lastCause}</div>` : ''
      this.endScreen.innerHTML =
        `<div style="color:${RED};font-size:26px;text-shadow:0 0 16px ${RED}88">☄ SYSTEM LOST</div>` +
        `<div style="font-size:13px;opacity:.85;margin-top:8px">Gravity always collects.</div>` +
        cause +
        this.restartButton(RED)
    }
  }

  private restartButton(color: string): string {
    return (
      `<button class="clickable" data-id="restart" style="${PANEL}position:static;display:inline-block;margin-top:16px;` +
      `border-color:${color};color:${color};cursor:pointer">↻ Reload to play again</button>`
    )
  }
}
