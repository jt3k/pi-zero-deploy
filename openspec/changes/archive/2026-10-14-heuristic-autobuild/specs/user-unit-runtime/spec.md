# Spec Delta

## MODIFIED Requirements

### Requirement: Единственный каноничный способ запуска приложения

Система SHALL требовать наличия команды запуска в поле `scripts.start` файла `package.json` проекта. Система SHALL прерывать деплой с ошибкой, если скрипт `start` отсутствует или пуст. При наличии пользовательского `scripts.build` система SHALL адаптировать путь из `scripts.start`, удаляя префикс `dist/`. При срабатывании автоматического билда (когда `scripts.build` отсутствует) команда запуска в `ExecStart` SHALL автоматически указывать на сгенерированный ESM-бандл `/usr/bin/node <имя>.mjs` с сохранением дополнительных параметров Node.js, если они были указаны в `scripts.start`.

#### Scenario: Артефакт сборки назван произвольно при наличии build
- **WHEN** в `package.json` задан `scripts.build` и он создаёт артефакт
- **AND** скрипт `start` в `package.json` проекта запускает его
- **THEN** служба запускается успешно без каких-либо настроек имени файла в утилите

#### Scenario: Адаптация ExecStart при автобилде
- **WHEN** скрипт `build` в `package.json` отсутствует
- **AND** в `scripts.start` указано `node ./src/app.js`
- **THEN** автобилд создаёт `./dist/app.mjs`
- **AND** сгенерированный юнит содержит `ExecStart=/usr/bin/node app.mjs`

#### Scenario: Сохранение флагов Node.js при автобилде
- **WHEN** скрипт `build` отсутствует
- **AND** в `scripts.start` указано `node --expose-gc ./server.js`
- **THEN** автобилд создаёт `./dist/server.mjs`
- **AND** сгенерированный юнит содержит `ExecStart=/usr/bin/node --expose-gc server.mjs`

#### Scenario: В релизе нет скрипта start
- **WHEN** в `package.json` проекта отсутствует скрипт `start`
- **THEN** деплой завершается с ненулевым кодом возврата и понятным сообщением об ошибке еще до сборки и передачи файлов на хост

#### Scenario: Скрипт start пустой
- **WHEN** в `package.json` поле `scripts.start` является пустой строкой или строкой из пробелов
- **THEN** деплой прерывается с ошибкой до выполнения сборки и сетевых вызовов

#### Scenario: Скрипт start задан корректно
- **WHEN** в `package.json` присутствует непустой скрипт `scripts.start` (например, `node index.js`)
- **THEN** деплой продолжается и команда используется в `ExecStart` службы

#### Scenario: Скрипт start отсутствует в package.json
- **WHEN** в `package.json` отсутствует поле `scripts.start` или секция `scripts`
- **THEN** деплой немедленно прерывается с ненулевым кодом ошибки
- **AND** в stderr выводится понятное сообщение о непригодности проекта для деплоя
- **AND** передача файлов на хост не выполняется
