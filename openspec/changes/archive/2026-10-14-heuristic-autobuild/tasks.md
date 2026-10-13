# Tasks

## 1. Реализация эвристического парсера точки входа

- [x] 1.1 Реализовать функцию `detectAutobuildEntry(startCmd: string, cwd: string)` в `src/index.ts`, извлекающую входной файл, флаги node и аргументы приложения, с юнит-тестами для различных форматов (`node app.js`, `node ./src/app.js`, `node --experimental-flag index.ts`)
- [x] 1.2 Добавить понятные диагностические сообщения и рекомендации при невозможности распознать команду запуска

## 2. Интеграция автосборки в пайплайн деплоя

- [x] 2.1 Обновить шаг сборки в `main()` (`src/index.ts`): при наличии `pkg.scripts.build` вызывать `bun run build` (старое поведение); при отсутствии — вызывать `bun build <entry> --target=node --outfile=./dist/<base>.mjs --minify`
- [x] 2.2 Настроить генерацию `ExecStart` в `src/index.ts`: использовать `/usr/bin/node [flags] <base>.mjs [args]` при срабатывании автобилда и сохранить старое поведение при явном билде

## 3. Тестирование и верификация

- [x] 3.1 Добавить юнит-тесты в `test/deploy.test.ts` для деплоя проекта без `scripts.build` (проверка вызова bun build, упаковки `./dist` и сгенерированного `ExecStart` с `.mjs`)
- [x] 3.2 Проверить сохранение обратной совместимости для проектов с явным `scripts.build` в `test/deploy.test.ts`
- [x] 3.3 Запустить полный тестовый набор `bun test` и убедиться, что все тесты проходят успешно

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
