# Tasks

## 1. Безопасная ротация релизов

- [x] 1.1 Реализовать функцию генерации скрипта безопасной ротации `buildRotationScript(releasesDir: string, currentLink: string): string` в `src/deploy.ts` с защитой активного релиза (`current`) и сортировкой по `mtime`
- [x] 1.2 Подключить `buildRotationScript` на шаге 14 функции `handleDeploy` в `src/deploy.ts` вместо устаревшей команды `sort | head -n -3`
- [x] 1.3 Добавить юнит-тесты генерации и выполнения команды ротации в `test/deploy.test.ts` и убедиться в их прохождении через `bun test test/deploy.test.ts`

## 2. Детализация статусов служб в ps

- [x] 2.1 Обновить генератор bash-скрипта `buildPsScript` в `src/ps.ts`, добавив сопоставление `ActiveState=activating` со статусом `restarting` и `ActiveState=failed` со статусом `failed`
- [x] 2.2 Обновить тесты в `test/ps.test.ts` и `test/cli.test.ts`, проверяющие корректную обработку и отображение статусов `restarting` и `failed`, и проверить их через `bun test`

## 3. Верификация и документация

- [x] 3.1 Обновить раздел `README.md`, зафиксировав инварианты безопасной ротации и расширенный список статусов в таблице `pizdeploy ps`
- [x] 3.2 Выполнить полную проверку кодовой базы: запуск `bun test`, `bun run lint` и `bun run format:check`
