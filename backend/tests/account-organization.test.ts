import {
  normalizeOrganizationName,
  normalizeOrganizationTagIds
} from '../src/utils/accountOrganization';

describe('account organization helpers', () => {
  it('normalizes folder or tag names', () => {
    expect(normalizeOrganizationName('  Main    Folder  ')).toBe('Main Folder');
  });

  it('rejects empty folder or tag names', () => {
    expect(() => normalizeOrganizationName('   ')).toThrow('Name is required');
  });

  it('deduplicates and sorts valid tag ids', () => {
    expect(normalizeOrganizationTagIds([4, 2, 4, 3])).toEqual([2, 3, 4]);
  });

  it('rejects invalid tag ids', () => {
    expect(() => normalizeOrganizationTagIds([1, 0, -2])).toThrow('Tag ids must be positive integers');
  });
});
