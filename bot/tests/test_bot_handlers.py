import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import bot as bot_module


class FakeMessage:
    def __init__(self, text='/start', user_id=12345, username='tester'):
        self.text = text
        self.from_user = SimpleNamespace(id=user_id, username=username)
        self.answers = []

    async def answer(self, text, **kwargs):
        self.answers.append({'text': text, **kwargs})


class FakeCallbackMessage:
    def __init__(self):
        self.answers = []
        self.markup_removed = False

    async def edit_reply_markup(self, reply_markup=None):
        self.markup_removed = reply_markup is None

    async def answer(self, text, **kwargs):
        self.answers.append({'text': text, **kwargs})


class FakeCallback:
    def __init__(self, data='sgl:a:44', user_id=12345):
        self.data = data
        self.from_user = SimpleNamespace(id=user_id)
        self.message = FakeCallbackMessage()
        self.answers = []

    async def answer(self, text=None, **kwargs):
        self.answers.append({'text': text, **kwargs})


class BotHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_plain_shows_localized_command_help(self):
        message = FakeMessage('/start')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='ru')):
            await bot_module.start_plain(message)

        self.assertIn('Команды:', message.answers[0]['text'])
        self.assertIn('/accounts', message.answers[0]['text'])

    async def test_start_login_deep_link_approves_oauth(self):
        message = FakeMessage('/start login_ABC123')
        with patch.object(bot_module, 'call_backend', AsyncMock(return_value={'language': 'ru'})) as call_backend:
            await bot_module.start_with_param(message)

        call_backend.assert_awaited_once_with(
            'POST',
            '/api/telegram/bot/oauth',
            {'code': 'ABC123', 'telegramUserId': '12345', 'username': 'tester'},
        )
        self.assertIn('Вход подтверждён', message.answers[0]['text'])

    async def test_add_command_links_telegram_account(self):
        message = FakeMessage('/add=LINK42')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='en')), patch.object(
            bot_module, 'call_backend', AsyncMock(return_value={'language': 'ru'})
        ) as call_backend:
            await bot_module.fallback(message)

        call_backend.assert_awaited_once_with(
            'POST',
            '/api/telegram/bot/link',
            {'code': 'LINK42', 'telegramUserId': '12345', 'username': 'tester'},
        )
        self.assertEqual(message.answers[0]['text'], 'Telegram успешно привязан.')

    async def test_accounts_lists_backend_accounts(self):
        message = FakeMessage('/accounts')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='en')), patch.object(
            bot_module,
            'call_backend',
            AsyncMock(return_value={'items': [{'id': 7, 'alias': 'main', 'steamid': '76561198000000001'}]}),
        ):
            await bot_module.accounts(message)

        self.assertIn('Your Steam accounts:', message.answers[0]['text'])
        self.assertIn('[7] main (76561198000000001)', message.answers[0]['text'])

    async def test_codes_lists_current_codes_with_markdown(self):
        message = FakeMessage('/codes')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='en')), patch.object(
            bot_module, 'call_backend', AsyncMock(return_value={'items': [{'alias': 'main', 'code': 'ABCDE'}]})
        ):
            await bot_module.codes(message)

        self.assertIn('Current Steam codes:', message.answers[0]['text'])
        self.assertIn('`ABCDE`', message.answers[0]['text'])
        self.assertEqual(message.answers[0]['parse_mode'], 'Markdown')

    async def test_confirm_resolves_pending_trade_and_calls_backend(self):
        message = FakeMessage('/confirm 9001')
        calls = []

        async def fake_call(method, path, payload=None):
            calls.append((method, path, payload))
            if method == 'GET':
                return {'items': [{'account_id': 7, 'confirmation_id': '9001', 'nonce': 'nonce-1'}]}
            return {'success': True, 'language': 'en'}

        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='en')), patch.object(
            bot_module, 'call_backend', AsyncMock(side_effect=fake_call)
        ):
            await bot_module.confirm(message)

        self.assertEqual(calls[0], ('GET', '/api/telegram/bot/confirms/12345', None))
        self.assertEqual(
            calls[1],
            (
                'POST',
                '/api/telegram/bot/confirm',
                {'telegramUserId': '12345', 'accountId': 7, 'confirmationId': '9001', 'nonce': 'nonce-1'},
            ),
        )
        self.assertEqual(message.answers[0]['text'], 'Trade confirmation sent to Steam successfully.')

    async def test_status_reports_backend_ok(self):
        message = FakeMessage('/status')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='ru')), patch.object(
            bot_module, 'call_backend', AsyncMock(return_value={'items': []})
        ):
            await bot_module.status(message)

        self.assertEqual(message.answers[0]['text'], 'Соединение с backend: OK')

    async def test_inline_button_posts_response_and_clears_markup(self):
        callback = FakeCallback('sgl:r:44')
        with patch.object(bot_module, 'get_user_language', AsyncMock(return_value='en')), patch.object(
            bot_module,
            'call_backend',
            AsyncMock(
                return_value={
                    'success': True,
                    'kind': 'login',
                    'accountId': 7,
                    'confirmationId': 'auth:1',
                    'status': 'rejected',
                    'language': 'en',
                }
            ),
        ) as call_backend:
            await bot_module.inline_login_decision(callback)

        call_backend.assert_awaited_once_with(
            'POST',
            '/api/telegram/bot/respond',
            {'telegramUserId': '12345', 'cacheId': 44, 'accept': False},
        )
        self.assertEqual(callback.answers[0]['text'], 'Done')
        self.assertTrue(callback.message.markup_removed)
        self.assertIn('login rejected', callback.message.answers[0]['text'])


if __name__ == '__main__':
    unittest.main()
