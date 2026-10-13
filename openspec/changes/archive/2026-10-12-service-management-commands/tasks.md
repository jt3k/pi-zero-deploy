# Tasks

## 1. Расширение CLI и команды управления сервисами (start, restart, status, logs)

- [x] 1.1 Добавить команды `start`, `restart`, `status`, `logs` в парсер аргументов `src/index.ts` и обновить текст подсказки `USAGE`
- [x] 1.2 Реализовать функции-обработчики команд жизненного цикла (`handleServiceControl` для `start` и `restart`, вывод `systemctl --user status` для `status`, вывод `journalctl --user -u <service> -n 50 --no-pager` для `logs`)
- [x] 1.3 Добавить тесты на команды `start`, `restart`, `status`, `logs` в `test/cli.test.ts` и проверить прохождение `bun test`

## 2. Команда remove (rm) и фильтрация в ps

- [x] 2.1 Реализовать команду `remove` (и алиас `rm`) в `src/index.ts`: остановка службы, отключение автозапуска, удаление unit-файла, `systemctl --user daemon-reload` и удаление симлинка `current` при сохранении каталога `releases`
- [x] 2.2 Обновить функцию генерации bash-скрипта `buildPsScript`: исключать проекты, у которых нет симлинка `current` и нет запущенного процесса
- [x] 2.3 Добавить тесты для `pizdeploy remove` и обновлённой фильтрации в `test/cli.test.ts` и `test/deploy.test.ts`

## 3. Документация и верификация

- [x] 3.1 Обновить `README.md` с описанием новых сервисных команд (`start`, `restart`, `status`, `logs`, `remove`/`rm`)
- [x] 3.2 Запустить полный набор тестов `bun test` и проверить строгую валидацию спецификаций через `openspec validate service-management-commands --strict`
- [x] 3.3 Провести сквозную проверку на реальном Pi Zero (`zero.local`): деплой сервиса, вызов `status`, `restart`, `logs`, затем `remove` и подтверждение его исчезновения из `pizdeploy ps`
