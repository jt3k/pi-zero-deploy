# Tasks

## 1. Исправление переменной окружения NODE_ENV=production

- [x] 1.1 Заменить `NODE_MODULES=production` на `NODE_ENV=production` в корневом `systemd-unit.service` и функции `renderUnit` в `src/index.ts`
- [x] 1.2 Обновить модульные тесты в `test/deploy.test.ts` на проверку `NODE_ENV=production`

## 2. Реализация команды init

- [x] 2.1 Добавить подкоманду `init` в `src/index.ts`: проверка `package.json`, извлечение имени проекта, защита от перезаписи существующего `systemd-unit.service` и генерация шаблона
- [x] 2.2 Обновить `USAGE` строку в `src/index.ts` для включения команды `init`
- [x] 2.3 Написать модульные тесты в `test/cli.test.ts` для `pizdeploy init`: успешное создание, поведение при отсутствии `package.json`, поведение при уже существующем файле
- [x] 2.4 Обновить `README.md` с описанием подкоманды `pizdeploy init`

## 3. Сквозная верификация

- [x] 3.1 Запустить полный набор тестов `bun test` и строгую валидацию `openspec validate init-command --strict`
