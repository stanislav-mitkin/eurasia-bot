export const COOLDOWN_MS = 60 * 1000; // 1 minute per restaurant

const lastRequest = new Map<string, number>();

// Purge stale entries every hour to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [key, ts] of lastRequest) {
    if (ts < cutoff) lastRequest.delete(key);
  }
}, 60 * 60 * 1000);

export function checkCooldown(userId: number, restId: number): number {
  const key = `${userId}:${restId}`;
  const last = lastRequest.get(key) ?? 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

export function recordRequest(userId: number, restId: number): void {
  lastRequest.set(`${userId}:${restId}`, Date.now());
}
