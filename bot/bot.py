import asyncio
import logging
import os
from typing import Any

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
BACKEND_URL = os.getenv('BACKEND_INTERNAL_URL', 'http://backend:3001')

BOT_ENABLED = bool(BOT_TOKEN) and not BOT_TOKEN.startswith('change_me')
bot = Bot(BOT_TOKEN) if BOT_ENABLED else None
dp = Dispatcher()


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
            await call_backend(
                'POST',
                '/api/telegram/bot/oauth',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer('Login approved. Return to SteamGuard Web and wait for auto-login.')
        except Exception as err:  # noqa: BLE001
            await message.answer(f'Login failed: {err}')
        return

    await message.answer(
        'SteamGuard Bot ready.\n'
        'Commands:\n'
        '/add=<code> - link Telegram to web account\n'
        '/accounts - list Steam accounts\n'
        '/codes - get auth codes\n'
        '/confirm <trade_id> - confirm pending trade\n'
        '/status - bot/backend status'
    )


@dp.message(CommandStart())
async def start_plain(message: Message) -> None:
    await message.answer(
        'SteamGuard Bot is active. Use /accounts, /codes or /add=<code> from web settings.'
    )


@dp.message(Command('status'))
async def status(message: Message) -> None:
    try:
        await call_backend('GET', f'/api/telegram/bot/accounts/{message.from_user.id}')
        await message.answer('Backend connection: OK')
    except Exception as err:  # noqa: BLE001
        await message.answer(f'Backend connection error: {err}')


@dp.message(Command('accounts'))
async def accounts(message: Message) -> None:
    try:
        data = await call_backend('GET', f'/api/telegram/bot/accounts/{message.from_user.id}')
        items = data.get('items', [])
        if not items:
            await message.answer('No Steam accounts linked.')
            return

        lines = ['Your Steam accounts:']
        for item in items:
            lines.append(f"- [{item['id']}] {item['alias']} ({item.get('steamid') or 'no steamid'})")

        await message.answer('\n'.join(lines))
    except Exception as err:  # noqa: BLE001
        await message.answer(f'Failed to fetch accounts: {err}')


@dp.message(Command('codes'))
async def codes(message: Message) -> None:
    try:
        data = await call_backend('GET', f'/api/telegram/bot/codes/{message.from_user.id}')
        items = data.get('items', [])
        if not items:
            await message.answer('No linked accounts or codes unavailable.')
            return

        lines = ['Current Steam codes:']
        for item in items:
            lines.append(f"- {item['alias']}: `{item['code']}`")

        await message.answer('\n'.join(lines), parse_mode='Markdown')
    except Exception as err:  # noqa: BLE001
        await message.answer(f'Failed to fetch codes: {err}')


@dp.message(Command('confirm'))
async def confirm(message: Message) -> None:
    text = message.text or ''
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer('Usage: /confirm <trade_id> OR /confirm <account_id>:<trade_id>')
        return

    identifier = parts[1].strip()

    try:
        pending = await call_backend('GET', f'/api/telegram/bot/confirms/{message.from_user.id}')
        items = pending.get('items', [])
        if not items:
            await message.answer('No pending confirmations.')
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
            await message.answer('Trade confirmation id not found in pending queue.')
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

        await message.answer('Trade confirmation sent to Steam successfully.')
    except Exception as err:  # noqa: BLE001
        await message.answer(f'Confirm failed: {err}')


@dp.message()
async def fallback(message: Message) -> None:
    text = (message.text or '').strip()

    if text.startswith('/add='):
        code = text.split('=', 1)[1]
        try:
            await call_backend(
                'POST',
                '/api/telegram/bot/link',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer('Telegram account linked successfully.')
        except Exception as err:  # noqa: BLE001
            await message.answer(f'Link failed: {err}')
        return

    if text.startswith('/add '):
        code = text.split(maxsplit=1)[1].strip()
        try:
            await call_backend(
                'POST',
                '/api/telegram/bot/link',
                {
                    'code': code,
                    'telegramUserId': str(message.from_user.id),
                    'username': message.from_user.username,
                },
            )
            await message.answer('Telegram account linked successfully.')
        except Exception as err:  # noqa: BLE001
            await message.answer(f'Link failed: {err}')
        return

    await message.answer('Unknown command. Use /accounts, /codes, /confirm or /add=<code>.')


async def main() -> None:
    if not BOT_ENABLED or bot is None:
        logging.warning('Telegram bot disabled: set a real TELEGRAM_BOT_TOKEN to enable polling')
        while True:
            await asyncio.sleep(3600)

    await dp.start_polling(bot)


if __name__ == '__main__':
    asyncio.run(main())
