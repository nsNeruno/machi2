import { describe, expect, it } from 'vitest';

import { adminLocationCreateSchema, adminLocationUpdateSchema } from './admin';
import {
  DEFAULT_LOCATION_VALIDATION_RADIUS_METERS,
  locationDistanceMeters,
  locationPositionSchema,
} from './location';

describe('location validation contracts', () => {
  it('defaults the per-location radius to five metres', () => {
    const parsed = adminLocationCreateSchema.parse({
      name: 'Machi Arcade',
      slug: 'machi-arcade',
      timezone: 'Asia/Jakarta',
      latitude: -6.2,
      longitude: 106.8,
    });

    expect(parsed.locationValidationRadiusMeters).toBe(DEFAULT_LOCATION_VALIDATION_RADIUS_METERS);
  });

  it('requires coordinates to be supplied or cleared as a pair', () => {
    const create = adminLocationCreateSchema.safeParse({
      name: 'Machi Arcade',
      slug: 'machi-arcade',
      timezone: 'Asia/Jakarta',
      latitude: -6.2,
    });
    const update = adminLocationUpdateSchema.safeParse({ latitude: null });

    expect(create.success).toBe(false);
    expect(update.success).toBe(false);
    expect(adminLocationUpdateSchema.safeParse({ latitude: null, longitude: null }).success).toBe(
      true,
    );
  });

  it('rejects invalid coordinate, radius, and accuracy values', () => {
    expect(
      adminLocationCreateSchema.safeParse({
        name: 'Machi Arcade',
        slug: 'machi-arcade',
        timezone: 'Asia/Jakarta',
        latitude: -91,
        longitude: 106.8,
      }).success,
    ).toBe(false);
    expect(adminLocationUpdateSchema.safeParse({ locationValidationRadiusMeters: 0 }).success).toBe(
      false,
    );
    expect(
      locationPositionSchema.safeParse({
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: -1,
      }).success,
    ).toBe(false);
  });
});

describe('locationDistanceMeters', () => {
  it('returns zero for the same point', () => {
    expect(
      locationDistanceMeters(
        { latitude: -6.2, longitude: 106.8 },
        { latitude: -6.2, longitude: 106.8 },
      ),
    ).toBe(0);
  });

  it('calculates a stable short-distance boundary', () => {
    const distance = locationDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.000044966 },
    );

    expect(distance).toBeGreaterThan(4.9);
    expect(distance).toBeLessThan(5.1);
  });
});
