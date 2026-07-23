import { describe, expect, it, vi } from 'vitest';

import { LoadGovernorService } from './load-governor.service';

type Db = { db: unknown };

function makeGovernor(openStreams: number): {
  governor: LoadGovernorService;
  setStreams: (value: number) => void;
} {
  let streams = openStreams;
  const queueEvents = { totalOpenStreams: () => streams } as unknown as {
    totalOpenStreams: () => number;
  };
  // The governor only touches the DB in mirror/restore, which we don't exercise here.
  const dbService = { db: {} } as Db;
  const governor = new LoadGovernorService(
    dbService as never,
    queueEvents as never,
  );
  return { governor, setStreams: (value) => (streams = value) };
}

function tickOnce(governor: LoadGovernorService): void {
  (governor as unknown as { tick: () => void }).tick();
}

describe('LoadGovernorService', () => {
  it('escalates to shed when a signal crosses the shed band', () => {
    const { governor } = makeGovernor(500); // openStreams shed threshold is 400
    tickOnce(governor);
    expect(governor.level()).toBe('shed');
    expect(governor.writesShed()).toBe(true);
  });

  it('escalates to elevated in the elevated band', () => {
    const { governor } = makeGovernor(250); // 200 <= x < 400
    tickOnce(governor);
    expect(governor.level()).toBe('elevated');
    expect(governor.writesShed()).toBe(false);
  });

  it('steps up immediately but only recovers after the cooldown window', () => {
    const now = vi.spyOn(Date, 'now');
    let t = 1_000_000;
    now.mockImplementation(() => t);

    const { governor, setStreams } = makeGovernor(500);
    tickOnce(governor);
    expect(governor.level()).toBe('shed');

    // Signals calm down, but not enough time has passed to recover.
    setStreams(0);
    t += 5_000;
    tickOnce(governor);
    expect(governor.level()).toBe('shed');

    // After the recovery cooldown the level steps back down.
    t += 30_001;
    tickOnce(governor);
    expect(governor.level()).toBe('normal');

    now.mockRestore();
  });

  it('lets a manual override raise the floor without masking a real overload', async () => {
    const { governor, setStreams } = makeGovernor(0);
    // mirror() writes to the DB; stub it so the in-memory test stays isolated.
    vi.spyOn(governor as unknown as { mirror: () => Promise<void> }, 'mirror').mockResolvedValue();

    await governor.setOverride('maintenance', 'planned window');
    expect(governor.level()).toBe('maintenance');

    // Even after clearing, if signals demand shed the level stays shed.
    setStreams(500);
    await governor.setOverride(null, null);
    expect(governor.level()).toBe('shed');
  });
});
