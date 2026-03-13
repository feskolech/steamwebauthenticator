import asyncio
import logging
import os
from typing import Any

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
BACKEND_URL = os.getenv('BACKEND_INTERNAL_URL', 'http://backend:3001')

BOT_ENABLED = bool(BOT_TOKEN) and not BOT_TOKEN.startswith('change_me')
bot = Bot(BOT_TOKEN) if BOT_ENABLED else None
dp = Dispatcher()


TEXT = {
    'en': {
        'login_approved': 'Login approved. Return to SteamGuard Web and wait for auto-login.',
        'login_failed': 'Login failed: {error}',
        'bot_ready': (
            'SteamGuard Bot ready.\n'
            'Commands:\n'
            '/add=<code> - link Telegram to web account\n'
            '/accounts - list Steam accounts\n'
            '/codes - get auth codes\n'
            '/confirm <trade_id> - confirm pending trade\n'
            '/status - bot/backend status'
        ),
        'bot_active': 'SteamGuard Bot is active. Use /accounts, /codes or /add=<code> from web settings.',
        'backend_ok': 'Backend connection: OK',
        'backend_error': 'Backend connection error: {error}',
        'no_accounts': 'No Steam accounts linked.',
        'your_accounts': 'Your Steam accounts:',
        'no_codes': 'No linked accounts or codes unavailable.',
        'current_codes': 'Current Steam codes:',
        'confirm_usage': 'Usage: /confirm <trade_id> OR /confirm <account_id>:<trade_id>',
        'no_pending': 'No pending confirmations.',
        'confirm_not_found': 'Trade confirmation id not found in pending queue.',
        'confirm_sent': 'Trade confirmation sent to Steam successfully.',
        'confirm_failed': 'Confirm failed: {error}',
        'invalid_payload': 'Invalid action payload',
        'done': 'Done',
        'inline_result': 'Telegram inline action: {kind} {decision} (account {account_id}, confirmation {confirmation_id}).',
        'approved': 'approved',
        'rejected': 'rejected',
        'action_failed': 'Action failed: {error}',
        'linked': 'Telegram account linked successfully.',
        'link_failed': 'Link failed: {error}',
        'unknown_command': 'Unknown command. Use /accounts, /codes, /confirm or /add=<code>.',
    },
    'ru': {
        'login_approved': 'Вход подтверждён. Вернитесь в SteamGuard Web и дождитесь автологина.',
        'login_failed': 'Ошибка входа: {error}',
        'bot_ready': (
            'Бот SteamGuard готов.\n'
            'Команды:\n'
            '/add=<code> - привязать Telegram к веб-аккаунту\n'
            '/accounts - список Steam-аккаунтов\n'
            '/codes - получить коды\n'
            '/confirm <trade_id> - подтвердить ожидающий трейд\n'
            '/status - статус бота/бэкенда'
        ),
        'bot_active': 'Бот SteamGuard активен. Используйте /accounts, /codes или /add=<code> из настроек веба.',
        'backend_ok': 'Соединение с backend: OK',
        'backend_error': 'Ошибка соединения с backend: {error}',
        'no_accounts': 'Steam-аккаунты не привязаны.',
        'your_accounts': 'Ваши Steam-аккаунты:',
        'no_codes': 'Нет привязанных аккаунтов или коды недоступны.',
        'current_codes': 'Текущие Steam-коды:',
        'confirm_usage': 'Использование: /confirm <trade_id> ИЛИ /confirm <account_id>:<trade_id>',
        'no_pending': 'Нет ожидающих подтверждений.',
        'confirm_not_found': 'ID подтверждения трейда не найден в очереди.',
        'confirm_sent': 'Подтверждение трейда отправлено в Steam.',
        'confirm_failed': 'Ошибка подтверждения: {error}',
        'invalid_payload': 'Некорректное действие',
        'done': 'Готово',
        'inline_result': 'Действие в Telegram: {kind} {decision} (аккаунт {account_id}, подтверждение {confirmation_id}).',
        'approved': 'подтверждено',
        'rejected': 'отклонено',
        'action_failed': 'Ошибка действия: {error}',
        'linked': 'Telegram успешно привязан.',
        'link_failed': 'Ошибка привязки: {error}',
        'unknown_command': 'Неизвестная команда. Используйте /accounts, /codes, /confirm или /add=<code>.',
    },
}


def normalize_lang(value: str | None) -> str:
    return 'ru' if value == 'ru' else 'en'


def tr(lang: str | None, key: str, **kwargs: Any) -> str:
    template = TEXT[normalize_lang(lang)][key]
    return template.format(**kwargs) if kwargs else template


async def get_user_language(telegram_user_id: int | str) -> str:
    try:
        data = await call_backend('GET', f'/api/telegram/bot/profile/{telegram_user_id}')
        return normalize_lang(data.get('language'))
    except Exception:  # noqa: BLE001
        return 'en'


async def call_backend(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{BACKEND_URL.rstrip('/')}{path}"
    headers = {'x-telegram-bot-token': BOT_TOKEN}

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        async with session.request(method, url, json=payload, headers=headers) as response:
            data = await response.json(content_type=None)
            if response.status >= 400:
                message = data.get('message') if isinstance(data, dict) else str(data)
                raise RuntimeError(message)
            return data


@dp.message(CommandStart(deep_link=True))
async def start_with_param(message: Message) -> None:
    text = message.text or ''
    parts = text.split(maxsplit=1)
    arg = parts[1] if len(parts) > 1 else ''

    if arg.startswith('login_'):
        code = arg.replace('login_', '', 1)
        try:
            response = await call_backend(
                'POST',
                '/api/telegram/bot/oauth',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer(tr(response.get('language'), 'login_approved'))
        except Exception as err:  # noqa: BLE001
            await message.answer(tr('en', 'login_failed', error=err))
        return

    await message.answer(tr(await get_user_language(message.from_user.id), 'bot_ready'))


@dp.message(CommandStart())
async def start_plain(message: Message) -> None:
    await message.answer(tr(await get_user_language(message.from_user.id), 'bot_active'))


@dp.message(Command('status'))
async def status(message: Message) -> None:
    lang = await get_user_language(message.from_user.id)
    try:
        await call_backend('GET', f'/api/telegram/bot/accounts/{message.from_user.id}')
        await message.answer(tr(lang, 'backend_ok'))
    except Exception as err:  # noqa: BLE001
        await message.answer(tr(lang, 'backend_error', error=err))


@dp.message(Command('accounts'))
async def accounts(message: Message) -> None:
    lang = await get_user_language(message.from_user.id)
    try:
        data = await call_backend('GET', f'/api/telegram/bot/accounts/{message.from_user.id}')
        items = data.get('items', [])
        if not items:
            await message.answer(tr(lang, 'no_accounts'))
            return

        lines = [tr(lang, 'your_accounts')]
        for item in items:
            lines.append(f"- [{item['id']}] {item['alias']} ({item.get('steamid') or 'no steamid'})")

        await message.answer('\n'.join(lines))
    except Exception as err:  # noqa: BLE001
        await message.answer(tr(lang, 'backend_error', error=err))


@dp.message(Command('codes'))
async def codes(message: Message) -> None:
    lang = await get_user_language(message.from_user.id)
    try:
        data = await call_backend('GET', f'/api/telegram/bot/codes/{message.from_user.id}')
        items = data.get('items', [])
        if not items:
            await message.answer(tr(lang, 'no_codes'))
            return

        lines = [tr(lang, 'current_codes')]
        for item in items:
            lines.append(f"- {item['alias']}: `{item['code']}`")

        await message.answer('\n'.join(lines), parse_mode='Markdown')
    except Exception as err:  # noqa: BLE001
        await message.answer(tr(lang, 'backend_error', error=err))


@dp.message(Command('confirm'))
async def confirm(message: Message) -> None:
    lang = await get_user_language(message.from_user.id)
    text = message.text or ''
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer(tr(lang, 'confirm_usage'))
        return

    identifier = parts[1].strip()

    try:
        pending = await call_backend('GET', f'/api/telegram/bot/confirms/{message.from_user.id}')
        items = pending.get('items', [])
        if not items:
            await message.answer(tr(lang, 'no_pending'))
            return

        chosen = None

        if ':' in identifier:
            left, right = identifier.split(':', 1)
            for item in items:
                if str(item['account_id']) == left and str(item['confirmation_id']) == right:
                    chosen = item
                    break
        else:
            for item in items:
                if str(item['confirmation_id']) == identifier:
                    chosen = item
                    break

        if not chosen:
            await message.answer(tr(lang, 'confirm_not_found'))
            return

        await call_backend(
            'POST',
            '/api/telegram/bot/confirm',
            {
                'telegramUserId': str(message.from_user.id),
                'accountId': int(chosen['account_id']),
                'confirmationId': str(chosen['confirmation_id']),
                'nonce': chosen.get('nonce'),
            },
        )

        await message.answer(tr(lang, 'confirm_sent'))
    except Exception as err:  # noqa: BLE001
        await message.answer(tr(lang, 'confirm_failed', error=err))


@dp.callback_query()
async def inline_login_decision(callback: CallbackQuery) -> None:
    lang = await get_user_language(callback.from_user.id)
    data = callback.data or ''
    if not data.startswith('sgl:'):
        await callback.answer()
        return

    parts = data.split(':', 2)
    if len(parts) != 3:
        await callback.answer(tr(lang, 'invalid_payload'), show_alert=True)
        return

    action, cache_id_raw = parts[1], parts[2]
    if action not in ('a', 'r') or not cache_id_raw.isdigit():
        await callback.answer(tr(lang, 'invalid_payload'), show_alert=True)
        return

    accept = action == 'a'

    try:
        result = await call_backend(
            'POST',
            '/api/telegram/bot/respond',
            {
                'telegramUserId': str(callback.from_user.id),
                'cacheId': int(cache_id_raw),
                'accept': accept,
            },
        )

        await callback.answer(tr(lang, 'done'))

        if callback.message is not None:
            try:
                await callback.message.edit_reply_markup(reply_markup=None)
            except Exception:  # noqa: BLE001
                pass

            result_lang = normalize_lang(result.get('language'))
            decision = tr(result_lang, 'approved' if accept else 'rejected')
            kind = str(result.get('kind', 'confirmation'))
            account_id = result.get('accountId')
            conf_id = result.get('confirmationId')
            await callback.message.answer(
                tr(
                    result_lang,
                    'inline_result',
                    kind=kind,
                    decision=decision,
                    account_id=account_id,
                    confirmation_id=conf_id,
                )
            )
    except Exception as err:  # noqa: BLE001
        await callback.answer(tr(lang, 'action_failed', error=err), show_alert=True)


@dp.message()
async def fallback(message: Message) -> None:
    lang = await get_user_language(message.from_user.id)
    text = (message.text or '').strip()

    if text.startswith('/add='):
        code = text.split('=', 1)[1]
        try:
            response = await call_backend(
                'POST',
                '/api/telegram/bot/link',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer(tr(response.get('language'), 'linked'))
        except Exception as err:  # noqa: BLE001
            await message.answer(tr(lang, 'link_failed', error=err))
        return

    if text.startswith('/add '):
        code = text.split(maxsplit=1)[1].strip()
        try:
            response = await call_backend(
                'POST',
                '/api/telegram/bot/link',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer(tr(response.get('language'), 'linked'))
        except Exception as err:  # noqa: BLE001
            await message.answer(tr(lang, 'link_failed', error=err))
        return

    await message.answer(tr(lang, 'unknown_command'))


async def main() -> None:
    if not BOT_ENABLED or bot is None:
        logging.warning('Telegram bot disabled: set a real TELEGRAM_BOT_TOKEN to enable polling')
        while True:
            await asyncio.sleep(3600)

    await dp.start_polling(bot)


if __name__ == '__main__':
    asyncio.run(main())
