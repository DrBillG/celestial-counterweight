// Task 15: synthesized audio (no asset files — WebAudio oscillators only) plus
// gamepad haptics, driven by the director's event stream. This module is a pure
// CONSUMER of the public event union (GameEvent = SimEvent | DirectorEvent, the
// same array the HUD ingests): it never touches sim/ or game/ internals.
//
// Sound design goals: pleasant, not harsh. Short envelopes with a soft attack
// ramp and an exponential decay so nothing clicks. A burst of band events in a
// single frame is throttled to one klaxon per react() call so overlapping red
// crossings don't stack into a wall of noise.
import type { GameEvent } from '../game/director'

export class GameAudio {
  // Lazily created on the first user gesture (browsers block audio until then).
  private ctx: AudioContext | null = null

  // Call from the first user gesture (the main.ts click listener). Creates the
  // context on first call; on later calls it resumes a context the browser may
  // have auto-suspended (e.g. after a tab switch). Safe to call every click.
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctor) this.ctx = new Ctor()
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  // One oscillator + gain envelope, connected to destination, self-stopping.
  // attack: short linear ramp up to gainPeak; release: exponential decay to
  // near-silence over `dur`. A no-op until unlock() has created the context.
  private tone(freq: number, dur: number, type: OscillatorType, gainPeak: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    const t0 = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(ctx.destination)
    o.start(t0)
    o.stop(t0 + dur)
  }

  // ---- named sounds ------------------------------------------------------

  // Two-note rising activation chime — run start ("the Compressorator spins up").
  compressoratorChime(): void {
    this.tone(520, 0.5, 'sine', 0.15)
    setTimeout(() => this.tone(780, 0.7, 'sine', 0.12), 180)
  }

  // Soft single tone — a body slipped into amber.
  amberChime(): void {
    this.tone(660, 0.4, 'sine', 0.12)
  }

  // Two-tone descending sawtooth alarm — a body crossed into red/critical.
  klaxon(): void {
    this.tone(310, 0.35, 'sawtooth', 0.18)
    setTimeout(() => this.tone(250, 0.4, 'sawtooth', 0.18), 380)
  }

  // Low doom tone — a catastrophe (run-ending).
  catastrophe(): void {
    this.tone(120, 2.0, 'sawtooth', 0.25)
    this.tone(90, 2.4, 'triangle', 0.2)
  }

  // Short neutral blip — a fab was lost (setback, not game-over).
  fabLostBlip(): void {
    this.tone(440, 0.12, 'triangle', 0.12)
  }

  // Soft warning tone — a fragile body (mars/phobos) was selected.
  riskWarning(): void {
    this.tone(400, 0.5, 'triangle', 0.1)
  }

  // Optional gentle confirm for a player action (unused by react(); available
  // to main.ts if it wants an action-confirm cue).
  uiConfirm(): void {
    this.tone(880, 0.08, 'sine', 0.08)
  }

  // The supernova detonation in the loss cinematic — a huge layered boom with a
  // rising shriek and a long sub-bass tail.
  supernova(): void {
    this.tone(70, 2.6, 'sawtooth', 0.3)
    this.tone(48, 3.0, 'triangle', 0.28)
    this.tone(180, 1.4, 'sawtooth', 0.14)
    setTimeout(() => this.tone(90, 1.8, 'sine', 0.2), 120)
  }

  // ---- haptics -----------------------------------------------------------

  // Rumble the first connected gamepad. No gamepad (or no vibration actuator) →
  // silent no-op. getGamepads() itself can be absent on old browsers, hence the
  // optional call.
  private haptic(ms: number, strong: number): void {
    const pad = navigator.getGamepads?.()[0] as
      | (Gamepad & {
          vibrationActuator?: { playEffect: (type: string, opts: object) => Promise<string> }
        })
      | null
      | undefined
    void pad?.vibrationActuator?.playEffect('dual-rumble', {
      duration: ms,
      strongMagnitude: strong,
      weakMagnitude: strong * 0.6,
    })
  }

  // ---- event reaction ----------------------------------------------------

  // Map one frame's drained events to sounds + haptics. THROTTLE: a frame with
  // several red crossings fires at most one klaxon (and one red haptic) so the
  // alarm reads as a single alert rather than a stack. Catastrophe/amber/etc.
  // are rare enough per frame not to need throttling.
  react(events: GameEvent[]): void {
    let klaxonFired = false
    for (const e of events) {
      switch (e.type) {
        case 'band':
          if (e.to === 'amber') {
            this.amberChime()
          } else if (e.to === 'red' || e.to === 'critical') {
            if (!klaxonFired) {
              this.klaxon()
              this.haptic(400, 0.8)
              klaxonFired = true
            }
          }
          break
        case 'catastrophe':
          this.catastrophe()
          this.haptic(1200, 1.0)
          break
        case 'fabLost':
          this.fabLostBlip()
          break
        case 'riskWarning':
          this.riskWarning()
          break
      }
    }
  }
}
