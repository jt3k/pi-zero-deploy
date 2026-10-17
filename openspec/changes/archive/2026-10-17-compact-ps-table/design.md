# Design

## Context

См. `proposal.md` — мотивация изменения.
В настоящее время удалённый bash-скрипт (`buildPsScript`) возвращает JSON-массив объектов следующей структуры:

```json
[
  { "project": "kmp", "release": "kmp_3ea25", "status": "running", "port": null, "pid": "23232" },
  {
    "project": "my-app",
    "release": "my-app_00f62",
    "status": "inactive",
    "port": null,
    "pid": null
  }
]
```

В модуле `src/ps.ts` функция `handlePs` строит массив объектов для вывода в `console.table(rows)`:

```ts
const rows = data.map((item) => ({
  Project: item.project,
  Release: item.release,
  Status: item.status,
  URL: item.port ? `http://${hostname}:${item.port}` : '-',
  PID: item.pid || '-',
}));
```

Это приводит к избыточной колонке `Project` и дублированию имени проекта в колонке `Release`.

## Goals / Non-Goals

**Goals:**

- Удалить колонку `Project` из таблицы `pizdeploy ps`.
- Реализовать чистую форматирующую функцию для вычисления компактного представления релиза: имя проекта слева с отступом до максимальной длины проекта (`maxProjectLen`), хеш справа.
- Корректно обрабатывать проекты без активного релиза (`release === '-'`): показывать имя проекта слева и дефис `-` справа.
- Сохранить контракт удалённого bash-скрипта без изменений (он уже возвращает структурированный JSON).
- Покрыть логику форматирования тестами.

**Non-Goals:**

- Изменять удаленный bash-скрипт `buildPsScript()` на стороне хоста.
- Менять поведение или формат вывода других подкоманд (`status`, `logs`, `start`, `stop`).

## Decisions

### 1. Выделение чистой функции форматирования строк таблицы `formatPsRows`

В `src/ps.ts` выделяется чистая экспортируемая функция:

```ts
export function formatPsRelease(project: string, release: string, maxProjectLen: number): string {
  // Извлекаем хеш (часть после префикса `${project}_` или последнего `_`)
  let hash = '-';
  if (release && release !== '-') {
    if (release.startsWith(`${project}_`)) {
      hash = release.slice(project.length + 1);
    } else {
      const idx = release.lastIndexOf('_');
      hash = idx !== -1 ? release.slice(idx + 1) : release;
    }
  }

  // Выравнивание: имя проекта дополняется пробелами до maxProjectLen,
  // затем 2 пробела разделителя, затем хеш (или дефис)
  const paddedProject = project.padEnd(maxProjectLen);
  return `${paddedProject}  ${hash}`;
}
```

_Rationale_:

- Логика полностью детерминирована и легко тестируется модульными тестами без поднятия SSH-заглушек.
- Гарантирует аккуратную вертикальную линию начала хешей для всех строк таблицы.

### 2. Структура строк для `console.table`

Таблица формируется из объектов:

```ts
{
  Release: formatPsRelease(item.project, item.release, maxProjectLen),
  Status: item.status,
  URL: item.port ? `http://${hostname}:${item.port}` : '-',
  PID: item.pid || '-',
}
```

_Альтернативы рассмотрены_:

- Оставить колонку `Project` и в `Release` печатать только хеш.
  _Отклонено_: пользователь явно запросил единую колонку `Release` с позиционным выравниванием проекта и хеша для максимальной горизонтальной компактности.

## Risks / Trade-offs

- **[Risk]** Проекты с аномально длинными именами могут увеличить ширину столбца `Release`.
  → **Mitigation**: В объединённом столбце суммарная ширина всё равно меньше, чем сумма ширины отдельных колонок `Project` и `Release` плюс межколоночные разделители таблицы.
- **[Risk]** Проект без релиза (`release === '-'`).
  → **Mitigation**: Имя проекта сохраняется в левой части, а в правой выводится `-`, поэтому проект остаётся идентифицируемым и различимым.
