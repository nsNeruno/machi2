import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { errorMessage, isLocationValidationError } from './ui-shared';

describe('location validation API errors', () => {
  it('keeps authoritative accuracy limits in player-facing copy', () => {
    const error = new ApiError(
      'Location is inaccurate.',
      'location_too_inaccurate',
      403,
      { accuracyMeters: 37, maxAccuracyMeters: 20 },
    );

    expect(isLocationValidationError(error)).toBe(true);
    expect(errorMessage(error)).toMatch(/±37 m.*20 m or better.*check again/i);
  });

  it('keeps authoritative distance and radius in player-facing copy', () => {
    const error = new ApiError('Outside range.', 'outside_location_range', 403, {
      distanceMeters: 1_250,
      radiusMeters: 5,
    });

    expect(errorMessage(error)).toMatch(/1\.3 km.*within 5 m.*check again/i);
  });

  it('falls back to actionable copy when problem details are unavailable', () => {
    expect(
      errorMessage(new ApiError('Missing position.', 'location_verification_required', 403)),
    ).toContain('Check your location before updating this queue, then try again.');
  });
});
