# Design

## Context

В текущей реализации `pizdeploy rm` (или `remove`) выполняет на удалённом хосте цепочку команд:

```bash
systemctl --user stop ${service} 2>/dev/null || true
systemctl --user disable ${service} 2>/dev/null || true
rm -f ~/.config/systemd/user/${service}
systemctl --user daemon-reload
rm -f ${REMOTE_PROJECTS_ROOT}/${proj}/current
```

Если служба ранее упала (`ActiveState=failed`) или завершилась с ошибкой при остановке, systemd сохраняет информацию о сбое в памяти даже после физического удаления файла `~/.config/systemd/user/<service>.service` и выполнения `daemon-reload`. Свойство `LoadState` переходит в `not-found`, но `ActiveState` остаётся `failed` до явного вызова `systemctl --user reset-failed <service>`.

При последующем вызове `pizdeploy ps` генерируется удалённый скрипт (`buildPsScript` в `src/ps.ts`), который обходит `$HOME/projects/*`. Для директории удалённого проекта (где симлинк `current` удалён, но сохранён каталог `releases/`) выполняется:

```bash
systemctl --user show "${name}.service" -p ActiveState -p MainPID 2>/dev/null
```

Так как `ActiveState` равен `failed`, скрипт выставляет `stat="failed"`. Фильтр `[[ $has_current -eq 0 && "$stat" == "inactive" ]] && continue` не срабатывает, в результате чего проект без релиза со статусом `failed` попадает в результирующую таблицу `console.table`.

## Goals / Non-Goals

**Goals:**

- Очищать состояние сбоя юнита в памяти systemd при выполнении `pizdeploy rm <name>` через `systemctl --user reset-failed <service>`.
- Обрабатывать свойство `LoadState` в `src/ps.ts`: если `LoadState=not-found` (unit-файл не существует), служба не должна определяться как `failed` или `running`.
- Гарантировать, что директории проектов без активного релиза (`current`) и с отсутствующим юнит-файлом (`LoadState=not-found`) исключаются из вывода `pizdeploy ps`.

**Non-Goals:**

- Удаление архивных релизов в `releases/` (по спецификации история сохраняется).
- Изменение структуры вывода таблицы `ps` (`Release`, `Status`, `URL`, `PID`).

## Decisions

### Решение 1: Вызов `systemctl --user reset-failed ${service}` в `service.ts`

При выполнении команды `remove` / `rm` после `systemctl --user daemon-reload` добавляется:

```bash
systemctl --user reset-failed ${service} 2>/dev/null || true
```

_Обоснование:_ systemd сразу удаляет внутреннюю запись о сбойном юните из кэша пользовательского менеджера.
_Альтернатива:_ Вызывать глобальный `systemctl --user reset-failed` без аргументов — отклонено, чтобы не затронуть другие пользовательские службы, не относящиеся к удаляемому проекту.

### Решение 2: Проверка `LoadState` в `buildPsScript` (`src/ps.ts`)

В команду опроса systemd добавляется флаг `-p LoadState`:

```bash
systemctl --user show "${name}.service" -p ActiveState -p MainPID -p LoadState 2>/dev/null
```

При разборе вывода считывается `load_state`.
Если `load_state == "not-found"`, то `astate` не интерпретируется как сбой сервиса, и `stat` остаётся `inactive`.
Кроме того, условие пропуска строки дополняется:

```bash
[[ $has_current -eq 0 && ( "$stat" == "inactive" || "$load_state" == "not-found" ) ]] && continue
```

_Обоснование:_ Двухуровневая защита: даже если служба была удалена ранее (до добавления `reset-failed` в `service.ts`) или unit был стёрт вручную, `pizdeploy ps` не будет выводить фантомную службу.
_Альтернатива:_ Ограничиться только правкой `service.ts` — отклонено, так как на хостах, где службы уже находятся в состоянии `LoadState=not-found, ActiveState=failed`, они продолжали бы висеть в `pizdeploy ps`.

## Risks / Trade-offs

- **[Risk]** Наличие старых версий systemd на экзотических SBC.
  → _Mitigation:_ Свойства `LoadState`, `ActiveState`, `MainPID` и команда `reset-failed` стабильны во всех версиях systemd (начиная с systemd v200+).
- **[Risk]** Юнит завершился ошибкой во время выполнения `stop`.
  → _Mitigation:_ `reset-failed` вызывается после `stop`, `disable`, `rm` и `daemon-reload`, поэтому любой статус сбоя, возникший при остановке, будет гарантированно сброшен.
