import {
  buildDiscordWebhookBody,
  buildWebhookEnvelope,
  isForbiddenWebhookAddress,
  normalizeWebhookEventTypes
} from '../src/services/webhookService';

describe('webhook service helpers', () => {
  it('normalizes and filters webhook event types', () => {
    expect(normalizeWebhookEventTypes(['login', 'trade', 'login', 'unknown'])).toEqual(['login', 'trade']);
  });

  it('rejects private, loopback and link-local addresses for webhooks', () => {
    expect(isForbiddenWebhookAddress('127.0.0.1')).toBe(true);
    expect(isForbiddenWebhookAddress('10.0.0.4')).toBe(true);
    expect(isForbiddenWebhookAddress('172.20.0.2')).toBe(true);
    expect(isForbiddenWebhookAddress('169.254.169.254')).toBe(true);
    expect(isForbiddenWebhookAddress('::1')).toBe(true);
    expect(isForbiddenWebhookAddress('fd00::1')).toBe(true);
    expect(isForbiddenWebhookAddress('8.8.8.8')).toBe(false);
    expect(isForbiddenWebhookAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('builds generic webhook envelope', () => {
    expect(
      buildWebhookEnvelope('steam_session_expired', {
        accountId: 7,
        accountAlias: 'Main',
        message: 'Session expired'
      })
    ).toMatchObject({
      event: 'steam_session_expired',
      payload: {
        accountId: 7,
        accountAlias: 'Main',
        message: 'Session expired'
      }
    });
  });

  it('builds Discord webhook body from notification payload', () => {
    expect(
      buildDiscordWebhookBody('login', {
        accountId: 5,
        accountAlias: 'Alt',
        headline: 'New sign-in request',
        summary: 'Chrome on Linux'
      })
    ).toMatchObject({
      embeds: [
        {
          title: 'Steam login confirmation',
          description: 'New sign-in request',
          fields: expect.arrayContaining([
            { name: 'Account', value: 'Alt', inline: true },
            { name: 'Summary', value: 'Chrome on Linux', inline: false }
          ])
        }
      ]
    });
  });
});
