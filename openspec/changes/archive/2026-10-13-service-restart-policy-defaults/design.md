# Design

## Context

См. proposal.md — Why. В [`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts#L193-L222) функция `renderUnit()` парсит файл шаблона на INI-секции.
Если секция `[Service]` уже присутствует в шаблоне (например, пользователь указал `systemd-unit.service` только с токенами бота и `Environment=`), она берётся как есть, и в неё добавляются только `WorkingDirectory=` и `ExecStart=`.
Если пользователь не прописал директивы перезапуска, сервис запускается без перезапуска (`Restart=no` по умолчанию в systemd), и при любом сбое процесс навсегда переходит в `inactive`.

## Goals / Non-Goals

**Goals:**
- Автоматически гарантировать наличие `Restart=always` и `RestartSec=2` в секции `[Service]` сгенерированного unit-файла, если пользователь не указал их явно.
- Сохранять пользовательские значения `Restart=` и `RestartSec=`, если они заданы.

**Non-Goals:**
- Менять дефолтный шаблон `systemd-unit.service` кардинально или принудительно перезаписывать существующие файлы на локальном диске пользователя.

## Decisions

### 1. Проверка наличия директив в `serviceSec.lines` перед формированием юнита

В `renderUnit()` после фильтрации старых `WorkingDirectory` и `ExecStart`:
- Проверяем, содержит ли `serviceSec.lines` строку, начинающуюся с `Restart=`. Если нет — добавляем `Restart=always`.
- Проверяем, содержит ли `serviceSec.lines` строку, начинающуюся с `RestartSec=`. Если нет — добавляем `RestartSec=2`.
- Если директивы уже присутствуют (например, `Restart=on-failure`, `RestartSec=5`), они остаются нетронутыми.

### 2. Расположение директив

Дефолтные `Restart=always` и `RestartSec=2` добавляются в `serviceSec.lines` так, чтобы структура файла оставалась логичной и читаемой (после `WorkingDirectory` и `ExecStart` либо в конце секции).

## Risks / Trade-offs

- **[Risk]** Пользователь действительно хотел разовый запуск (oneshot) без перезапусков. → **Mitigation**: Пользователь всегда может явно указать `Restart=no` в своём `systemd-unit.service`, и `pizdeploy` сохранит это значение.
