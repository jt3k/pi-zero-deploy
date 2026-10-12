# Proposal

## Why

После развёртывания сервисов и инспекции их состояния через `pizdeploy ps` разработчику требуется оперативное управление жизненным циклом служб на Raspberry Pi — возможность остановить процесс службы или отключить её автозапуск при перезагрузке ОС без ручного ввода длинных команд SSH и `systemctl`.

## What Changes

- **Подкоманды `pizdeploy stop [name]` и `pizdeploy disable [name]`:**
  - `pizdeploy stop [name]`: останавливает работающую службу на целевом хосте (`sudo systemctl stop <service>`).
  - `pizdeploy disable [name]`: отключает автозапуск службы (`sudo systemctl disable <service>`).
  - Если `[name]` не передан, имя службы разрешается из локального `package.json` (`pkg.pizdeploy?.service` или `${pkg.name}.service`, по умолчанию `app.service`).
  - Если `[name]` передан (например, `pizdeploy stop my-app` или `pizdeploy stop pi-zero-deploy-lite.service`), команда управляет указанной службой (с автоматическим добавлением суффикса `.service`, если он опущен).
- **Обновление разбора аргументов и строки usage:**
  - Актуализация подсказки: `usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]`.
  - Поддержка флага `--ssh` и конфигурации хоста из `package.json` для обеих подкоманд.
- **Информативные сообщения об успехе и ошибках:**
  - Печать статуса выполнения (например, `⏹ Служба app.service остановлена` и `🛑 Автозапуск службы app.service отключен`).
  - Корректная обработка случаев, когда служба не найдена на хосте.

## Capabilities

### New Capabilities
- `service-lifecycle`: Управление жизненным циклом служб systemd на удалённом хосте: остановка процесса службы (`stop`) и отключение автозапуска (`disable`) с поддержкой явного имени или разрешения из проекта.

### Modified Capabilities
- `cli-command`: Поддержка подкоманд `stop` и `disable` с позиционным аргументом имени службы/проекта; обновление строки `usage`.

## Impact

- **CLI:** расширение парсера `parseArgs` и диспетчера команд в `src/index.ts`.
- **Тесты:** добавление тестов на разбор аргументов `stop`/`disable`, разрешение имени службы и вызов SSH в `test/cli.test.ts`.
- **Документация:** добавление команд `pizdeploy stop` и `pizdeploy disable` в `README.md`.
