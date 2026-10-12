# Design

## Context

В проектах вроде Telegram-ботов (например, `notproud`) файл `systemd-unit.service` задаёт переменные окружения (`Environment="BOT_TOKEN=..."`), тип службы и описание. Указывать вручную в файле шаблона `WorkingDirectory` и `ExecStart` избыточно и небезопасно: при переименовании точки входа или изменении скрипта `package.json:scripts.start` в unit-файле останутся устаревшие значения.

## Goals / Non-Goals

**Goals:**
- Добавить каноничный эталонный `systemd-unit.service` в корень `pizdeploy`.
- Позволить проектам содержать чистый `systemd-unit.service` без `WorkingDirectory` и `ExecStart`.
- Автоматически инжектировать актуальные `WorkingDirectory` и `ExecStart` в секцию `[Service]`.
- Сохранять все пользовательские директивы (`Environment=`, `Description=`, `Restart=`).
- Устанавливать файл на хосте строго в `~/.config/systemd/user/<service>.service`.

**Non-Goals:**
- Парсинг сложного синтаксиса systemd сторонними тяжелыми библиотеками: модификация INI выполняется простыми и надежными строковыми манипуляциями.

## Decisions

### 1. Эталонный `systemd-unit.service` в корне `pizdeploy`
```ini
[Unit]
Description=app
After=default.target

[Service]
Type=simple
Restart=always
RestartSec=2
Environment="NODE_MODULES=production"

[Install]
WantedBy=default.target
```
Обрати внимание: в нём намеренно нет ни `WorkingDirectory`, ни `ExecStart`!

### 2. Алгоритм функции `renderUnit`
1. **Поиск шаблона**:
   - Читаем `systemd-unit.service` из текущей рабочей директории (проекта).
   - Если его нет — читаем `systemd-unit.service` из корня `pizdeploy`.
2. **Инжекция параметров**:
   - Если в секции `[Unit]` нет `Description=`, добавляем `Description=<name>`.
   - В секции `[Service]` удаляем любые старые строки `WorkingDirectory=...` и `ExecStart=...` (если были).
   - Сразу после заголовка `[Service]` (или внутри секции) внедряем:
     ```ini
     WorkingDirectory=/home/pi/projects/<name>/current
     ExecStart=<execStart>
     ```
   - Если в шаблоне не было `[Install]` секции, гарантируем наличие:
     ```ini
     [Install]
     WantedBy=default.target
     ```
3. **Результат**: полностью валидный unit-файл systemd, сохраняющий пользовательские токены и настройки.

## Risks / Trade-offs

- **[Риск]** Пользователь забыл указать секцию `[Service]` в своём `systemd-unit.service`.
  → *Митигация:* Если секция `[Service]` отсутствует, функция `renderUnit` создаёт её автоматически.
