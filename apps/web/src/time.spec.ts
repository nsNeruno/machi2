import { describe, expect, it } from 'vitest';

import { formatQueueTime } from './time';

describe('formatQueueTime', () => {
  const now = Date.parse('2026-07-21T12:00:00.000Z');

  it('uses seconds and minutes before falling back to the location clock', () => {
    expect(formatQueueTime('2026-07-21T11:59:42.000Z', now, 'Asia/Jakarta')).toBe('18s ago');
    expect(formatQueueTime('2026-07-21T11:46:00.000Z', now, 'Asia/Jakarta')).toBe('14m ago');
  });

  it('uses the arcade timezone for older entries', () => {
    expect(formatQueueTime('2026-07-21T09:00:00.000Z', now, 'Asia/Jakarta')).toBe('16:00');
  });
});
