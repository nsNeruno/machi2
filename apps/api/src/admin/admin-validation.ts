import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parse a request body with a Zod schema, raising a typed problem response on failure. */
export function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  code = 'invalid_input',
  message = 'The request body is invalid.',
): z.infer<Schema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ code, message, details: parsed.error.flatten() });
  }
  return parsed.data;
}
