# Proposal

## Why

Команда `pizdeploy ps` в фоллбэке опроса `systemctl --user show "${name}.service"` считывает свойства через `read -r astate main_pid < <(...)`. Однако порядок вывода строк утилите `systemctl show --property=ActiveState,MainPID --value` не гарантированно совпадает с аргументами вызова: в systemd на целевом хосте сначала выводится `MainPID` (число), а второй строкой `ActiveState` (`active`/`inactive`). Из-за этого переменная `astate` получала значение PID (например `"16684"`), а `main_pid` получала `"active"`. Условие `[[ "$astate" == "active" ]]` никогда не выполнялось, и сервисы без открытых портов (telegram-боты, воркеры) продолжали отображаться как `inactive` с прочерками вместо PID.

## What Changes

- Изменить разбор свойств systemd в `buildPsScript()` на явный парсинг `ключ=значение` (через `systemctl --user show "${name}.service" -p ActiveState -p MainPID` без `--value` или построчное чтение ключей). Это гарантирует корректное извлечение `ActiveState` и `MainPID` независимо от порядка следования свойств в выводе `systemctl`.
- Проверить реальный вывод команды `pizdeploy ps` на удалённом хосте `zero.local`, чтобы убедиться, что сервисы без портов (`noproud`, `kmp`) отображаются со статусом `running` и реальным PID.

## Capabilities

### New Capabilities

_Нет новых capability._

### Modified Capabilities

_Требования спецификаций не меняются: требование по определению беспортовых сервисов уже зафиксировано в `service-discovery`. Это исправление внутренней реализации парсинга._

## Impact

- **Код**: [`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts) (`buildPsScript`).
- **Тесты**: [`test/cli.test.ts`](file:///Users/jt3k/work/pizdeploy/test/cli.test.ts).
