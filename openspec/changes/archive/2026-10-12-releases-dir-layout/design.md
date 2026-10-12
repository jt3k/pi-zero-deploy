# Design

## Context

В текущей версии `pizdeploy` директория `incoming/` использовалась для хранения самих релизов:
```typescript
const newDir = `${REMOTE_PROJECT_DIR}/incoming/${relId}`;
```
Архив копировался напрямую в `incoming/<relId>`, там же распаковывался, а симлинк `current` указывал на `incoming/<relId>`.

Это не соответствует стандартному паттерну безопасного деплоя, в котором `incoming/` является временным буфером передачи (staging), а постоянным хранилищем служит `releases/`.

## Goals / Non-Goals

**Goals:**
- Использовать `~/projects/<name>/incoming/` только для временного приёма архива `dist.tar.gz` и файла юнита.
- Создавать релизы в `~/projects/<name>/releases/<relId>/`.
- Распаковывать архив из `incoming/` в `releases/<relId>/` и удалять временный архив сразу после успешной распаковки.
- Переключать симлинк `current` на `~/projects/<name>/releases/<relId>`.
- Ротировать версии внутри каталога `releases/` (сохраняя 3 последних релиза).
- Обновить вывод `--dry-run` и тесты.

**Non-Goals:**
- Изменение алгоритма хэширования или сборки проекта.
- Изменение синтаксиса CLI или логики управления службами (`ps`, `stop`, `disable`).

## Decisions

### 1. Разделение staging и storage путей
- **`INCOMING_DIR`**: `${REMOTE_PROJECT_DIR}/incoming`
- **`RELEASE_DIR`**: `${REMOTE_PROJECT_DIR}/releases/${relId}`
- Загрузка `scp` выполняется в `${INCOMING_DIR}/dist.tar.gz`.
- Распаковка:
  ```sh
  mkdir -p ${RELEASE_DIR} && tar -xzf ${INCOMING_DIR}/dist.tar.gz -C ${RELEASE_DIR} && rm -f ${INCOMING_DIR}/dist.tar.gz
  ```
- Копирование юнита (если предоставлен):
  Юнит загружается в `${INCOMING_DIR}/${service}`, при необходимости сравнивается и копируется в `/etc/systemd/system/${service}`, после чего удаляется из `incoming/`.

### 2. Атомарное переключение симлинка
- Создаётся временный симлинк:
  ```sh
  ln -sfn ${RELEASE_DIR} ${REMOTE_PROJECT_DIR}/current_tmp && mv -fT ${REMOTE_PROJECT_DIR}/current_tmp ${currentLink}
  ```

### 3. Ротация версий
- Очистка выполняется в директории `releases`:
  ```sh
  cd ${REMOTE_PROJECT_DIR}/releases && ls -1d * 2>/dev/null | sort | head -n -3 | xargs rm -rf 2>/dev/null || true
  ```

## Risks / Trade-offs

- **[Риск]** Существующие проекты на хосте могут иметь старые релизы в `incoming/`.  
  → **Смягчение:** При создании новой версии директория `releases/` создаётся автоматически (`mkdir -p`), а симлинк `current` бесшовно переключается на новый релиз в `releases/`. Предыдущий симлинк атомарно перезаписывается.
