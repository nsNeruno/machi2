import { z } from 'zod';

const allowedNameCharacters = /^[ -~\p{L}\p{M}\p{Nd}]+$/u;

export const maxNameGraphemes = 8;

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/ +/g, ' ').replace(/^ | $/g, '');
}

export function graphemeLength(value: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value)).length;
}

export function limitNameToGraphemes(value: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value))
    .slice(0, maxNameGraphemes)
    .map(({ segment }) => segment)
    .join('');
}

export const nameSchema = z
  .string()
  .transform(normalizeName)
  .refine((value) => value.length > 0, 'Enter a name')
  .refine((value) => allowedNameCharacters.test(value), 'Only letters, numbers, and common symbols')
  .refine((value) => graphemeLength(value) <= maxNameGraphemes, 'Max 8 characters');
