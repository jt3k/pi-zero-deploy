# Tasks

## 1. Разбор аргументов CLI и поддержка подкоманд stop и disable

- [x] 1.1 Добавить распознавание подкоманд `stop` и `disable` с опциональным позиционным аргументом имени службы в `src/index.ts`
- [x] 1.2 Обновить строку ошибки `usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]`
- [x] 1.3 Добавить юнит-тесты на разбор `pizdeploy stop`, `pizdeploy disable`, нормализацию имени и валидацию `usage` в `test/cli.test.ts`

## 2. Реализация удалённого управления службой

- [x] 2.1 Реализовать функцию `handleServiceControl(host, action, serviceName)` в `src/index.ts` для выполнения `systemctl stop` и `systemctl disable` через SSH
- [x] 2.2 Добавить проверку существования службы на хосте и вывод информативных сообщений (например, `⏹ Служба <name> остановлена`, `🛑 Автозапуск <name> отключен`)
- [x] 2.3 Добавить тесты на вызов удалённых команд остановки и отключения в `test/cli.test.ts`

## 3. Документация и финальная проверка

- [x] 3.1 Запустить полный набор тестов `bun test` и убедиться в успешном прохождении всех сценариев
- [x] 3.2 Обновить `README.md` с описанием подкоманд `pizdeploy stop` и `pizdeploy disable`

## Workflow follow-up

- Заархивировать изменение после завершения разработки через `openspec archive service-control`.
- Проверить актуальное состояние спецификаций через `openspec list --specs`.
