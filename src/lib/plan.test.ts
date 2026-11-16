import { describe, it, expect } from 'vitest'
import { canCreateOrder } from './plan'

describe('canCreateOrder', () => {
  it('blocks the free plan once the monthly limit is reached', () => {
    const result = canCreateOrder({ plan: 'free', orders_this_month: 20 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/limite/i)
  })

  it('allows the free plan below the monthly limit', () => {
    const result = canCreateOrder({ plan: 'free', orders_this_month: 19 })
    expect(result.allowed).toBe(true)
  })

  it('never blocks unlimited plans', () => {
    expect(canCreateOrder({ plan: 'basic', orders_this_month: 100_000 }).allowed).toBe(true)
    expect(canCreateOrder({ plan: 'pro', orders_this_month: 100_000 }).allowed).toBe(true)
  })
})
