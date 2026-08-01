import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { LocationValidationService } from './location-validation.service';

describe('LocationValidationService', () => {
  const service = new LocationValidationService();
  const enabledLocation = {
    latitude: 0,
    longitude: 0,
    locationValidationRadiusMeters: 5,
  };

  it('does not require a position when coordinates are absent', () => {
    expect(() =>
      service.assertPublicWriteAllowed(
        { latitude: null, longitude: null, locationValidationRadiusMeters: 5 },
        undefined,
      ),
    ).not.toThrow();
  });

  it('requires a position for a coordinate-enabled location', () => {
    expectProblemCode(
      () => service.assertPublicWriteAllowed(enabledLocation, undefined),
      'location_verification_required',
    );
  });

  it('enforces the twenty-metre accuracy limit before distance', () => {
    expectProblemCode(
      () =>
        service.assertPublicWriteAllowed(enabledLocation, {
          latitude: 0,
          longitude: 0,
          accuracyMeters: 20.01,
        }),
      'location_too_inaccurate',
    );
  });

  it('accepts the configured boundary and rejects positions beyond it', () => {
    expect(() =>
      service.assertPublicWriteAllowed(enabledLocation, {
        latitude: 0,
        longitude: 0.000044966,
        accuracyMeters: 20,
      }),
    ).not.toThrow();
    expectProblemCode(
      () =>
        service.assertPublicWriteAllowed(enabledLocation, {
          latitude: 0,
          longitude: 0.00005,
          accuracyMeters: 5,
        }),
      'outside_location_range',
    );
  });
});

function expectProblemCode(action: () => void, code: string): void {
  try {
    action();
    throw new Error('Expected location validation to throw.');
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code });
  }
}
