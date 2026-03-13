export type TelegramLanguage = 'en' | 'ru';
export type TelegramConfirmationKind = 'trade' | 'login';

type LoginCodeAlertParams = {
  alias: string;
  steamid: string;
  confirmationId: string;
  headline: string;
  summary: string;
  code: string;
  validForSec: number;
};

const copy = {
  en: {
    loginCode2fa: (code: string) => `SteamGuard Web login code: ${code}. This code expires in 10 minutes.`,
    loginRequested: 'Steam login confirmation requested',
    account: 'Account',
    steamId: 'SteamID',
    confirmationId: 'Confirmation ID',
    title: 'Title',
    details: 'Details',
    steamGuardCode: 'Steam Guard code',
    expiresIn: (seconds: number) => `expires in ${seconds}s`,
    nextCodeIn: (seconds: number) => `Next code will be sent in ${seconds}s.`,
    nextSteamCode: (alias: string, code: string) => `Next Steam Guard code for ${alias}: ${code}`,
    newConfirmation: (kind: TelegramConfirmationKind, alias: string, headline: string) =>
      `New ${kind} confirmation for ${alias}: ${headline}`,
    approveLogin: 'Allow',
    rejectLogin: 'Deny',
    approveTrade: 'Confirm',
    rejectTrade: 'Reject'
  },
  ru: {
    loginCode2fa: (code: string) => `Код входа SteamGuard Web: ${code}. Он истекает через 10 минут.`,
    loginRequested: 'Запрошено подтверждение входа Steam',
    account: 'Аккаунт',
    steamId: 'SteamID',
    confirmationId: 'ID подтверждения',
    title: 'Заголовок',
    details: 'Детали',
    steamGuardCode: 'Код Steam Guard',
    expiresIn: (seconds: number) => `истекает через ${seconds}с`,
    nextCodeIn: (seconds: number) => `Следующий код будет отправлен через ${seconds}с.`,
    nextSteamCode: (alias: string, code: string) => `Следующий код Steam Guard для ${alias}: ${code}`,
    newConfirmation: (kind: TelegramConfirmationKind, alias: string, headline: string) =>
      `Новое ${kind === 'trade' ? 'подтверждение трейда' : 'подтверждение входа'} для ${alias}: ${headline}`,
    approveLogin: 'Впустить',
    rejectLogin: 'Не впускать',
    approveTrade: 'Подтвердить',
    rejectTrade: 'Отклонить'
  }
} as const;

export function resolveTelegramLanguage(value: string | null | undefined): TelegramLanguage {
  return value === 'ru' ? 'ru' : 'en';
}

export function telegramLogin2faCode(language: string | null | undefined, code: string): string {
  return copy[resolveTelegramLanguage(language)].loginCode2fa(code);
}

export function telegramLoginCodeAlert(language: string | null | undefined, params: LoginCodeAlertParams): string {
  const lang = copy[resolveTelegramLanguage(language)];
  return [
    lang.loginRequested,
    `${lang.account}: ${params.alias}`,
    `${lang.steamId}: ${params.steamid}`,
    `${lang.confirmationId}: ${params.confirmationId}`,
    params.headline ? `${lang.title}: ${params.headline}` : '',
    params.summary ? `${lang.details}: ${params.summary}` : '',
    `${lang.steamGuardCode}: ${params.code} (${lang.expiresIn(params.validForSec)})`
  ]
    .filter(Boolean)
    .join('\n');
}

export function telegramNextCodeIn(language: string | null | undefined, seconds: number): string {
  return copy[resolveTelegramLanguage(language)].nextCodeIn(seconds);
}

export function telegramNextSteamCode(language: string | null | undefined, alias: string, code: string): string {
  return copy[resolveTelegramLanguage(language)].nextSteamCode(alias, code);
}

export function telegramNewConfirmationText(
  language: string | null | undefined,
  kind: TelegramConfirmationKind,
  alias: string,
  headline: string
): string {
  return copy[resolveTelegramLanguage(language)].newConfirmation(kind, alias, headline);
}

export function telegramConfirmationInlineKeyboard(
  language: string | null | undefined,
  kind: TelegramConfirmationKind,
  cacheId: number
) {
  const lang = copy[resolveTelegramLanguage(language)];
  if (kind === 'trade') {
    return [
      [
        { text: lang.approveTrade, callbackData: `sgl:a:${cacheId}` },
        { text: lang.rejectTrade, callbackData: `sgl:r:${cacheId}` }
      ]
    ];
  }

  return [
    [
      { text: lang.approveLogin, callbackData: `sgl:a:${cacheId}` },
      { text: lang.rejectLogin, callbackData: `sgl:r:${cacheId}` }
    ]
  ];
}
