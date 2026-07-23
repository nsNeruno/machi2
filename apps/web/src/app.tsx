import { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import {
  requiresNameCard,
  type NameCard,
  useLocalState,
} from './local-state';
import { usePwaInstallPrompt } from './pwa';
import { deviceFrom, type PublicConnectionState, type Toast } from './ui-shared';
import { AppHeader, ConnectionBanner, MenuDrawer, ToastMessage } from './components/app-chrome';
import { CardsDrawer, CardsRoute } from './components/cards';
import { OnboardingDialog } from './components/dialogs';
import { About, NotFound } from './components/feedback';
import { GameList } from './components/game-list';
import { LocationList } from './components/location-list';
import { QueueBoard } from './components/queue-board';

export function App() {
  const local = useLocalState();
  const device = useMemo(
    () => deviceFrom(local),
    [local.setDeviceProof, local.state.deviceProof, local.state.deviceToken],
  );
  const { canInstall, install } = usePwaInstallPrompt();
  const [cardsOpen, setCardsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<PublicConnectionState>('idle');
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const needsOnboarding = requiresNameCard(local.state);

  const showToast = useCallback((nextToast: Omit<Toast, 'id'>) => {
    setToast({ ...nextToast, id: Date.now() });
  }, []);

  const setPublicConnectionState = useCallback((nextState: PublicConnectionState) => {
    setConnectionState((currentState) => (currentState === nextState ? currentState : nextState));
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const removeCard = useCallback(
    (card: NameCard) => {
      local.removeCard(card.id);
      showToast({
        message: `${card.name} removed from this device.`,
        action: {
          label: 'Undo',
          onClick: () => {
            local.restoreCard(card);
            setToast(null);
          },
        },
      });
    },
    [local, showToast],
  );

  return (
    <>
      <div
        aria-hidden={needsOnboarding}
        className="app-frame"
        data-reduce-motion={local.state.prefs.reduceMotion === true ? 'true' : 'system'}
        inert={needsOnboarding}
      >
        <AppHeader
          activeName={local.activeCard?.name ?? null}
          canInstall={canInstall}
          cardCount={local.state.cards.length}
          onInstall={() => void install()}
          onOpenCards={() => setCardsOpen(true)}
          onOpenMenu={() => setMenuOpen(true)}
        />
        <ConnectionBanner serviceDate={serviceDate} state={connectionState} />
        <Routes>
          <Route element={<LocationList device={device} />} path="/" />
          <Route
            element={<GameList device={device} onConnectionChange={setPublicConnectionState} />}
            path="/l/:slug"
          />
          <Route
            element={
              <QueueBoard
                device={device}
                local={local}
                onConnectionChange={setPublicConnectionState}
                onOpenCards={() => setCardsOpen(true)}
                onServiceDateChange={setServiceDate}
                onToast={showToast}
              />
            }
            path="/l/:slug/g/:gameId"
          />
          <Route element={<CardsRoute local={local} onRemoveCard={removeCard} />} path="/cards" />
          <Route element={<About />} path="/about" />
          <Route element={<NotFound />} path="*" />
        </Routes>
        {cardsOpen ? (
          <CardsDrawer
            local={local}
            onClose={() => setCardsOpen(false)}
            onRemoveCard={removeCard}
          />
        ) : null}
        {menuOpen ? <MenuDrawer local={local} onClose={() => setMenuOpen(false)} /> : null}
        {toast ? <ToastMessage toast={toast} onClose={() => setToast(null)} /> : null}
      </div>
      {needsOnboarding ? <OnboardingDialog local={local} /> : null}
    </>
  );
}
