# Spec Delta

## MODIFIED Requirements

### Requirement: Unit-файл формируется утилитой по каноничному шаблону

Система SHALL формировать unit-файл на основе файла шаблона `systemd-unit.service` (из корня деплоящего проекта при его наличии или эталонного шаблона `pizdeploy`), автоматически внедрять в секцию `[Service]` параметры `WorkingDirectory` (путь к `current`) и `ExecStart` (команда из `scripts.start`), сохранять пользовательские переменные окружения и директивы, использовать `NODE_ENV=production` по умолчанию, и записывать юнит в `~/.config/systemd/user/<service>.service` строго под именем целевой службы. Если в секции `[Service]` не задана директива `Restart=`, система SHALL автоматически внедрять `Restart=always`. Если не задана директива `RestartSec=`, система SHALL автоматически внедрять `RestartSec=2`. Если эти директивы явно заданы пользователем в шаблоне, система SHALL сохранять их без изменений.

#### Scenario: Юнит создаётся для нового проекта
- **WHEN** деплоится проект с корректно заданным `scripts.start`
- **THEN** в каталоге пользовательских юнитов создаётся файл `<service>`
- **AND** его `WorkingDirectory` указывает на симлинк `current` каталога проекта
- **AND** его `ExecStart` запускает команду, полученную из `scripts.start`
- **AND** заданы перезапуск при падении, автозапуск при старте пользовательской сессии и `Environment="NODE_ENV=production"`

#### Scenario: Локальный каталог systemd игнорируется
- **WHEN** в деплоящем проекте присутствует каталог `systemd/` с произвольным содержимым
- **THEN** это содержимое не передаётся на хост и не влияет на установленный юнит

#### Scenario: Использование пользовательского шаблона systemd-unit.service
- **WHEN** в корне деплоящего проекта присутствует файл `systemd-unit.service`
- **THEN** утилита использует его в качестве основы, сохраняя пользовательские директивы (например, `Environment=`)
- **AND** автоматически внедряет актуальные `WorkingDirectory` и `ExecStart`
- **AND** передаёт и сохраняет юнит на хосте под каноничным именем `<service>.service`

#### Scenario: Использование дефолтного шаблона pizdeploy
- **WHEN** в корне деплоящего проекта отсутствует файл `systemd-unit.service`
- **THEN** утилита использует эталонный шаблон `systemd-unit.service` из репозитория `pizdeploy`
- **AND** передаёт и сохраняет его на хосте под каноничным именем `<service>.service`

#### Scenario: Автоматическое добавление Restart=always и RestartSec=2 при их отсутствии в кастомном шаблоне
- **WHEN** в корне проекта задан файл `systemd-unit.service`
- **AND** в секции `[Service]` отсутствуют строки `Restart=` и `RestartSec=`
- **THEN** сгенерированный юнит содержит `Restart=always` и `RestartSec=2`

#### Scenario: Сохранение явных настроек Restart и RestartSec из шаблона
- **WHEN** в файле `systemd-unit.service` явно указаны `Restart=on-failure` и `RestartSec=5`
- **THEN** сгенерированный юнит сохраняет `Restart=on-failure` и `RestartSec=5` без замены на дефолты
