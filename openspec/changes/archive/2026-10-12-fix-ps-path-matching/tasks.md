# Tasks

## 1. Исправление бага сопоставления путей в pizdeploy ps

- [x] 1.1 Обновить python-скрипт в `handlePs` в `src/index.ts`: заменить `cwd.startswith(p)` на строгое сопоставление `cwd == p or cwd.startswith(p + "/")`
- [x] 1.2 Добавить юнит-тест в `test/cli.test.ts`, симулирующий проекты с префиксными именами (например, `app` и `app-worker`), и убедиться, что `app` не перехватывает чужие процессы
- [x] 1.3 Запустить полный набор тестов `bun test` и подтвердить их успешное выполнение

## 2. Очистка устаревшего процесса на сервере Raspberry Pi

- [x] 2.1 Завершить устаревший фоновый процесс `node` (PID 11538 / 11537) на `pi@zero.local` и удалить устаревший файл `/tmp/pi-zero-deploy-lite.pid`
- [x] 2.2 Выполнить `pizdeploy ps` и убедиться в корректности вывода: `pi-zero-deploy` остаётся `running` на порту 3333, а `pi-zero-deploy-lite` отображается как `inactive`

## Workflow follow-up

- Заархивировать изменение после завершения разработки через `openspec archive fix-ps-path-matching`.
