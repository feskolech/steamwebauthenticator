import axios from 'axios';
import { execute, queryRows } from '../db/pool';

export const ALLOWED_WEBHOOK_EVENTS = ['trade', 'login', 'steam_session_expired'] as const;

export type WebhookEventType = (typeof ALLOWED_WEBHOOK_EVENTS)[number];
export type WebhookTargetType = 'generic' | 'discord';

type UserWebhookRow = {
  id: number;
  name: string;
  target_type: WebhookTargetType;
  url: string;
  event_types: string;
  enabled: number;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserWebhook = {
  id: number;
  name: string;
  targetType: WebhookTargetType;
  url: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function titleForEvent(eventType: WebhookEventType | 'test'): string {
  switch (eventType) {
    case 'trade':
      return 'Steam trade confirmation';
    case 'login':
      return 'Steam login confirmation';
    case 'steam_session_expired':
      return 'Steam session expired';
    case 'test':
      return 'SteamGuard webhook test';
  }
}

function toWebhook(row: UserWebhookRow): UserWebhook {
  return {
    id: row.id,
    name: row.name,
    targetType: row.target_type,
    url: row.url,
    eventTypes: normalizeWebhookEventTypes(safeParseEventTypes(row.event_types)),
    enabled: Boolean(row.enabled),
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeParseEventTypes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function normalizeWebhookEventTypes(values: string[] | undefined): WebhookEventType[] {
  const unique = Array.from(new Set((values ?? []).map((value) => String(value))));
  return unique.filter((value): value is WebhookEventType =>
    (ALLOWED_WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

export function buildWebhookEnvelope(event: WebhookEventType | 'test', payload: Record<string, unknown>) {
  return {
    event,
    occurredAt: new Date().toISOString(),
    payload
  };
}

export function buildDiscordWebhookBody(event: WebhookEventType | 'test', payload: Record<string, unknown>) {
  const fields = [
    typeof payload.accountAlias === 'string'
      ? { name: 'Account', value: payload.accountAlias, inline: true }
      : null,
    typeof payload.accountId === 'number'
      ? { name: 'Account ID', value: String(payload.accountId), inline: true }
      : null,
    typeof payload.summary === 'string' && payload.summary.trim()
      ? { name: 'Summary', value: payload.summary, inline: false }
      : null,
    typeof payload.message === 'string' && payload.message.trim()
      ? { name: 'Message', value: payload.message, inline: false }
      : null
  ].filter(Boolean);

  return {
    embeds: [
      {
        title: titleForEvent(event),
        description:
          (typeof payload.headline === 'string' && payload.headline.trim())
          || (typeof payload.message === 'string' && payload.message.trim())
          || titleForEvent(event),
        fields,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function validateWebhookUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Webhook URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Webhook URL is invalid');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Webhook URL must start with http:// or https://');
  }

  return parsed.toString();
}

function validateTargetType(value: string): WebhookTargetType {
  if (value === 'generic' || value === 'discord') {
    return value;
  }
  throw new Error('Webhook target type is invalid');
}

async function getWebhookByOwner(userId: number, webhookId: number): Promise<UserWebhook> {
  const rows = await queryRows<UserWebhookRow[]>(
    `SELECT id, name, target_type, url, event_types, enabled, last_success_at, last_failure_at, last_error, created_at, updated_at
     FROM user_webhooks
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [webhookId, userId]
  );

  const webhook = rows[0];
  if (!webhook) {
    throw new Error('Webhook not found');
  }

  return toWebhook(webhook);
}

export async function listUserWebhooks(userId: number): Promise<UserWebhook[]> {
  const rows = await queryRows<UserWebhookRow[]>(
    `SELECT id, name, target_type, url, event_types, enabled, last_success_at, last_failure_at, last_error, created_at, updated_at
     FROM user_webhooks
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );

  return rows.map(toWebhook);
}

export async function createUserWebhook(
  userId: number,
  input: { name?: string; targetType?: string; url?: string; eventTypes?: string[] }
): Promise<UserWebhook> {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new Error('Webhook name is required');
  }

  const targetType = validateTargetType(String(input.targetType ?? ''));
  const url = validateWebhookUrl(String(input.url ?? ''));
  const eventTypes = normalizeWebhookEventTypes(input.eventTypes);
  if (eventTypes.length === 0) {
    throw new Error('Select at least one webhook event');
  }

  const result = await execute(
    `INSERT INTO user_webhooks (user_id, name, target_type, url, event_types, enabled)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), TRUE)`,
    [userId, name, targetType, url, JSON.stringify(eventTypes)]
  );

  return getWebhookByOwner(userId, Number(result.insertId));
}

export async function deleteUserWebhook(userId: number, webhookId: number): Promise<void> {
  const result = await execute('DELETE FROM user_webhooks WHERE id = ? AND user_id = ?', [webhookId, userId]);
  if (result.affectedRows === 0) {
    throw new Error('Webhook not found');
  }
}

async function recordWebhookDelivery(
  webhookId: number,
  eventType: string,
  requestBody: Record<string, unknown>,
  statusCode: number | null,
  responseBody: string | null,
  errorMessage: string | null
): Promise<void> {
  await execute(
    `INSERT INTO webhook_deliveries (webhook_id, event_type, request_body, response_status, response_body, error_message)
     VALUES (?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [webhookId, eventType, JSON.stringify(requestBody), statusCode, responseBody, errorMessage]
  );
}

async function markWebhookSuccess(webhookId: number): Promise<void> {
  await execute(
    `UPDATE user_webhooks
     SET last_success_at = UTC_TIMESTAMP(), last_failure_at = NULL, last_error = NULL
     WHERE id = ?`,
    [webhookId]
  );
}

async function markWebhookFailure(webhookId: number, errorMessage: string): Promise<void> {
  await execute(
    `UPDATE user_webhooks
     SET last_failure_at = UTC_TIMESTAMP(), last_error = ?
     WHERE id = ?`,
    [errorMessage.slice(0, 500), webhookId]
  );
}

async function deliverWebhook(hook: UserWebhook, eventType: WebhookEventType | 'test', payload: Record<string, unknown>) {
  const requestBody = hook.targetType === 'discord'
    ? buildDiscordWebhookBody(eventType, payload)
    : buildWebhookEnvelope(eventType, payload);

  try {
    const response = await axios.post(hook.url, requestBody, {
      timeout: 10000,
      headers: {
        'content-type': 'application/json'
      }
    });

    await recordWebhookDelivery(
      hook.id,
      eventType,
      requestBody,
      response.status,
      typeof response.data === 'string' ? response.data.slice(0, 1000) : JSON.stringify(response.data).slice(0, 1000),
      null
    );
    await markWebhookSuccess(hook.id);
  } catch (error: any) {
    const statusCode = typeof error?.response?.status === 'number' ? error.response.status : null;
    const responseBody = error?.response?.data
      ? (typeof error.response.data === 'string'
        ? error.response.data.slice(0, 1000)
        : JSON.stringify(error.response.data).slice(0, 1000))
      : null;
    const message = error?.message || 'Webhook delivery failed';

    await recordWebhookDelivery(hook.id, eventType, requestBody, statusCode, responseBody, message);
    await markWebhookFailure(hook.id, message);
  }
}

export async function testUserWebhook(userId: number, webhookId: number): Promise<void> {
  const hook = await getWebhookByOwner(userId, webhookId);
  await deliverWebhook(hook, 'test', {
    message: 'SteamGuard webhook test notification',
    accountAlias: 'System'
  });
}

export async function dispatchWebhookEvent(
  userId: number,
  eventType: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  const hooks = await listUserWebhooks(userId);
  const matchingHooks = hooks.filter((hook) => hook.enabled && hook.eventTypes.includes(eventType));
  if (matchingHooks.length === 0) {
    return;
  }

  await Promise.all(matchingHooks.map((hook) => deliverWebhook(hook, eventType, payload)));
}

export async function createUserNotification(
  userId: number,
  type: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  await execute(
    `INSERT INTO notifications (user_id, channel, type, payload)
     VALUES (?, 'web', ?, CAST(? AS JSON))`,
    [userId, type, JSON.stringify(payload)]
  );

  try {
    await dispatchWebhookEvent(userId, type, payload);
  } catch {
    // Notification delivery inside the app must not fail because of webhook issues.
  }
}
