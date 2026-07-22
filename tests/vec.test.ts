import { describe, it, expect } from 'vitest'
import { v, add, sub, scale, len, norm, dist } from '../src/sim/vec'

describe('vec', () => {
  it('adds and subtracts', () => {
    expect(add(v(1, 2), v(3, 4))).toEqual({ x: 4, y: 6 })
    expect(sub(v(3, 4), v(1, 2))).toEqual({ x: 2, y: 2 })
  })
  it('scales and measures', () => {
    expect(scale(v(1, 2), 3)).toEqual({ x: 3, y: 6 })
    expect(len(v(3, 4))).toBe(5)
    expect(dist(v(0, 0), v(0, 7))).toBe(7)
  })
  it('normalizes safely', () => {
    expect(norm(v(0, 5))).toEqual({ x: 0, y: 1 })
    expect(norm(v(0, 0))).toEqual({ x: 0, y: 0 }) // no NaN on zero vector
  })
})
