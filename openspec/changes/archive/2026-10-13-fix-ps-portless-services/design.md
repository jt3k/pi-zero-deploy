# Design

## Context

См. proposal.md — Why. Текущая реализация `buildPsScript()` ([src/index.ts#L432-L474](file:///Users/jt3k/work/pizdeploy/src/index.ts#L432-L474)) строит bash-скрипт, который на удалённом хосте:

1. Собирает PID→port из `ss -tlpn`
2. Для каждого каталога в `/home/pi/projects/*` ищет PID, чей `cwd` совпадает с каталогом проекта
3. Возвращает JSON-массив с полями `project`, `release`, `service`, `status`, `port`, `pid`

`handlePs()` ([src/index.ts#L476-L519](file:///Users/jt3k/work/pizdeploy/src/index.ts#L476-L519)) парсит этот JSON и формирует таблицу со столбцами `Project`, `Release`, `Status`, `URL`, `Service`, `PID`.

Проблема: шаг 2 перебирает только PID, найденные в шаге 1 (слушающие TCP-порт). Процессы без порта (telegram-боты, воркеры) пропускаются.

## Goals / Non-Goals

**Goals:**
- Обнаруживать запущенные сервисы, не слушающие TCP-порт, через `systemctl --user`
- Убрать дублирующий столбец `Service` из таблицы

**Non-Goals:**
- Поддержка системных юнитов (не user-юнитов) — pizdeploy работает только с `--user`
- Изменение формата JSON-ответа удалённого скрипта в качестве публичного API (его нет)
- Обнаружение процессов, запущенных вне systemd (вручную через `nohup`, `screen` и т.д.)

## Decisions

### 1. Фоллбэк через `systemctl --user show` вместо `/proc` сканирования

**Решение**: после цикла по `ss -tlpn` для проектов со статусом `inactive` выполнять `systemctl --user show <name>.service --property=ActiveState,MainPID --value`.

**Альтернатива**: сканировать все `/proc/*/cwd` на хосте.
**Причина отказа**: полный скан `/proc` дорог на Pi Zero и требует доступа к чужим `/proc/<pid>/cwd` (может быть закрыт `hidepid`). `systemctl` уже используется pizdeploy повсеместно и даёт точный ответ за один вызов.

**Альтернатива**: парсить вывод `systemctl --user list-units` один раз.
**Причина отказа**: `show` с `--property` даёт структурированный вывод без парсинга таблицы, и позволяет точно сопоставить юнит с проектом по имени `<name>.service`.

### 2. Имя юнита = имя проекта + `.service`

**Решение**: для фоллбэка предполагаем конвенцию `<project-name>.service`. Это уже соблюдается pizdeploy при деплое (строка `const defaultService = normalizeService(pkg?.pizdeploy?.service || pkg?.name || "app")` в main).

### 3. Удаление столбца `Service` и поля `service` из JSON

**Решение**: убрать поле `service` из bash-скрипта и из TypeScript-маппинга. Столбец `Service` не появляется в `console.table()`.

**Обоснование**: `service` всегда равен `<project>.service` (при pizdeploy-конвенции) или `-` (при неактивном сервисе). Информационная ценность нулевая — project name уже есть в столбце `Project`.

### 4. Удаление `UNIT_NAME_FN` и cgroup-парсинга из ps-скрипта

**Решение**: раз столбец `Service` удаляется, функция `unit_name_of` и чтение `/proc/$pid/cgroup` в ps-скрипте больше не нужны. Код упрощается.

**Примечание**: экспорт `UNIT_NAME_FN` используется только в тестах cgroup; тесты удаляются вместе с экспортом. Однако сам `UNIT_NAME_FN` следует сохранить в экспорте если он используется в других местах (проверка показала — только в тестах, можно удалить).

## Risks / Trade-offs

- **[Risk]** Имя юнита может не совпадать с именем каталога проекта, если пользователь вручную переименовал юнит. → **Mitigation**: pizdeploy сам создаёт юниты при деплое с конвенцией `<name>.service`; ручное переименование — edge case за пределами поддерживаемого сценария.
- **[Risk]** `systemctl --user show` на каждый проект — дополнительные вызовы. → **Mitigation**: вызов делается только для проектов, не обнаруженных через `ss`, их обычно 1-3; один `systemctl show` занимает < 10 мс на Pi Zero.
- **[Trade-off]** Удаление столбца `Service` — **BREAKING** для скриптов, парсящих вывод `pizdeploy ps`. → Маловероятно: вывод `console.table()` не документирован как машиночитаемый API.
