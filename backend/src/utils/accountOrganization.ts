const MAX_ORGANIZATION_NAME_LENGTH = 48;

export function normalizeOrganizationName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error('Name is required');
  }

  if (normalized.length > MAX_ORGANIZATION_NAME_LENGTH) {
    throw new Error(`Name must be at most ${MAX_ORGANIZATION_NAME_LENGTH} characters`);
  }

  return normalized;
}

export function normalizeOrganizationTagIds(tagIds: number[]): number[] {
  const normalized = Array.from(new Set(tagIds));

  if (normalized.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Tag ids must be positive integers');
  }

  return normalized.sort((left, right) => left - right);
}
