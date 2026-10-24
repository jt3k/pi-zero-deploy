# Spec Delta

## MODIFIED Requirements

### Requirement: Удаление и снятие службы с учёта

Система SHALL останавливать службу, отключать её автозапуск, удалять её файл unit из `~/.config/systemd/user/<service>`, выполнять перезагрузку демона пользовательского systemd, сбрасывать аварийное состояние службы через `systemctl --user reset-failed <service>` и удалять симлинк `current` каталога проекта в домашней директории подключенного пользователя, сохраняя при этом директорию проекта и историю версий в `releases/`.

#### Scenario: Успешное удаление службы

- **WHEN** пользователь выполняет `pizdeploy remove my-app` или `pizdeploy rm my-app`
- **THEN** служба останавливается (`systemctl --user stop my-app.service`)
- **AND** служба отключается (`systemctl --user disable my-app.service`)
- **AND** файл `~/.config/systemd/user/my-app.service` удаляется
- **AND** выполняется `systemctl --user daemon-reload`
- **AND** сбрасывается состояние юнита в systemd (`systemctl --user reset-failed my-app.service`)
- **AND** симлинк `$HOME/projects/my-app/current` удаляется
- **AND** каталог `$HOME/projects/my-app/releases` сохраняется на диске
- **AND** выводится сообщение об успешном удалении службы
