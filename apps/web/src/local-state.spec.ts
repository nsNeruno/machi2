import { describe, expect, it } from 'vitest';

import { createDefaultLocalState, requiresNameCard } from './local-state';

describe('requiresNameCard', () => {
  it('requires onboarding for a new device state', () => {
    expect(requiresNameCard(createDefaultLocalState())).toBe(true);
  });

  it('allows the board once at least one card has been saved', () => {
    const state = createDefaultLocalState();

    state.cards.push({
      autoRequeueDefault: false,
      colorSeed: 1,
      createdAt: '2026-07-21T00:00:00.000Z',
      id: 'card-1',
      lastUsedAt: '2026-07-21T00:00:00.000Z',
      name: 'Mika',
    });

    expect(requiresNameCard(state)).toBe(false);
  });

  it('starts with the documented board display preferences', () => {
    expect(createDefaultLocalState().prefs).toMatchObject({
      boardLayout: 'list',
      boardOrder: 'up_next',
      dockExpanded: false,
      reduceMotion: 'system',
      sortDirection: 'asc',
      showFullDayByDefault: false,
    });
  });
});
