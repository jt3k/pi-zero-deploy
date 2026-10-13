# Design

## Context

См. proposal.md — Why. Текущий код в `buildPsScript()`:
```bash
read -r astate main_pid < <(systemctl --user show "${name}.service" --property=ActiveState,MainPID --value 2>/dev/null | tr "\n" " ")
```
Вывод `systemctl --user show "${name}.service" --property=ActiveState,MainPID --value` на Raspberry Pi Zero возвращает:
```
16684
active
```
То есть первым идет `MainPID`, вторым `ActiveState`. В результате `read -r astate main_pid` присваивает `astate="16684"`, `main_pid="active"`.

## Goals / Non-Goals

**Goals:**
- Надёжный парсинг свойств `ActiveState` и `MainPID`, не зависящий от порядка их вывода `systemctl`.
- Корректное определение статуса `running` и PID для всех запущенных служб.

**Non-Goals:**
- Изменение структуры вывода таблицы или добавление новых колонок.

## Decisions

### Парсинг без флага `--value` по префиксам `ActiveState=` и `MainPID=`

Запрашиваем свойства `systemctl --user show "${name}.service" -p ActiveState -p MainPID 2>/dev/null`:
Вывод:
```
MainPID=16684
ActiveState=active
```
В цикле `while IFS='=' read -r k v; do ... done`:
```bash
astate=""
main_pid="0"
while IFS='=' read -r k v; do
  [[ "$k" == "ActiveState" ]] && astate="$v"
  [[ "$k" == "MainPID" ]] && main_pid="$v"
done < <(systemctl --user show "${name}.service" -p ActiveState -p MainPID 2>/dev/null)
```
Это полностью устойчиво к любому порядку строк.

## Risks / Trade-offs

- **[Risk]** Если юнит не существует, `systemctl` выведет `ActiveState=inactive` и `MainPID=0`. → **Mitigation**: условие `[[ "$astate" == "active" && "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 0 ]]` не сработает, сервис останется `inactive`.
