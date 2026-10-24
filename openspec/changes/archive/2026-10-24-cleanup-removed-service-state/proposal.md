# Proposal

## Why

При выполнении команды `pizdeploy rm <name>` (или `remove`) служба останавливается, отключается, её unit-файл удаляется и сбрасывается symlink `current`. Однако если служба до удаления находилась в состоянии сбоя (`failed`) или завершилась с ошибкой, systemd сохраняет юнит в оперативной памяти со статусом `ActiveState=failed` и `LoadState=not-found`.

Так как при удалении не вызывается `systemctl --user reset-failed <service>`, а скрипт обнаружения `pizdeploy ps` проверяет только `ActiveState` без учёта `LoadState`, удалённая служба продолжает отображаться в таблице `ps` со статусом `failed` и релизом `-`. Это вводит пользователя в заблуждение, создавая впечатление, что команда удаления не сработала.

## What Changes

- Добавить вызов `systemctl --user reset-failed <service>` в процедуру удаления службы (`remove` / `rm`) в `src/service.ts`, чтобы очистить состояние юнита в памяти systemd.
- В процедуре `pizdeploy ps` (`src/ps.ts`) учитывать `LoadState` юнита: если unit-файл отсутствует (`LoadState=not-found`) и юнит не запущен, проект без активного релиза (`current`) не должен помечаться как `failed` и не должен выводиться в таблице активных служб.
- Обновить тесты жизненного цикла служб и обнаружения статусов для валидации корректного удаления и фильтрации несуществующих служб.

## Capabilities

### New Capabilities

_(нет новых возможностей)_

### Modified Capabilities

- `service-lifecycle`: дополнить требование к удалению и снятию службы с учёта обязательным сбросом аварийного состояния юнита через `systemctl --user reset-failed <service>`.
- `service-discovery`: уточнить требование опроса systemd, чтобы статус `failed` не присваивался проектам с отсутствующим unit-файлом (`LoadState=not-found`), и проекты без активного релиза и без загруженного юнита исключались из отображения.

## Impact

- `src/service.ts`: команда `remove` / `rm` выполняет `systemctl --user reset-failed <service>`.
- `src/ps.ts`: `buildPsScript` запрашивает `LoadState` наряду с `ActiveState` и `MainPID`, игнорируя фантомные `failed`-состояния удалённых юнитов.
- `test/service.test.ts` и `test/ps.test.ts`: обновлены проверки сгенерированных удалённых скриптов.
