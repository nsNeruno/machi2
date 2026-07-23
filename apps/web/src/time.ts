export function formatQueueTime(isoTime: string, now: number, timezone: string): string {
  const deltaSeconds = Math.max(0, Math.floor((now - Date.parse(isoTime)) / 1_000));

  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }
  if (deltaSeconds < 3_600) {
    return `${Math.floor(deltaSeconds / 60)}m ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(isoTime));
}

export function formatLocationClock(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: timezone,
  }).format(now);
}
