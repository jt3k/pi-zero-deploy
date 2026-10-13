# Proposal

## Why

При падении процесса на удалённом хосте служба systemd может остаться в состоянии `inactive`, если в unit-файле не настроена политика перезапуска. В настоящее время, если проект предоставляет кастомный `systemd-unit.service` без директив `Restart=` и `RestartSec=`, служба не восстанавливается автоматически после сбоев (как произошло с ботом `kmp`).

## What Changes

- В функции рендеринга юнита `renderUnit()` секция `[Service]` должна гарантированно содержать политику автоперезапуска:
  - Если директива `Restart=` отсутствует в секции `[Service]`, автоматически подставлять `Restart=always`.
  - Если директива `RestartSec=` отсутствует в секции `[Service]`, автоматически подставлять `RestartSec=2`.
  - Если пользователь явно указал свои значения `Restart=` или `RestartSec=` в `systemd-unit.service`, утилита сохраняет их без перезаписи.
- Обновить тесты генерации unit-файлов для проверки применения дефолтов и сохранения пользовательских настроек.

## Capabilities

### New Capabilities

_Нет новых capability._

### Modified Capabilities

- `user-unit-runtime`: требование «Unit-файл формируется утилитой по каноничному шаблону» дополняется гарантией применения политик перезапуска (`Restart=always`, `RestartSec=2`) по умолчанию при их отсутствии в секции `[Service]`.

## Impact

- **Код**: [`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts) (`renderUnit`).
- **Тесты**: [`test/deploy.test.ts`](file:///Users/jt3k/work/pizdeploy/test/deploy.test.ts) или [`test/cli.test.ts`](file:///Users/jt3k/work/pizdeploy/test/cli.test.ts).
- **Службы**: все новые и повторно развёртываемые сервисы автоматически получают устойчивость к падениям с паузой рестарта 2 секунды.
