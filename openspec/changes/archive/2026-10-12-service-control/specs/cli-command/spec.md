# Spec Delta

## ADDED Requirements

### Requirement: Подкоманды stop и disable

Система SHALL поддерживать подкоманды `stop` и `disable` с опциональным позиционным аргументом имени службы или проекта (`pizdeploy stop [name]` и `pizdeploy disable [name]`), выполняющие управление службой на удалённом хосте без выполнения сборки и деплоя.

#### Scenario: Запуск pizdeploy stop
- **WHEN** пользователь выполняет `pizdeploy stop` или `pizdeploy stop my-app`
- **THEN** утилита не запускает `bun run build` и не создает архив
- **AND** передает команду остановки соответствующей службы на удалённый хост

#### Scenario: Запуск pizdeploy disable
- **WHEN** пользователь выполняет `pizdeploy disable` или `pizdeploy disable my-app`
- **THEN** утилита не запускает `bun run build` и не создает архив
- **AND** передает команду отключения автозапуска службы на удалённый хост

## MODIFIED Requirements

### Requirement: Ошибки использования завершаются кодом 2

Система SHALL завершаться с кодом возврата 2 и сообщением в stderr, содержащим актуальную подсказку по использованию `usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]`, при неизвестном аргументе или отсутствии обязательного значения после флага `--ssh`.

#### Scenario: Неизвестный аргумент
- **WHEN** пользователь выполняет `pizdeploy --help` или `pizdeploy restart app`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2

#### Scenario: --ssh без значения
- **WHEN** пользователь выполняет `pizdeploy --ssh` или `pizdeploy stop --ssh`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2
