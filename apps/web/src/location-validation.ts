import { useCallback, useEffect, useRef, useState } from 'react';
import {
  locationDistanceMeters,
  type LocationPosition,
  type LocationValidationResponse,
} from '@machi2/shared';

export type LocationCheckState =
  | { status: 'disabled' }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'verified'; distanceMeters: number; position: LocationPosition }
  | { status: 'permission_denied' }
  | { status: 'unavailable' }
  | { status: 'timed_out' }
  | { status: 'unsupported' }
  | { status: 'insecure' }
  | { status: 'too_inaccurate'; accuracyMeters?: number; maxAccuracyMeters: number }
  | { status: 'outside_range'; distanceMeters?: number; radiusMeters: number };

export type LocationCheckResult =
  { allowed: true; position?: LocationPosition } | { allowed: false };

export type LocationProblem = {
  code: string | null;
  details?: unknown;
};

type GeolocationSource = Pick<Geolocation, 'getCurrentPosition'>;

const geolocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 30_000,
  timeout: 15_000,
};

export function evaluateLocationPosition(
  validation: LocationValidationResponse,
  position: LocationPosition,
): LocationCheckState {
  if (!validation.required) {
    return { status: 'disabled' };
  }
  if (position.accuracyMeters > validation.maxAccuracyMeters) {
    return {
      status: 'too_inaccurate',
      accuracyMeters: position.accuracyMeters,
      maxAccuracyMeters: validation.maxAccuracyMeters,
    };
  }

  const distanceMeters = locationDistanceMeters(position, validation);
  if (distanceMeters > validation.radiusMeters) {
    return {
      status: 'outside_range',
      distanceMeters,
      radiusMeters: validation.radiusMeters,
    };
  }
  return { status: 'verified', distanceMeters, position };
}

export function requestCurrentLocation(
  geolocation: GeolocationSource | undefined,
): Promise<LocationPosition> {
  if (!geolocation) {
    return Promise.reject(new LocationRequestError('unsupported'));
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new LocationRequestError('permission_denied'));
        } else if (error.code === error.TIMEOUT) {
          reject(new LocationRequestError('timed_out'));
        } else {
          reject(new LocationRequestError('unavailable'));
        }
      },
      geolocationOptions,
    );
  });
}

export function locationCheckStateFromProblem(
  validation: LocationValidationResponse,
  problem: LocationProblem,
): LocationCheckState | null {
  if (!validation.required) {
    return null;
  }

  const details = problemDetails(problem.details);
  switch (problem.code) {
    case 'location_verification_required':
      return { status: 'idle' };
    case 'location_too_inaccurate':
      return {
        status: 'too_inaccurate',
        accuracyMeters: detailNumber(details, 'accuracyMeters'),
        maxAccuracyMeters:
          detailNumber(details, 'maxAccuracyMeters') ?? validation.maxAccuracyMeters,
      };
    case 'outside_location_range':
      return {
        status: 'outside_range',
        distanceMeters: detailNumber(details, 'distanceMeters'),
        radiusMeters: detailNumber(details, 'radiusMeters') ?? validation.radiusMeters,
      };
    default:
      return null;
  }
}

export function useLocationValidation(validation: LocationValidationResponse): {
  check: () => Promise<LocationCheckResult>;
  reportProblem: (problem: LocationProblem) => boolean;
  state: LocationCheckState;
} {
  const [state, setState] = useState<LocationCheckState>(() =>
    validation.required ? { status: 'idle' } : { status: 'disabled' },
  );
  const requestSequence = useRef(0);
  const required = validation.required;
  const latitude = required ? validation.latitude : null;
  const longitude = required ? validation.longitude : null;
  const radiusMeters = required ? validation.radiusMeters : null;
  const maxAccuracyMeters = required ? validation.maxAccuracyMeters : null;

  const check = useCallback(async (): Promise<LocationCheckResult> => {
    const sequence = ++requestSequence.current;
    if (
      !required ||
      latitude === null ||
      longitude === null ||
      radiusMeters === null ||
      maxAccuracyMeters === null
    ) {
      setState({ status: 'disabled' });
      return { allowed: true };
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState({ status: 'insecure' });
      return { allowed: false };
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unsupported' });
      return { allowed: false };
    }

    setState({ status: 'checking' });
    try {
      const position = await requestCurrentLocation(navigator.geolocation);
      const nextState = evaluateLocationPosition(
        {
          required: true,
          latitude,
          longitude,
          radiusMeters,
          maxAccuracyMeters,
        },
        position,
      );
      if (sequence === requestSequence.current) {
        setState(nextState);
      }
      return nextState.status === 'verified'
        ? { allowed: true, position: nextState.position }
        : { allowed: false };
    } catch (error) {
      const status =
        error instanceof LocationRequestError ? error.reason : ('unavailable' as const);
      if (sequence === requestSequence.current) {
        setState({ status });
      }
      return { allowed: false };
    }
  }, [latitude, longitude, maxAccuracyMeters, radiusMeters, required]);

  const reportProblem = useCallback(
    (problem: LocationProblem): boolean => {
      const nextState = locationCheckStateFromProblem(validation, problem);
      if (!nextState) {
        return false;
      }
      requestSequence.current += 1;
      setState(nextState);
      return true;
    },
    [validation],
  );

  useEffect(() => {
    if (!required) {
      requestSequence.current += 1;
      setState({ status: 'disabled' });
      return;
    }
    void check();
  }, [check, latitude, longitude, maxAccuracyMeters, radiusMeters, required]);

  useEffect(() => {
    if (!required || typeof navigator === 'undefined' || !navigator.permissions) {
      return;
    }

    let permissionStatus: PermissionStatus | null = null;
    let cancelled = false;
    const handlePermissionChange = () => {
      if (permissionStatus?.state === 'granted') {
        void check();
      } else if (permissionStatus?.state === 'denied') {
        requestSequence.current += 1;
        setState({ status: 'permission_denied' });
      } else {
        requestSequence.current += 1;
        setState({ status: 'idle' });
      }
    };

    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) {
          return;
        }
        permissionStatus = status;
        status.addEventListener('change', handlePermissionChange);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      permissionStatus?.removeEventListener('change', handlePermissionChange);
    };
  }, [check, required]);

  useEffect(() => {
    if (!required || typeof window === 'undefined') {
      return;
    }
    const handleFocus = () => void check();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [check, required]);

  return { check, reportProblem, state };
}

class LocationRequestError extends Error {
  constructor(readonly reason: 'permission_denied' | 'timed_out' | 'unavailable' | 'unsupported') {
    super(reason);
  }
}

function problemDetails(details: unknown): Record<string, unknown> | null {
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null;
}

function detailNumber(details: Record<string, unknown> | null, key: string): number | undefined {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
