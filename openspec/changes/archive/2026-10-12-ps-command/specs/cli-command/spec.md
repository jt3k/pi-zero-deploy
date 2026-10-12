# Spec Delta

## ADDED Requirements

### Requirement: Подкоманда ps для инспекции состояния

Система SHALL поддерживать подкоманду `ps` (`pizdeploy ps`), запускающую опрос статуса удалённых сервисов без выполнения сборки проекта, создания архива и операций деплоя.

#### Scenario: Запуск команды pizdeploy ps
- **WHEN** пользователь выполняет `pizdeploy ps`
- **THEN** утилита не выполняет локальную сборку `bun run build`
- **AND** не создает архив `dist.tar.gz`
- **AND** выполняет запрос инспекции статуса сервисов на удалённом хосте

## MODIFIED Requirements

### Requirement: Ошибки использования завершаются кодом 2

Система SHALL завершаться с кодом возврата 2 и сообщением в stderr, содержащим актуальную подсказку по использованию `usage: pizdeploy [ps] [--ssh <user@host>] [--dry-run]`, при неизвестном аргументе или отсутствии обязательного значения после флага `--ssh`.

#### Scenario: Неизвестный аргумент
- **WHEN** пользователь выполняет `pizdeploy --help` или `pizdeploy deploy prod`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2

#### Scenario: --ssh без значения
- **WHEN** пользователь выполняет `pizdeploy --ssh` или `pizdeploy ps --ssh`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2
