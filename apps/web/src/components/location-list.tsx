import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Gamepad2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';

import { fetchLocations, type DeviceIdentity } from '../api';
import { formatLocationClock } from '../time';
import { errorMessage, useNowTick } from '../ui-shared';
import { ErrorState, LoadingState } from './feedback';

export function LocationList({ device }: { device: DeviceIdentity }) {
  const now = useNowTick(60_000);
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => fetchLocations(device),
    refetchOnWindowFocus: false,
  });

  return (
    <main className="page-shell">
      <section className="page-intro">
        <p className="eyebrow">Arcade queues</p>
        <h1>Where are you playing?</h1>
      </section>
      {locations.isPending ? <LoadingState label="Loading locations" /> : null}
      {locations.isError ? (
        <ErrorState
          message={errorMessage(locations.error)}
          onRetry={() => void locations.refetch()}
        />
      ) : null}
      {locations.data?.length === 0 ? (
        <section className="empty-queue">
          <Info aria-hidden="true" />
          <p>No game centers are available yet.</p>
        </section>
      ) : null}
      {locations.data ? (
        <section aria-label="Available locations" className="location-list">
          {locations.data.map((location) => (
            <Link
              className={`location-row${location.isActive ? '' : ' is-inactive'}`}
              key={location.id}
              to={`/l/${location.slug}`}
            >
              <span aria-hidden="true" className="location-icon">
                <Gamepad2 />
              </span>
              <span className="location-copy">
                <strong>{location.name}</strong>
                <span>
                  {location.isActive ? 'Available' : 'Closed'} ·{' '}
                  {formatLocationClock(location.timezone, new Date(now))} there
                </span>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ))}
        </section>
      ) : null}
    </main>
  );
}
