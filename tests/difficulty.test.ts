// Difficulty ladder: win-target scaling + persisted level progression.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  winTargetForLevel,
  plateauLevel,
  getLevel,
  recordWin,
  resetProgress,
} from '../src/game/difficulty'
import { SPHERE_MASS_REQUIRED } from '../src/constants'

// Minimal in-memory localStorage stand-in (node has none by default).
class MemStore {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
}

describe('winTargetForLevel', () => {
  it('level 1 is exactly the shipped constant (keeps the proven balance)', () => {
    expect(winTargetForLevel(1)).toBeCloseTo(SPHERE_MASS_REQUIRED, 10)
  })

  it('is strictly increasing until it reaches the plateau', () => {
    const p = plateauLevel()
    for (let l = 1; l < p; l++) {
      expect(winTargetForLevel(l + 1)).toBeGreaterThan(winTargetForLevel(l))
    }
  })

  it('clamps at the ceiling past the plateau (never impossible, never rising)', () => {
    const p = plateauLevel()
    const cap = winTargetForLevel(p)
    expect(winTargetForLevel(p + 5)).toBeCloseTo(cap, 10)
    // Ceiling stays within the efficient bot's ~0.024 achievable pool.
    expect(cap).toBeLessThanOrEqual(0.02 + 1e-9)
  })

  it('treats levels below 1 as level 1 (defensive)', () => {
    expect(winTargetForLevel(0)).toBeCloseTo(winTargetForLevel(1), 10)
  })
})

describe('level persistence', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore()
  })
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: MemStore }).localStorage
  })

  it('defaults to level 1 on a fresh store', () => {
    expect(getLevel()).toBe(1)
  })

  it('recordWin advances and persists the level', () => {
    expect(recordWin()).toBe(2)
    expect(getLevel()).toBe(2)
    expect(recordWin()).toBe(3)
    expect(getLevel()).toBe(3)
  })

  it('resetProgress returns to level 1', () => {
    recordWin()
    recordWin()
    resetProgress()
    expect(getLevel()).toBe(1)
  })
})

describe('level persistence without a store', () => {
  it('degrades to level 1 in-memory when localStorage is absent', () => {
    delete (globalThis as unknown as { localStorage?: MemStore }).localStorage
    expect(getLevel()).toBe(1)
    // recordWin still reports the next level for display, even if it can't persist.
    expect(recordWin()).toBe(2)
  })
})
