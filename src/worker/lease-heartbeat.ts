export const generationLeaseMs = 30_000;
export const generationLeaseHeartbeatMs = 10_000;

export async function withLeaseHeartbeat<T>(
  work: () => Promise<T>,
  renew: () => Promise<void>,
  heartbeatMs = generationLeaseHeartbeatMs
): Promise<T> {
  let renewalError: unknown;
  let renewal: Promise<void> | null = null;

  await renew();
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = renew()
      .catch((error) => {
        renewalError = error;
      })
      .finally(() => {
        renewal = null;
      });
  }, heartbeatMs);

  try {
    const result = await work();
    if (renewal) await renewal;
    if (renewalError) throw renewalError;
    return result;
  } finally {
    clearInterval(timer);
    if (renewal) await renewal;
  }
}
