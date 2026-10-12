# Spec Delta

## ADDED Requirements

### Requirement: Запуск процесса службы на удалённом хосте

Система SHALL запускать процесс целевой службы командой `systemctl --user start <service>` от имени подключаемого пользователя без привилегий суперпользователя.

#### Scenario: Запуск службы по явно переданному имени
- **WHEN** пользователь выполняет `pizdeploy start my-app`
- **THEN** имя службы нормализуется до `my-app.service`
- **AND** на удалённом хосте выполняется `systemctl --user start my-app.service`
- **AND** в консоль выводится подтверждение запуска службы

#### Scenario: Запуск службы по умолчанию из проекта
- **WHEN** пользователь выполняет `pizdeploy start` без указания имени
- **THEN** имя службы извлекается из `package.json` (`pizdeploy.service` или `name.service`, по умолчанию `app.service`)
- **AND** на удалённом хосте выполняется `systemctl --user start <service>`

### Requirement: Перезапуск процесса службы на удалённом хосте

Система SHALL перезапускать процесс целевой службы командой `systemctl --user restart <service>` от имени подключаемого пользователя без привилегий суперпользователя.

#### Scenario: Перезапуск службы по явно переданному имени
- **WHEN** пользователь выполняет `pizdeploy restart my-app`
- **THEN** имя службы нормализуется до `my-app.service`
- **AND** на удалённом хосте выполняется `systemctl --user restart my-app.service`
- **AND** в консоль выводится подтверждение перезапуска службы

#### Scenario: Перезапуск службы по умолчанию из проекта
- **WHEN** пользователь выполняет `pizdeploy restart` без указания имени
- **THEN** имя службы извлекается из `package.json` (`pizdeploy.service` или `name.service`, по умолчанию `app.service`)
- **AND** на удалённом хосте выполняется `systemctl --user restart <service>`

### Requirement: Просмотр статуса службы на удалённом хосте

Система SHALL запрашивать и выводить в stdout статус целевой службы командой `systemctl --user status <service>` от имени подключаемого пользователя без привилегий суперпользователя.

#### Scenario: Просмотр статуса службы
- **WHEN** пользователь выполняет `pizdeploy status my-app`
- **THEN** на удалённом хосте выполняется `systemctl --user status my-app.service`
- **AND** результат выводится пользователю без изменений

### Requirement: Просмотр логов службы на удалённом хосте

Система SHALL запрашивать и выводить в stdout журнал службы командой `journalctl --user -u <service> -n 50 --no-pager` от имени подключаемого пользователя без привилегий суперпользователя.

#### Scenario: Просмотр последних записей журнала
- **WHEN** пользователь выполняет `pizdeploy logs my-app`
- **THEN** на удалённом хосте запрашиваются последние записи журнала службы через `journalctl --user -u my-app.service -n 50 --no-pager`
- **AND** журнал отображается в stdout

### Requirement: Удаление и снятие службы с учёта

Система SHALL останавливать службу, отключать её автозапуск, удалять её файл unit из `~/.config/systemd/user/<service>`, выполнять перезагрузку демона пользовательского systemd и удалять симлинк `current` каталога проекта, сохраняя при этом директорию проекта и историю версий в `releases/`.

#### Scenario: Успешное удаление службы
- **WHEN** пользователь выполняет `pizdeploy remove my-app` или `pizdeploy rm my-app`
- **THEN** служба останавливается (`systemctl --user stop my-app.service`)
- **AND** служба отключается (`systemctl --user disable my-app.service`)
- **AND** файл `~/.config/systemd/user/my-app.service` удаляется
- **AND** выполняется `systemctl --user daemon-reload`
- **AND** симлинк `/home/pi/projects/my-app/current` удаляется
- **AND** каталог `/home/pi/projects/my-app/releases` сохраняется на диске
- **AND** выводится сообщение об успешном удалении службы
