# Tasks

## 1. Реализация дефолтов перезапуска в renderUnit

- [x] 1.1 Добавить проверку и автоматическую подстановку `Restart=always` и `RestartSec=2` в секцию `[Service]` в функции `renderUnit()` в [`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts), сохраняя явные пользовательские значения
- [x] 1.2 Добавить юнит-тесты в [`test/deploy.test.ts`](file:///Users/jt3k/work/pizdeploy/test/deploy.test.ts) на проверку автоматической подстановки `Restart=always`/`RestartSec=2` и сохранения пользовательских настроек
- [x] 1.3 Запустить `bun test` и убедиться, что все тесты проходят успешно
