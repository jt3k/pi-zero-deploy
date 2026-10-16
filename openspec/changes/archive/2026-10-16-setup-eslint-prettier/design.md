# Design

## Context

Проект [`pizdeploy`](file:///Users/jt3k/work/pizdeploy) — это автономная CLI-утилита на TypeScript, исполняемая напрямую рантаймом Bun ([`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts), тесты в [`test/`](file:///Users/jt3k/work/pizdeploy/test)).
В [`package.json`](file:///Users/jt3k/work/pizdeploy/package.json) объявлены `"type": "module"` и единственная dev-зависимость `@types/bun`.
Файлы `tsconfig.json`, `eslint.config.js` и конфигурация Prettier в репозитории отсутствуют.

Подробная мотивация изменений изложена в [`proposal.md`](file:///Users/jt3k/work/pizdeploy/openspec/changes/setup-eslint-prettier/proposal.md).

## Goals / Non-Goals

**Goals:**

- Развернуть ESLint версии >= 9 с использованием нового формата Flat Config (`eslint.config.js`).
- Интегрировать `typescript-eslint` с рекомендованными правилами для TypeScript-проектов на Bun.
- Настроить Prettier с едиными стандартами оформления кода (`.prettierrc`, `.prettierignore`).
- Использовать `eslint-config-prettier` для полного исключения конфликтов между правилами линтинга и форматирования.
- Добавить базовый [`tsconfig.json`](file:///Users/jt3k/work/pizdeploy/tsconfig.json) с поддержкой Bun-типов для корректной работы парсера и IDE.
- Добавить стандартные npm-скрипты: `lint`, `lint:fix`, `format`, `format:check`.
- Проверить чистоту существующего кода (`src/`, `test/`) через запуск линтера и тестов `bun test`.

**Non-Goals:**

- Изменение рантайм-поведения утилиты `pizdeploy` или формата вывода CLI.
- Внедрение альтернативных инструментов (Biome, Oxc) вместо стандартного стека ESLint + Prettier.
- Настройка git hooks (husky, lint-staged) в рамках данного изменения (может быть добавлена отдельным предложением).

## Decisions

### 1. Использование ESLint Flat Config (`eslint.config.js`)

- **Решение**: Настроить Flat Config через утилиту `tseslint.config` из пакета `typescript-eslint`.
- **Обоснование**: Flat Config является основным форматом конфигурации начиная с ESLint 9. Формат `.eslintrc.*` признан устаревшим (deprecated).
- **Альтернативы**: Устаревший `.eslintrc.json` с переменной `ESLINT_USE_FLAT_CONFIG=false` (не рекомендуется для новых настроек).

### 2. Состав правил для Bun / TypeScript

- **Решение**:
  - Базовые пресеты: `js.configs.recommended`, `tseslint.configs.recommended`.
  - Правило `@typescript-eslint/consistent-type-imports`: `'error'` для строгого разделения импортов типов и значений.
  - Правило `@typescript-eslint/no-unused-vars`: `['error', { argsIgnorePattern: '^_' }]` для игнорирования намеренно неиспользуемых параметров функций.
  - Окружение: `globals: { ...globals.node, ...globals.es2024 }`.
  - Секция `ignores`: `['node_modules', 'dist', 'build', 'openspec', '.agents', 'my-app']`.
- **Альтернативы**: Более строгие пресеты `recommendedTypeChecked` — требуют тяжеловесного парсинга с привязкой к проекту через `projectService`, что замедляет линтинг на CLI-скриптах; рекомендованный легкий пресет обеспечивает идеальный баланс скорости и надежности.

### 3. Гармония ESLint и Prettier (`eslint-config-prettier`)

- **Решение**: Подключить `eslint-config-prettier` в самый конец массива конфигураций в `eslint.config.js`.
- **Обоснование**: Следование принципу «ESLint отвечает за логику и синтаксис, Prettier — за визуальное форматирование». `eslint-config-prettier` отключает любые правила ESLint, способные конфликтовать с Prettier.

### 4. Конфигурация Prettier

- **Решение**: Создать `.prettierrc` со следующими параметрами:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth: 100,
    "tabWidth": 2
  }
  ```
  И `.prettierignore` для исключения `node_modules`, `dist`, `bun.lock`, `openspec/changes/archive`.

### 5. Создание `tsconfig.json`

- **Решение**: Создать файл [`tsconfig.json`](file:///Users/jt3k/work/pizdeploy/tsconfig.json):
  ```json
  {
    "compilerOptions": {
      "lib": ["ESNext"],
      "module": "ESNext",
      "target": "ESNext",
      "moduleResolution": "bundler",
      "types": ["bun"],
      "strict": true,
      "skipLibCheck": true,
      "noEmit": true
    },
    "include": ["src/**/*.ts", "test/**/*.ts"]
  }
  ```
- **Обоснование**: Гарантирует корректное распознавание типов `Bun` в `typescript-eslint` и редакторах кода без необходимости ручной транспиляции.

## Risks / Trade-offs

- **[Risk]** Первый прогон автоформатирования `prettier --write` затронет большое количество строк в [`src/index.ts`](file:///Users/jt3k/work/pizdeploy/src/index.ts) и [`test/`](file:///Users/jt3k/work/pizdeploy/test).
  - _Mitigation_: Выполнить форматирование отдельным шагом, проверить diff через `git diff`, запустить существующий набор тестов `bun test` для подтверждения целостности логики.
- **[Risk]** Конфликт версий пакетов в Bun при установке зависимостей.
  - _Mitigation_: Использовать стандартные стабильные версии: `eslint` ^9.x, `typescript-eslint` ^8.x, `prettier` ^3.x, `eslint-config-prettier` ^9.x.

## Migration Plan

1. Установка dev-зависимостей:
   `bun add -d eslint @eslint/js typescript-eslint globals prettier eslint-config-prettier`
2. Создание файлов конфигурации: [`tsconfig.json`](file:///Users/jt3k/work/pizdeploy/tsconfig.json), [`eslint.config.js`](file:///Users/jt3k/work/pizdeploy/eslint.config.js), [`.prettierrc`](file:///Users/jt3k/work/pizdeploy/.prettierrc), [`.prettierignore`](file:///Users/jt3k/work/pizdeploy/.prettierignore).
3. Добавление скриптов в [`package.json`](file:///Users/jt3k/work/pizdeploy/package.json).
4. Запуск `bun run format` и `bun run lint:fix`.
5. Валидация через `bun run lint`, `bun run format:check` и `bun test`.
