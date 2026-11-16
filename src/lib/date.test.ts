import { describe, it, expect } from 'vitest'
import { isToday } from './date'

describe('isToday', () => {
  it('returns true for the current date/time', () => {
    expect(isToday(new Date())).toBe(true)
  })

  it('returns true for a different time on the same calendar day', () => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1)
    expect(isToday(startOfToday)).toBe(true)
  })

  it('returns false for yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(isToday(yesterday)).toBe(false)
  })

  it('returns false for a date far in the future', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    expect(isToday(future)).toBe(false)
  })

  it('accepts an ISO string', () => {
    expect(isToday(new Date().toISOString())).toBe(true)
  })
})
