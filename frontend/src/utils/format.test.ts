import { describe, expect, it } from 'vitest';
import { shortenSteamId } from './format';

describe('shortenSteamId', () => {
  it('returns dash for null', () => {
    expect(shortenSteamId(null)).toBe('-');
  });

  it('shortens long values', () => {
    expect(shortenSteamId('76561198000000000')).toBe('76561...0000');
  });
});
