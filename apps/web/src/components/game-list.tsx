import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Gamepad2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { LocationDetailResponse } from '@machi2/shared';

import {
  fetchLocation,
  subscribeToLocationStream,
  type DeviceIdentity,
} from '../api';
import { errorMessage, type PublicConnectionState } from '../ui-shared';
import { ErrorPage, LoadingPage } from './feedback';

export function GameList({
  device,
  onConnectionChange,
}: {
  device: DeviceIdentity;
  onConnectionChange: (state: PublicConnectionState) => void;
}) {
  const { slug = '' } = useParams();
  const queryClient = useQueryClient();
  const location = useQuery({
    queryKey: ['location', slug],
    queryFn: () => fetchLocation(slug, device),
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!slug) {
      return;
    }
    const unsubscribe = subscribeToLocationStream(slug, device, {
      onEvent: (event) => {
        if (event.type === 'location-updated') {
          queryClient.setQueryData<LocationDetailResponse>(['location', slug], event.location);
        }
      },
      onState: onConnectionChange,
    });
    return () => {
      unsubscribe();
      onConnectionChange('idle');
    };
  }, [device, onConnectionChange, queryClient, slug]);

  if (location.isPending) {
    return <LoadingPage label="Loading games" />;
  }
  if (location.isError || !location.data) {
    return (
      <ErrorPage message={errorMessage(location.error)} onRetry={() => void location.refetch()} />
    );
  }

  return (
    <main className="page-shell">
      <Link className="back-link" to="/">
        <ArrowLeft aria-hidden="true" />
        Locations
      </Link>
      <section className="location-heading">
        <p className="eyebrow">{location.data.timezone}</p>
        <h1>{location.data.name}</h1>
        {location.data.address ? <p>{location.data.address}</p> : null}
      </section>
      <section aria-label="Games" className="game-list">
        {location.data.games.map((game) => (
          <Link
            aria-disabled={!game.isActive}
            className={`game-row${game.isActive ? '' : ' is-inactive'}`}
            key={game.id}
            onClick={(event) => {
              if (!game.isActive) {
                event.preventDefault();
              }
            }}
            to={`/l/${slug}/g/${game.id}`}
          >
            <span aria-hidden="true" className="game-mark">
              <Gamepad2 />
            </span>
            <span className="game-copy">
              <strong>{game.name}</strong>
              <span>{game.cabinetLabel ?? (game.isActive ? 'Open queue' : 'Queue closed')}</span>
            </span>
            {game.isActive ? (
              <QueueDepth count={game.waitingCount} />
            ) : (
              <span className="queue-closed">Closed</span>
            )}
            <ChevronRight aria-hidden="true" />
          </Link>
        ))}
      </section>
    </main>
  );
}

export function QueueDepth({ count }: { count: number }) {
  return (
    <span aria-label={`${count} waiting`} className="queue-depth">
      <span aria-hidden="true" className="depth-bars">
        {Array.from({ length: Math.min(5, Math.max(1, Math.ceil(count / 2))) }, (_, index) => (
          <i key={index} />
        ))}
      </span>
      <b>{count}</b>
    </span>
  );
}
