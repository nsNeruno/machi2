import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  locationDistanceMeters,
  MAX_LOCATION_ACCURACY_METERS,
  type LocationPosition,
} from '@machi2/shared';

import type { locations } from '../db/schema';

type LocationValidationConfig = Pick<
  typeof locations.$inferSelect,
  'latitude' | 'longitude' | 'locationValidationRadiusMeters'
>;

@Injectable()
export class LocationValidationService {
  assertPublicWriteAllowed(
    location: LocationValidationConfig,
    position: LocationPosition | undefined,
  ): void {
    if (location.latitude === null || location.longitude === null) {
      return;
    }
    if (!position) {
      throw new ForbiddenException({
        code: 'location_verification_required',
        message: 'Verify your location before updating this queue.',
        details: {
          radiusMeters: location.locationValidationRadiusMeters,
          maxAccuracyMeters: MAX_LOCATION_ACCURACY_METERS,
        },
      });
    }
    if (position.accuracyMeters > MAX_LOCATION_ACCURACY_METERS) {
      throw new ForbiddenException({
        code: 'location_too_inaccurate',
        message: 'Your location reading is not accurate enough to update this queue.',
        details: {
          accuracyMeters: Math.round(position.accuracyMeters),
          maxAccuracyMeters: MAX_LOCATION_ACCURACY_METERS,
        },
      });
    }

    const distanceMeters = locationDistanceMeters(position, {
      latitude: location.latitude,
      longitude: location.longitude,
    });
    if (distanceMeters > location.locationValidationRadiusMeters) {
      throw new ForbiddenException({
        code: 'outside_location_range',
        message: 'You are outside this location’s queue update range.',
        details: {
          distanceMeters: Math.round(distanceMeters),
          radiusMeters: location.locationValidationRadiusMeters,
        },
      });
    }
  }
}
