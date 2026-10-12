# Spec Delta

## MODIFIED Requirements

### Requirement: Ошибки использования завершаются кодом 2

Система SHALL завершаться с кодом возврата 2 и сообщением в stderr, содержащим актуальную подсказку по использованию `usage: pizdeploy [ps|start|stop|restart|status|logs|disable|remove|rm] [name] [--ssh <user@host>] [--dry-run]`, при неизвестном аргументе или отсутствии обязательного значения после флага `--ssh`.

#### Scenario: Неизвестный аргумент
- **WHEN** пользователь выполняет `pizdeploy --help` или `pizdeploy unknown-cmd`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps|start|stop|restart|status|logs|disable|remove|rm] [name] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2

#### Scenario: --ssh без значения
- **WHEN** пользователь выполняет `pizdeploy --ssh` или `pizdeploy stop --ssh`
- **THEN** в stderr появляется сообщение, содержащее `usage: pizdeploy [ps|start|stop|restart|status|logs|disable|remove|rm] [name] [--ssh <user@host>] [--dry-run]`
- **AND** stdout пуст
- **AND** код возврата равен 2

## ADDED Requirements

### Requirement: Подкоманды управления жизненным циклом и инспекции

Система SHALL поддерживать подкоманды `start`, `restart`, `status`, `logs`, `remove` и `rm` с опциональным позиционным аргументом имени службы или проекта (`pizdeploy <cmd> [name]`), выполняющие удалённые операции без локальной сборки проекта и создания архива.

#### Scenario: Запуск команды start
- **WHEN** пользователь выполняет `pizdeploy start [name]`
- **THEN** утилита не запускает `bun run build` и не создает архив
- **AND** передает команду запуска соответствующей службы на удалённый хост

#### Scenario: Запуск команды restart
- **WHEN** пользователь выполняет `pizdeploy restart [name]`
- **THEN** утилита не запускает `bun run build` и не создает архив
- **AND** передает команду перезапуска соответствующей службы на удалённый хост

#### Scenario: Запуск команды status
- **WHEN** пользователь выполняет `pizdeploy status [name]`
- **THEN** утилита запрашивает подробный статус systemd для службы на удалённом хосте и выводит его в stdout

#### Scenario: Запуск команды logs
- **WHEN** пользователь выполняет `pizdeploy logs [name]`
- **THEN** утилита запрашивает вывод журнала `journalctl` для службы на удалённом хосте и выводит его в stdout

#### Scenario: Запуск команды remove или rm
- **WHEN** пользователь выполняет `pizdeploy remove [name]` или `pizdeploy rm [name]`
- **THEN** утилита выполняет деактивацию службы, удаление её unit-файла и удаление симлинка `current` на удалённом хосте
