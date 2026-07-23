import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { LayoutList, ListChecks, PanelsTopLeft, Table2 } from 'lucide-react';
import type { DoneReason } from '@machi2/shared';

import { ApiError, type ConnectionState, type DeviceIdentity } from './api';
import type { LocalStateController, NameCard } from './local-state';

export type PublicConnectionState = ConnectionState | 'idle';

export type Toast = {
  id: number;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export const queueLayouts = [
  {
    value: 'list',
    label: 'List',
    icon: LayoutList,
    description: 'Roomy rows, one player each. Best for a glance.',
  },
  {
    value: 'table',
    label: 'Table',
    icon: Table2,
    description: 'Compact rows that fit more of the line on screen.',
  },
  {
    value: 'checklist',
    label: 'Checklist',
    icon: ListChecks,
    description: 'Tick players off as they finish their turn.',
  },
  {
    value: 'cards',
    label: 'Cards',
    icon: PanelsTopLeft,
    description: 'Big, easy-to-tap cards, two across.',
  },
] as const;

export const doneReasons: Array<{ reason: DoneReason; label: string; icon: string }> = [
  { reason: 'played', label: 'Played', icon: '✓' },
  { reason: 'left', label: 'Left', icon: '⊘' },
  { reason: 'skipped', label: 'Skipped', icon: '»' },
  { reason: 'other', label: 'Other', icon: '•' },
];

const RATE_LIMITED_MESSAGE =
  'You’re tapping a little too fast. Wait a few seconds, then try again.';

const FRIENDLY_ERROR_BY_CODE: Record<string, string> = {
  rate_limited: RATE_LIMITED_MESSAGE,
  load_shed: 'The queue is very busy right now. Give it a moment and try again.',
  stream_limit_reached: 'Too many live connections from here. Close a tab and try again.',
  queue_full: 'This queue is full right now. Try again once the line moves.',
  already_in_queue: 'You’re already in this queue on this device.',
  rejoin_cooldown: 'You just left this queue. Wait a moment before re-joining.',
  entry_already_done: 'That entry was already marked done.',
  queue_entry_not_current: 'The queue just changed. Refresh and try again.',
  game_unavailable: 'This game isn’t taking a queue right now.',
  staff_pin_required: 'A staff PIN is needed to change another player’s entry.',
  invalid_staff_pin: 'That staff PIN wasn’t right. Check with staff and try again.',
  database_unavailable: 'The queue service is briefly unreachable. Try again shortly.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const friendly = error.code ? FRIENDLY_ERROR_BY_CODE[error.code] : undefined;
    if (friendly) {
      return friendly;
    }
    if (error.status === 429 || /too many requests|throttler/i.test(error.message)) {
      return RATE_LIMITED_MESSAGE;
    }
    // Never surface a raw "SomethingException: ..." technical string to players.
    if (/exception|error:/i.test(error.message)) {
      return 'Something went wrong updating the queue. Try again in a moment.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'The queue could not be updated.';
}

export function formatServiceDate(serviceDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${serviceDate}T00:00:00`));
}

export function deviceFrom(local: LocalStateController): DeviceIdentity {
  return {
    deviceToken: local.state.deviceToken,
    deviceProof: local.state.deviceProof,
    setDeviceProof: local.setDeviceProof,
  };
}

export function useNowTick(interval = 10_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);

  return now;
}

export function cardStyle(card: NameCard): CSSProperties {
  return { '--card-hue': String(card.colorSeed % 360) } as CSSProperties;
}

// Tracks a CSS media query so layout can branch in JS while staying in sync with the
// stylesheet's breakpoints. Wide-screen layouts key off `WIDE_SCREEN_QUERY`.
export const WIDE_SCREEN_QUERY = '(min-width: 40rem)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
}

// Reveals a compact sticky header once the sentinel (placed under the hero) scrolls
// out of view, so the game name and queue count stay in reach while scrolling.
export function useScrolledPast(): [(node: HTMLElement | null) => void, boolean] {
  const [pinned, setPinned] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setSentinel = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setPinned(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        }
      },
      { threshold: 0 },
    );
    observerRef.current.observe(node);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [setSentinel, pinned];
}
