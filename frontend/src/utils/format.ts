export function shortenSteamId(value: string | null): string {
  if (!value) {
    return '-';
  }

  if (value.length <= 10) {
    return value;
  }

  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}
