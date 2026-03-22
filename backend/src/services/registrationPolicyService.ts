export type RegistrationMode = 'open' | 'disabled' | 'domain_allowlist' | 'invite_only';

export type RegistrationPolicy = {
  registrationEnabled: boolean;
  registrationMode: RegistrationMode;
  allowedEmailDomains: string[];
};

export function parseRegistrationMode(value: string | null | undefined): RegistrationMode {
  if (value === 'disabled' || value === 'domain_allowlist' || value === 'invite_only' || value === 'open') {
    return value;
  }
  return 'open';
}

export function normalizeDomainList(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function validateRegistrationAccess(
  policy: RegistrationPolicy,
  email: string,
  options: { hasInvite?: boolean } = {}
): void {
  if (!policy.registrationEnabled || policy.registrationMode === 'disabled') {
    throw new Error('Registration is disabled by administrator');
  }

  if (policy.registrationMode === 'invite_only' && !options.hasInvite) {
    throw new Error('Registration requires a valid invite code');
  }

  if (policy.registrationMode === 'domain_allowlist') {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    if (!domain || !policy.allowedEmailDomains.includes(domain)) {
      throw new Error('Registration is limited to approved email domains');
    }
  }
}
