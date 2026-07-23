// Difficulty ladder (post-launch retune): the game is meant to be learnable —
// a first-timer loses a couple of runs while they figure out the mine-gently →
// counterweight loop, then wins around the 3rd–4th try. Once won, it should
// keep challenging them. This module is the whole escalation layer, kept
// entirely OUT of the physics core so none of the delicately-tuned sim
// constants (RUNAWAY_ACCEL, ASSIST_K, the null-test envelope, …) are at risk.
//
// The single difficulty knob is the Dyson-sphere WIN TARGET (delivered mass to
// win), which is read only by the Director — nothing in sim/ depends on it. A
// higher target means more clean delivery rounds, which means more exposure to
// fatal mistakes AND forces the player deeper into the depleting mass pool
// (bodies approach their extraction floor, so late mass is scarcer and pushes
// toward riskier targets). So raising it increases genuine difficulty and
// danger, not busywork.
//
// Progress (the current level) persists in localStorage across page reloads
// (restart is a full reload — see main.ts). A WIN advances the level; a LOSS
// leaves it unchanged, so the player retries the same level until they master
// it, then it steps up.
import { SPHERE_MASS_REQUIRED } from '../constants'

const STORAGE_KEY = 'cc-level'

// Level 1 IS the shipped, proven-honest balance: SPHERE_MASS_REQUIRED (0.014)
// sits above the greedy bot's hard 3-delivery bank ceiling (~0.012) so reckless
// play loses, and below the efficient bot's ~0.024 measured ceiling so careful
// play wins. Keeping BASE tied to the constant means every scenario/director
// test (which constructs a default-target Director) stays valid untouched.
const BASE = SPHERE_MASS_REQUIRED
// Per-level bump. Small enough to give several distinct tiers before the cap.
const INCREMENT = 0.0015
// Plateau just under the ~0.021–0.024 best-play achievable pool, so the hardest
// tier stays technically winnable (demands near-flawless play) rather than
// impossible. Levels past the plateau all sit here — an endless "flawless run"
// wall rather than a broken unwinnable one.
const CEILING = 0.02

// Delivered-mass win target for a given level (level 1 = BASE, clamped to the
// achievable ceiling at the top). Exported for the Director and for display.
export function winTargetForLevel(level: number): number {
  const raw = BASE + (Math.max(1, level) - 1) * INCREMENT
  return Math.min(raw, CEILING)
}

// The highest level whose target is still below the plateau — i.e. the last
// level that is meaningfully harder than the one before it. Used only for HUD
// copy ("MAX difficulty reached"), never for gameplay.
export function plateauLevel(): number {
  return Math.ceil((CEILING - BASE) / INCREMENT) + 1
}

// localStorage is unavailable in some contexts (private mode, tests, SSR). Every
// access is guarded; on failure the ladder degrades to an in-memory default of
// level 1 (playable, just not persisted).
function readStore(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw == null) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1 ? n : null
  } catch {
    return null
  }
}

function writeStore(level: number): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(level))
  } catch {
    // Persisting is best-effort; a blocked store just means no cross-reload memory.
  }
}

// The level the player is currently on (defaults to 1 on a fresh browser).
export function getLevel(): number {
  return readStore() ?? 1
}

// Record a win: advance to the next level and persist it. Returns the new level
// so the caller can show a "LEVEL N unlocked" message. Idempotency (fire once
// per win) is the CALLER's job — main.ts latches it.
export function recordWin(): number {
  const next = getLevel() + 1
  writeStore(next)
  return next
}

// Reset the ladder back to level 1 (a "start over" affordance on the end screen).
export function resetProgress(): void {
  writeStore(1)
}
