# Tasks

## 1. Шаблон и функция рендеринга с инжекцией путей

- [x] 1.1 Создать эталонный файл `systemd-unit.service` в корне репозитория `pizdeploy` (чистый шаблон без `WorkingDirectory` и `ExecStart`, с `NODE_MODULES=production`)
- [x] 1.2 Реализовать в `src/index.ts` функцию `renderUnit`: чтение `./systemd-unit.service` из проекта или из корня `pizdeploy`, сохранение пользовательских настроек (Description, Environment и т.д.) и автоматическая инжекция `WorkingDirectory` и `ExecStart`
- [x] 1.3 Написать модульные тесты в `test/deploy.test.ts` (проверка дефолтного рендеринга и переопределения пользовательским шаблоном с переменными вроде `BOT_TOKEN`)

## 2. Документация и верификация

- [x] 2.1 Обновить `README.md` с описанием использования `systemd-unit.service` в проекте (на примере Telegram-бота с `BOT_TOKEN`)
- [x] 2.2 Прогнать полный набор тестов `bun test` и строгую валидацию `openspec validate custom-unit-template --strict`
- [x] 2.3 Провести сквозную проверку на реальном Pi Zero (`zero.local`): деплой тестового проекта с файлом `systemd-unit.service` и проверка итогового содержимого в `~/.config/systemd/user/<service>.service`
