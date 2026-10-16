# Tasks

## 1. Зависимости и базовая конфигурация

- [x] 1.1 Установить devDependencies (`eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `prettier`, `eslint-config-prettier`) и проверить их успешное появление в `package.json`
- [x] 1.2 Создать `tsconfig.json` с поддержкой типов Bun и убедиться в валидности структуры JSON
- [x] 1.3 Создать `.prettierrc` и `.prettierignore` с правилами проекта и исключениями для служебных каталогов

## 2. Конфигурация ESLint и скриптов

- [x] 2.1 Создать `eslint.config.js` (Flat Config) с пресетами `typescript-eslint`, глобалями Bun/Node, правилами импортов типов и замыкающим `eslint-config-prettier`
- [x] 2.2 Добавить скрипты `lint`, `lint:fix`, `format`, `format:check` в `package.json` и проверить их регистрацию через `bun run`

## 3. Проверка и приведение кодовой базы к стандарту

- [x] 3.1 Запустить `bun run format` и проверить по `git diff` отсутствие нежелательных или логических изменений в `src/` и `test/`
- [x] 3.2 Запустить `bun run lint` (при необходимости `bun run lint:fix`) и убедиться в отсутствии ошибок линтинга с кодом возврата 0
- [x] 3.3 Запустить `bun test` и убедиться, что существующий набор тестов выполняется без ошибок
