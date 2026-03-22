import {
  normalizeDomainList,
  parseRegistrationMode,
  validateRegistrationAccess
} from '../src/services/registrationPolicyService';

describe('registration policy service', () => {
  it('normalizes domain allowlist values', () => {
    expect(normalizeDomainList(' Example.com, test.local  ,EXAMPLE.com ')).toEqual([
      'example.com',
      'test.local'
    ]);
  });

  it('parses registration mode with fallback', () => {
    expect(parseRegistrationMode('domain_allowlist')).toBe('domain_allowlist');
    expect(parseRegistrationMode('invite_only')).toBe('invite_only');
    expect(parseRegistrationMode('weird')).toBe('open');
  });

  it('blocks non-allowlisted emails when allowlist mode is enabled', () => {
    expect(() =>
      validateRegistrationAccess(
        {
          registrationEnabled: true,
          registrationMode: 'domain_allowlist',
          allowedEmailDomains: ['example.com']
        },
        'user@other.com'
      )
    ).toThrow('Registration is limited to approved email domains');
  });

  it('allows allowlisted domains when allowlist mode is enabled', () => {
    expect(() =>
      validateRegistrationAccess(
        {
          registrationEnabled: true,
          registrationMode: 'domain_allowlist',
          allowedEmailDomains: ['example.com']
        },
        'user@example.com'
      )
    ).not.toThrow();
  });

  it('blocks all registration when mode is disabled', () => {
    expect(() =>
      validateRegistrationAccess(
        {
          registrationEnabled: true,
          registrationMode: 'disabled',
          allowedEmailDomains: []
        },
        'user@example.com'
      )
    ).toThrow('Registration is disabled by administrator');
  });

  it('requires invite code in invite-only mode', () => {
    expect(() =>
      validateRegistrationAccess(
        {
          registrationEnabled: true,
          registrationMode: 'invite_only',
          allowedEmailDomains: []
        },
        'user@example.com'
      )
    ).toThrow('Registration requires a valid invite code');
  });

  it('allows registration in invite-only mode with invite', () => {
    expect(() =>
      validateRegistrationAccess(
        {
          registrationEnabled: true,
          registrationMode: 'invite_only',
          allowedEmailDomains: []
        },
        'user@example.com',
        { hasInvite: true }
      )
    ).not.toThrow();
  });
});
