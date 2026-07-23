import { useCallback, useMemo, useState } from 'react';

import { createUuid } from './uuid';

export type NameCard = {
  id: string;
  name: string;
  colorSeed: number;
  autoRequeueDefault: boolean;
  createdAt: string;
  lastUsedAt: string;
};

export type LocalState = {
  version: 1;
  deviceToken: string;
  deviceProof: string | null;
  cards: NameCard[];
  prefs: {
    activeCardId: string | null;
    boardLayout: 'list' | 'table' | 'checklist' | 'cards';
    boardOrder: 'up_next' | 'as_added';
    sortDirection: 'asc' | 'desc';
    showFullDayByDefault: boolean;
    dockExpanded: boolean;
    reduceMotion: boolean | 'system';
  };
};

export type LocalStateController = {
  state: LocalState;
  activeCard: NameCard | null;
  setDeviceProof: (deviceProof: string | null) => void;
  saveCard: (name: string, autoRequeueDefault: boolean) => void;
  selectCard: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  restoreCard: (card: NameCard) => void;
  setBoardLayout: (boardLayout: LocalState['prefs']['boardLayout']) => void;
  setBoardOrder: (boardOrder: LocalState['prefs']['boardOrder']) => void;
  setSortDirection: (sortDirection: LocalState['prefs']['sortDirection']) => void;
  setShowFullDay: (showFullDay: boolean) => void;
  setDockExpanded: (dockExpanded: boolean) => void;
  setReduceMotion: (reduceMotion: LocalState['prefs']['reduceMotion']) => void;
};

const storageKey = 'arcadeq.v1';

function nameColorSeed(name: string): number {
  return Array.from(name).reduce(
    (seed, character) => (seed * 31 + character.codePointAt(0)!) >>> 0,
    7,
  );
}

function sortCardsByRecentUse(cards: NameCard[]): NameCard[] {
  return [...cards].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
}

export function createDefaultLocalState(): LocalState {
  return {
    version: 1,
    deviceToken: createUuid(),
    deviceProof: null,
    cards: [],
    prefs: {
      activeCardId: null,
      boardLayout: 'list',
      boardOrder: 'up_next',
      sortDirection: 'asc',
      showFullDayByDefault: false,
      dockExpanded: false,
      reduceMotion: 'system',
    },
  };
}

export function requiresNameCard(state: LocalState): boolean {
  return state.cards.length === 0;
}

function isLocalState(value: unknown): value is LocalState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<LocalState>;
  return (
    candidate.version === 1 &&
    typeof candidate.deviceToken === 'string' &&
    (typeof candidate.deviceProof === 'string' || candidate.deviceProof === null) &&
    Array.isArray(candidate.cards) &&
    candidate.cards.every(
      (card) =>
        typeof card === 'object' &&
        card !== null &&
        typeof card.id === 'string' &&
        typeof card.name === 'string' &&
        typeof card.colorSeed === 'number' &&
        typeof card.autoRequeueDefault === 'boolean' &&
        typeof card.createdAt === 'string' &&
        typeof card.lastUsedAt === 'string',
    ) &&
    typeof candidate.prefs === 'object' &&
    candidate.prefs !== null &&
    (typeof candidate.prefs.activeCardId === 'string' || candidate.prefs.activeCardId === null) &&
    ['list', 'table', 'checklist', 'cards'].includes(candidate.prefs.boardLayout ?? '') &&
    ['up_next', 'as_added'].includes(candidate.prefs.boardOrder ?? '') &&
    (candidate.prefs.sortDirection === undefined ||
      ['asc', 'desc'].includes(candidate.prefs.sortDirection)) &&
    typeof candidate.prefs.showFullDayByDefault === 'boolean' &&
    (candidate.prefs.dockExpanded === undefined ||
      typeof candidate.prefs.dockExpanded === 'boolean') &&
    (typeof candidate.prefs.reduceMotion === 'boolean' || candidate.prefs.reduceMotion === 'system')
  );
}

function loadLocalState(): LocalState {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return createDefaultLocalState();
    }

    const parsed: unknown = JSON.parse(stored);
    if (!isLocalState(parsed)) {
      return createDefaultLocalState();
    }
    // Merge over defaults so prefs added after this device was first stored get a value.
    return { ...parsed, prefs: { ...createDefaultLocalState().prefs, ...parsed.prefs } };
  } catch {
    return createDefaultLocalState();
  }
}

function persist(state: LocalState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The queue remains usable for this tab when local storage is unavailable.
  }
}

export function useLocalState(): LocalStateController {
  const [state, setState] = useState(loadLocalState);

  const updateState = useCallback((updater: (previous: LocalState) => LocalState) => {
    setState((previous) => {
      const next = updater(previous);
      persist(next);
      return next;
    });
  }, []);

  const setDeviceProof = useCallback(
    (deviceProof: string | null) => {
      updateState((previous) =>
        previous.deviceProof === deviceProof ? previous : { ...previous, deviceProof },
      );
    },
    [updateState],
  );

  const saveCard = useCallback(
    (name: string, autoRequeueDefault: boolean) => {
      updateState((previous) => {
        const now = new Date().toISOString();
        const existing = previous.cards.find((card) => card.name === name);
        const card = existing
          ? { ...existing, autoRequeueDefault, lastUsedAt: now }
          : {
              id: createUuid(),
              name,
              colorSeed: nameColorSeed(name),
              autoRequeueDefault,
              createdAt: now,
              lastUsedAt: now,
            };

        return {
          ...previous,
          cards: sortCardsByRecentUse(
            existing
              ? previous.cards.map((current) => (current.id === existing.id ? card : current))
              : [card, ...previous.cards],
          ),
          prefs: { ...previous.prefs, activeCardId: card.id },
        };
      });
    },
    [updateState],
  );

  const selectCard = useCallback(
    (cardId: string) => {
      updateState((previous) => {
        const now = new Date().toISOString();
        const cards = previous.cards.map((card) =>
          card.id === cardId ? { ...card, lastUsedAt: now } : card,
        );
        return {
          ...previous,
          cards: sortCardsByRecentUse(cards),
          prefs: { ...previous.prefs, activeCardId: cardId },
        };
      });
    },
    [updateState],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      updateState((previous) => {
        const cards = previous.cards.filter((card) => card.id !== cardId);
        return {
          ...previous,
          cards,
          prefs: {
            ...previous.prefs,
            activeCardId:
              previous.prefs.activeCardId === cardId
                ? (cards[0]?.id ?? null)
                : previous.prefs.activeCardId,
          },
        };
      });
    },
    [updateState],
  );

  const restoreCard = useCallback(
    (card: NameCard) => {
      updateState((previous) => {
        if (previous.cards.some((current) => current.id === card.id)) {
          return previous;
        }
        return {
          ...previous,
          cards: sortCardsByRecentUse([card, ...previous.cards]),
          prefs: {
            ...previous.prefs,
            activeCardId: previous.prefs.activeCardId ?? card.id,
          },
        };
      });
    },
    [updateState],
  );

  const setPreference = useCallback(
    <Key extends keyof LocalState['prefs']>(key: Key, value: LocalState['prefs'][Key]) => {
      updateState((previous) => ({
        ...previous,
        prefs: { ...previous.prefs, [key]: value },
      }));
    },
    [updateState],
  );

  const setBoardLayout = useCallback(
    (boardLayout: LocalState['prefs']['boardLayout']) => setPreference('boardLayout', boardLayout),
    [setPreference],
  );
  const setBoardOrder = useCallback(
    (boardOrder: LocalState['prefs']['boardOrder']) => setPreference('boardOrder', boardOrder),
    [setPreference],
  );
  const setSortDirection = useCallback(
    (sortDirection: LocalState['prefs']['sortDirection']) =>
      setPreference('sortDirection', sortDirection),
    [setPreference],
  );
  const setShowFullDay = useCallback(
    (showFullDay: boolean) => setPreference('showFullDayByDefault', showFullDay),
    [setPreference],
  );
  const setDockExpanded = useCallback(
    (dockExpanded: boolean) => setPreference('dockExpanded', dockExpanded),
    [setPreference],
  );
  const setReduceMotion = useCallback(
    (reduceMotion: LocalState['prefs']['reduceMotion']) =>
      setPreference('reduceMotion', reduceMotion),
    [setPreference],
  );

  const activeCard = useMemo(
    () => state.cards.find((card) => card.id === state.prefs.activeCardId) ?? null,
    [state.cards, state.prefs.activeCardId],
  );

  return {
    state,
    activeCard,
    setDeviceProof,
    saveCard,
    selectCard,
    removeCard,
    restoreCard,
    setBoardLayout,
    setBoardOrder,
    setSortDirection,
    setShowFullDay,
    setDockExpanded,
    setReduceMotion,
  };
}
