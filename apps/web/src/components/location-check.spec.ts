import { describe, expect, it } from 'vitest';

import type { LocationCheckState } from '../location-validation';
import { getLocationCheckCopy } from './location-check';

const validation = {
  required: true as const,
  latitude: -6.37,
  longitude: 106.83,
  radiusMeters: 5,
  maxAccuracyMeters: 20,
};

describe('getLocationCheckCopy', () => {
  it('explains that reads stay available and writes need a fresh check', () => {
    expect(copy({ status: 'idle' }).message).toContain('still view the queue');
    expect(copy({ status: 'verified', distanceMeters: 2, position: samplePosition() }).message).toContain(
      'check again when you join or mark an entry done',
    );
  });

  it('gives permission and browser recovery instructions', () => {
    expect(copy({ status: 'permission_denied' }).message).toMatch(
      /site settings.*allow Location.*Check again/i,
    );
    expect(copy({ status: 'insecure' }).message).toMatch(/secure page.*HTTPS.*check again/i);
    expect(copy({ status: 'unsupported' }).message).toContain(
      'browser with device-location access',
    );
  });

  it('reports accuracy and range limits with a clear next action', () => {
    expect(
      copy({ status: 'too_inaccurate', accuracyMeters: 37, maxAccuracyMeters: 20 }).message,
    ).toMatch(/±37 m.*20 m or better.*check again/i);
    expect(copy({ status: 'outside_range', distanceMeters: 42, radiusMeters: 5 }).message).toMatch(
      /42 m.*within 5 m.*Check again/i,
    );
  });

  it('distinguishes timeout and temporary unavailability', () => {
    expect(copy({ status: 'timed_out' }).message).toContain('within 15 seconds');
    expect(copy({ status: 'unavailable' }).message).toContain(
      'device could not determine its location',
    );
  });
});

function copy(state: LocationCheckState): { title: string; message: string } {
  return getLocationCheckCopy(state, validation);
}

function samplePosition() {
  return { latitude: -6.37, longitude: 106.83, accuracyMeters: 5 };
}
