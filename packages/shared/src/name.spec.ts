import { describe, expect, it } from 'vitest';

import { graphemeLength, limitNameToGraphemes, nameSchema } from './name';

describe('nameSchema', () => {
  it('normalizes whitespace and accepts CJK names', () => {
    expect(nameSchema.parse('  小 明  ')).toBe('小 明');
  });

  it('counts user-perceived characters instead of UTF-16 code units', () => {
    expect(graphemeLength('e\u0301')).toBe(1);
    expect(nameSchema.parse('あいうえおかきく')).toBe('あいうえおかきく');
  });

  it('limits browser input by grapheme rather than code-unit count', () => {
    expect(limitNameToGraphemes('e\u0301abcdefghi')).toBe('e\u0301abcdefg');
  });

  it('rejects emoji, control characters, and names over eight graphemes', () => {
    expect(() => nameSchema.parse('Maki🎮')).toThrow();
    expect(() => nameSchema.parse('Maki\n')).toThrow();
    expect(() => nameSchema.parse('abcdefghi')).toThrow();
  });
});
