import { describe, expect, it, vi } from 'vitest';

import {
  evaluateLocationPosition,
  locationCheckStateFromProblem,
  requestCurrentLocation,
} from './location-validation';

const requiredValidation = {
  required: true as const,
  latitude: 0,
  longitude: 0,
  radiusMeters: 5,
  maxAccuracyMeters: 20,
};

describe('evaluateLocationPosition', () => {
  it('accepts a precise position inside the strict radius', () => {
    expect(
      evaluateLocationPosition(requiredValidation, {
        latitude: 0,
        longitude: 0.000044,
        accuracyMeters: 20,
      }),
    ).toMatchObject({ status: 'verified' });
  });

  it('keeps inaccurate and outside readings recoverable as distinct states', () => {
    expect(
      evaluateLocationPosition(requiredValidation, {
        latitude: 0,
        longitude: 0,
        accuracyMeters: 20.01,
      }),
    ).toMatchObject({ status: 'too_inaccurate', maxAccuracyMeters: 20 });
    expect(
      evaluateLocationPosition(requiredValidation, {
        latitude: 0,
        longitude: 0.001,
        accuracyMeters: 5,
      }),
    ).toMatchObject({ status: 'outside_range', radiusMeters: 5 });
  });

  it('does not gate locations without coordinates', () => {
    expect(
      evaluateLocationPosition(
        { required: false },
        { latitude: 0, longitude: 0, accuracyMeters: 1 },
      ),
    ).toEqual({ status: 'disabled' });
  });
});

describe('requestCurrentLocation', () => {
  it('requests a high-accuracy reading on every call', async () => {
    const getCurrentPosition = vi.fn(
      (
        success: PositionCallback,
        _error?: PositionErrorCallback | null,
        _options?: PositionOptions,
      ) => {
        void _error;
        void _options;
        success(positionFixture());
      },
    );
    const geolocation = { getCurrentPosition } as Pick<Geolocation, 'getCurrentPosition'>;

    await requestCurrentLocation(geolocation);
    await requestCurrentLocation(geolocation);

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 15_000,
    });
  });

  it.each([
    [1, 'permission_denied'],
    [2, 'unavailable'],
    [3, 'timed_out'],
  ])('maps browser error %i to %s', async (code, expectedReason) => {
    const geolocation = {
      getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback | null) => {
        error?.({
          code,
          message: 'fixture',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    } as Pick<Geolocation, 'getCurrentPosition'>;

    await expect(requestCurrentLocation(geolocation)).rejects.toMatchObject({
      reason: expectedReason,
    });
  });

  it('reports an unsupported browser without calling an API', async () => {
    await expect(requestCurrentLocation(undefined)).rejects.toMatchObject({
      reason: 'unsupported',
    });
  });
});

describe('locationCheckStateFromProblem', () => {
  it('restores informative states from authoritative API problem details', () => {
    expect(
      locationCheckStateFromProblem(requiredValidation, {
        code: 'location_too_inaccurate',
        details: { accuracyMeters: 37, maxAccuracyMeters: 20 },
      }),
    ).toEqual({ status: 'too_inaccurate', accuracyMeters: 37, maxAccuracyMeters: 20 });

    expect(
      locationCheckStateFromProblem(requiredValidation, {
        code: 'outside_location_range',
        details: { distanceMeters: 42, radiusMeters: 5 },
      }),
    ).toEqual({ status: 'outside_range', distanceMeters: 42, radiusMeters: 5 });
  });

  it('ignores unrelated problems and locations where validation is disabled', () => {
    expect(
      locationCheckStateFromProblem(requiredValidation, { code: 'queue_full' }),
    ).toBeNull();
    expect(
      locationCheckStateFromProblem(
        { required: false },
        { code: 'location_verification_required' },
      ),
    ).toBeNull();
  });
});

function positionFixture(): GeolocationPosition {
  return {
    coords: {
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      latitude: 0,
      longitude: 0,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}
