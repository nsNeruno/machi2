import { z } from 'zod';

export const DEFAULT_LOCATION_VALIDATION_RADIUS_METERS = 5;
export const MAX_LOCATION_ACCURACY_METERS = 20;

export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);
export const locationValidationRadiusSchema = z.number().int().positive();

export const locationPositionSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyMeters: z.number().finite().nonnegative(),
});

export type LocationPosition = z.infer<typeof locationPositionSchema>;

export const locationValidationResponseSchema = z.discriminatedUnion('required', [
  z.object({ required: z.literal(false) }),
  z.object({
    required: z.literal(true),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radiusMeters: locationValidationRadiusSchema,
    maxAccuracyMeters: z.number().positive(),
  }),
]);

export type LocationValidationResponse = z.infer<typeof locationValidationResponseSchema>;

/** Great-circle distance between two WGS84 coordinates. */
export function locationDistanceMeters(
  from: Pick<LocationPosition, 'latitude' | 'longitude'>,
  to: Pick<LocationPosition, 'latitude' | 'longitude'>,
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
