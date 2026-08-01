import { forwardRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  LoaderCircle,
  MapPinOff,
  RefreshCw,
} from 'lucide-react';
import type { LocationValidationResponse } from '@machi2/shared';

import type { LocationCheckState } from '../location-validation';

export const LocationCheckCard = forwardRef<
  HTMLElement,
  {
    state: LocationCheckState;
    validation: Extract<LocationValidationResponse, { required: true }>;
    onCheck: () => void;
  }
>(function LocationCheckCard({ state, validation, onCheck }, ref) {
  const copy = getLocationCheckCopy(state, validation);
  const isBlockingError = ![
    'checking',
    'disabled',
    'idle',
    'verified',
  ].includes(state.status);
  const Icon =
    state.status === 'verified'
      ? CheckCircle2
      : state.status === 'checking'
        ? LoaderCircle
        : state.status === 'outside_range' || state.status === 'permission_denied'
          ? MapPinOff
          : state.status === 'idle'
            ? Crosshair
            : AlertTriangle;

  return (
    <aside
      aria-atomic="true"
      aria-live={isBlockingError ? 'assertive' : 'polite'}
      className={`location-check is-${state.status}`}
      ref={ref}
      role={isBlockingError ? 'alert' : 'status'}
      tabIndex={-1}
    >
      <Icon aria-hidden="true" className={state.status === 'checking' ? 'is-spinning' : ''} />
      <div className="location-check-copy">
        <strong>{copy.title}</strong>
        <p>{copy.message}</p>
        {state.status !== 'checking' ? (
          <button className="secondary-button" onClick={onCheck} type="button">
            <RefreshCw aria-hidden="true" />
            {state.status === 'idle' ? 'Check my location' : 'Check again'}
          </button>
        ) : null}
      </div>
    </aside>
  );
});

export function getLocationCheckCopy(
  state: LocationCheckState,
  validation: Extract<LocationValidationResponse, { required: true }>,
): { title: string; message: string } {
  switch (state.status) {
    case 'idle':
      return {
        title: 'Location check required',
        message: `You can still view the queue. To join or mark an entry done, allow location access and be within ${validation.radiusMeters} m of the venue.`,
      };
    case 'checking':
      return {
        title: 'Checking your location',
        message: 'If your browser asks, choose Allow. Keep this page open while your device gets a precise reading.',
      };
    case 'verified':
      return {
        title: 'Location confirmed',
        message: `You are within ${validation.radiusMeters} m. We will check again when you join or mark an entry done.`,
      };
    case 'permission_denied':
      return {
        title: 'Location access is blocked',
        message: 'In your browser’s site settings, allow Location for this site. Return to this board, then select Check again.',
      };
    case 'too_inaccurate':
      return {
        title: 'Location reading is not precise enough',
        message:
          state.accuracyMeters === undefined
            ? `Turn on Precise Location and move where the GPS signal is clearer. A reading of ${state.maxAccuracyMeters} m or better is required, then you can check again.`
            : `This reading is accurate to about ±${Math.round(state.accuracyMeters)} m. Turn on Precise Location and move where the GPS signal is clearer; ${state.maxAccuracyMeters} m or better is required, then check again.`,
      };
    case 'outside_range':
      return {
        title: 'Move closer to update the queue',
        message:
          state.distanceMeters === undefined
            ? `You appear to be outside the venue’s ${state.radiusMeters} m update range. Move closer, then select Check again.`
            : `You appear about ${formatDistance(state.distanceMeters)} from the venue. Move within ${state.radiusMeters} m, then select Check again.`,
      };
    case 'timed_out':
      return {
        title: 'Location check timed out',
        message: 'The browser did not get a reading within 15 seconds. Make sure device location is on, move where the GPS signal is clearer, then check again.',
      };
    case 'unsupported':
      return {
        title: 'This browser cannot check your location',
        message: 'Open this board in a browser with device-location access. You can still view the queue here.',
      };
    case 'insecure':
      return {
        title: 'A secure connection is required',
        message: 'Location access only works on a secure page. Open the HTTPS version of this board, then check again.',
      };
    case 'unavailable':
      return {
        title: 'Location is temporarily unavailable',
        message: 'Your device could not determine its location. Make sure device location is on, move where the GPS signal is clearer, then check again.',
      };
    case 'disabled':
      return {
        title: 'Location check off',
        message: 'This venue does not require a location check.',
      };
  }
}

function formatDistance(distanceMeters: number): string {
  if (distanceMeters >= 1_000) {
    return `${(distanceMeters / 1_000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}
