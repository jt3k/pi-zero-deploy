# Proposal

## Why

Проект `pizdeploy` написан на TypeScript под рантайм Bun, однако в репозитории отсутствуют единые инструменты статического анализа кода и автоматического форматирования (ESLint и Prettier). Вследствие этого стиль кода поддерживается вручную, повышается риск накопления неиспользуемых переменных, неявных типов и некорректных асинхронных вызовов, а также возникают расхождения в форматировании между участниками разработки.

Внедрение современного стека ESLint 9+ (Flat Config) в связке с `typescript-eslint`, `eslint-config-prettier` и Prettier позволит стандартизировать оформление кода, предотвратить типовые ошибки на этапе написания и обеспечить автоматическую проверку качества в CI/CD.

## What Changes

- Добавить devDependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `prettier`, `eslint-config-prettier`.
- Создать файл конфигурации `eslint.config.js` (Flat Config) с правилами для Bun и TypeScript:
  - Использование `@typescript-eslint/consistent-type-imports` для оптимизации импорта типов;
  - Игнорирование неиспользуемых аргументов с префиксом `_` (`@typescript-eslint/no-unused-vars`);
  - Подключение окружений `globals.node` и `globals.es2024` (с поддержкой Bun API);
  - Исключение директорий `node_modules`, `dist`, `build`, `openspec` из проверок.
- Настроить интеграцию Prettier и ESLint через `eslint-config-prettier` в конце массива конфигураций, чтобы исключить конфликтующие правила форматирования.
- Создать конфигурацию `.prettierrc` (единые отступы, кавычки, точка с запятой, перенос строк) и `.prettierignore`.
- Добавить базовый `tsconfig.json` для корректного разрешения типов Bun/TypeScript парсером `typescript-eslint`.
- Добавить скрипты в `package.json`:
  - `lint`: запуск проверки линтером (`eslint .`);
  - `lint:fix`: автоматическое исправление ошибок линтинга (`eslint . --fix`);
  - `format`: форматирование файлов проекта (`prettier --write .`);
  - `format:check`: проверка соответствия форматированию без модификации файлов (`prettier --check .`).

## Capabilities

### New Capabilities

_Нет новых capability._

### Modified Capabilities

_Требования спецификаций поведения утилиты не меняются (`skip_specs: true`). Изменения затрагивают исключительно tooling, конфигурацию статического анализатора и форматирования кода разработчика._

## Impact

- **Файлы конфигурации**: создание `eslint.config.js`, `.prettierrc`, `.prettierignore`, `tsconfig.json`.
- **Зависимости (`package.json`)**: добавление devDependencies (`eslint`, `prettier`, `typescript-eslint`, `@eslint/js`, `globals`, `eslint-config-prettier`) и скриптов `lint`, `lint:fix`, `format`, `format:check`.
- **Кодовая база (`src/`, `test/`)**: потенциальные форматирующие правки после первого прогона `lint:fix` / `format` без изменения логики работы CLI.
- **Внешние интерфейсы и CLI**: никаких изменений в логике выполнения команд `pizdeploy`.
