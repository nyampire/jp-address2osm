export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number }

// 固定の窓で数える。窓が切り替わるときに全ての鍵を捨てるので、古い鍵は残らない
export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
}): (key: string) => RateLimitResult {
  const now = options.now ?? Date.now
  let windowStart = now()
  let counts = new Map<string, number>()
  return (key) => {
    const t = now()
    if (t - windowStart >= options.windowMs) {
      windowStart = t
      counts = new Map()
    }
    const n = (counts.get(key) ?? 0) + 1
    if (n > options.limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowStart + options.windowMs - t) / 1000)) }
    }
    counts.set(key, n)
    return { ok: true }
  }
}
