import { describe, expect, it } from 'vitest';

import { appName } from './app-info';

describe('app name', () => {
  it('uses the product name in the shell', () => {
    expect(appName).toBe('Machi2');
  });
});
