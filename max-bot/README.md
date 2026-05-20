# MAX Bot

Бот под мессенджер MAX на JavaScript с официальной библиотекой `@maxhub/max-bot-api`.

## Что уже есть

- отдельный MAX-бот;
- подключение через официальный MAX Bot API;
- создание пользователя в backend при `/start`;
- стартовый экран с согласием с правилами;
- inline-клавиатура подписки;
- проверка подписки на MAX-канал через бота-админа;
- меню с кнопкой открытия игры.

## Что ещё можно улучшить

- хранение состояния согласия с правилами в backend;
- полноценное меню вместо мокапа;
- финальные тексты, ссылки и поддержку.

## Текущий сценарий

1. Пользователь нажимает `/start`.
2. Бот создает пользователя в backend и показывает стартовое сообщение.
3. Пользователь подтверждает согласие с правилами.
4. Бот предлагает подписаться на канал и проверить подписку.
5. После успешной проверки бот показывает мокап меню с кнопками `Открыть игру`, `Правила` и `Поддержка`.

## Размещение

- production webhook host: `https://bot.ozon-travel-max.ru`
- рекомендуемый webhook path: `/max/webhook`
- веб-игра открывается по `GAME_WEBAPP_URL`

## Переменные окружения

- `MAX_BOT_TOKEN` - токен бота из Master Bot в MAX;
- `MAX_BOT_MODE` - `webhook` (по умолчанию) или `polling` для локальной отладки;
- `MAX_WEBHOOK_BASE_URL` - базовый HTTPS URL для webhook, например `https://bot.ozon-travel-max.ru`;
- `MAX_WEBHOOK_PATH` - путь webhook, например `/max/webhook`;
- `MAX_WEBHOOK_SECRET` - optional, секрет для проверки заголовка `X-Max-Bot-Api-Secret`;
- `MAX_AUTO_REGISTER_WEBHOOK` - если `true`, бот регистрирует webhook в MAX API при старте;
- `MAX_WEBHOOK_RETRY_MS` - интервал повторной регистрации webhook;
- `MAX_WEBHOOK_UPDATE_TYPES` - optional, список типов событий через запятую;
- `MAX_CHANNEL_URL` - ссылка на канал проекта в MAX;
- `MAX_CHANNEL_CHAT_ID` - optional, id канала MAX для ускорения проверки подписки;
- `GAME_WEBAPP_URL` - ссылка на веб-игру, например `https://ozon-travel-max.ru`;
- `SUPPORT_CONTACT` - контакт поддержки;
- `GAME_API_URL` - адрес backend API;
- `LOG_LEVEL` - уровень логирования сервиса;
- `BROADCAST_INTERNAL_TOKEN` - токен для внутренних broadcast endpoint;
- `REQUEST_BODY_SECRET` - ключ для шифрования тела запроса;
- `REQUIRE_ENCRYPTED_REQUESTS` - включить шифрование запросов.
