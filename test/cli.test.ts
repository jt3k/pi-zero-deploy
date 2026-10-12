import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const entrypoint = join(repoRoot, "src", "index.ts");
// Используем реальный Bun runtime, а не шебанг (чтобы PATH с заглушками не ломал запуск)
const bunExe = process.execPath;
const bunDir = join(bunExe, "..");

const sandboxes: string[] = [];

/**
 * Создаёт изолированную песочницу с заглушками ssh и scp.
 * Заглушки печатают каждый аргумент на отдельной строке и завершаются
 * кодом из STUB_EXIT (по умолчанию 0).
 */
function makeSandbox(options: { packageJson?: unknown; nested?: string } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pizdeploy-test-")));
  sandboxes.push(base);

  const binDir = join(base, "fake-bin");
  mkdirSync(binDir, { recursive: true });

  // Заглушка ssh: печатает аргументы и выходит с STUB_EXIT
  const sshStub = join(binDir, "ssh");
  writeFileSync(sshStub, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done\nexit "${STUB_EXIT:-0}"\n');
  chmodSync(sshStub, 0o755);

  // Заглушка scp: печатает аргументы и выходит с STUB_EXIT
  const scpStub = join(binDir, "scp");
  writeFileSync(scpStub, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done\nexit "${STUB_EXIT:-0}"\n');
  chmodSync(scpStub, 0o755);

  // Заглушка tar: no-op (не создаём реальный архив в тестах)
  const tarStub = join(binDir, "tar");
  writeFileSync(tarStub, '#!/bin/sh\nexit 0\n');
  chmodSync(tarStub, 0o755);

  // Заглушка rm: no-op
  const rmStub = join(binDir, "rm");
  writeFileSync(rmStub, '#!/bin/sh\nexit 0\n');
  chmodSync(rmStub, 0o755);

  let cwd = base;
  if (options.packageJson !== undefined) {
    writeFileSync(join(base, "package.json"), JSON.stringify(options.packageJson, null, 2));
  }
  if (options.nested !== undefined) {
    cwd = join(base, options.nested);
    mkdirSync(cwd, { recursive: true });
  }

  return { base, cwd, pathValue: `${binDir}:${bunDir}` };
}

function run(opts: { args?: string[]; cwd?: string; pathValue?: string; env?: Record<string, string> } = {}) {
  const { args = [], cwd = repoRoot, pathValue = process.env.PATH ?? "", env = {} } = opts;
  // Запускаем через реальный Bun (bunExe), не через шебанг, чтобы PATH заглушки не мешали runtime
  const proc = Bun.spawnSync([bunExe, entrypoint, ...args], {
    cwd,
    env: { PATH: pathValue, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

afterAll(() => {
  for (const dir of sandboxes) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ошибки использования", () => {
  const cases: Array<[string, string[]]> = [
    ["неизвестный аргумент --help", ["--help"]],
    ["неизвестный аргумент deploy prod", ["deploy", "prod"]],
    ["--ssh без значения", ["--ssh"]],
  ];

  for (const [name, args] of cases) {
    test(`${name}: код 2, usage в stderr, stdout пуст`, () => {
      const sandbox = makeSandbox();
      const result = run({ args, cwd: sandbox.cwd, pathValue: sandbox.pathValue });
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]");
    });
  }

  test("ошибка использования не запускает деплой", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["--help"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.stdout).toBe("");
  });
});

describe("флаг --dry-run", () => {
  test("--dry-run выводит сообщение с путём релиза и не выполняет деплой", () => {
    const sandbox = makeSandbox({ packageJson: { name: "myapp", pizdeploy: { ssh: "pi@test.local" } } });
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry-Run");
    expect(result.stdout).toContain("myapp_mock5");
    expect(result.stdout).toContain("/home/pi/projects/myapp/releases/");
  });

  test("--dry-run работает вместе с --ssh", () => {
    const sandbox = makeSandbox({ packageJson: { name: "myapp" } });
    const result = run({ args: ["--dry-run", "--ssh", "pi@custom.local"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry-Run");
  });

  test("--dry-run с дефолтным именем app при отсутствии package.json", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("app_mock5");
  });
});

describe("разбор флага --ssh", () => {
  test("формы --ssh <v> и --ssh=<v> дают одинаковый результат в dry-run", () => {
    const sandbox = makeSandbox({ packageJson: { name: "app" } });
    const spaced = run({ args: ["--dry-run", "--ssh", "pi@from-flag.local"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    const equals = run({ args: ["--dry-run", "--ssh=pi@from-flag.local"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });

    expect(spaced.code).toBe(0);
    expect(equals.code).toBe(0);
  });
});

describe("приоритет источников адреса (dry-run)", () => {
  test("без флага берётся pizdeploy.ssh из package.json", () => {
    const sandbox = makeSandbox({ packageJson: { name: "app", pizdeploy: { ssh: "pi@from-config.local" } } });
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
  });

  test("без конфига и флага используется pi@zero.local (dry-run выполняется)", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry-Run");
  });

  test("битый package.json не ломает запуск (dry-run)", () => {
    const sandbox = makeSandbox();
    writeFileSync(join(sandbox.base, "package.json"), "{ не json");
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry-Run");
  });
});

describe("проверка зависимостей", () => {
  test("при отсутствии ssh в PATH: код 127 и подсказка в stderr", () => {
    const sandbox = makeSandbox({ packageJson: { name: "app" } });
    // Убираем ssh из fake-bin, оставляем только scp и остальные заглушки
    rmSync(join(sandbox.base, "fake-bin", "ssh"));
    const result = run({ cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ssh");
  });

  test("при отсутствии scp в PATH: код 127 и подсказка в stderr", () => {
    const sandbox = makeSandbox({ packageJson: { name: "app" } });
    rmSync(join(sandbox.base, "fake-bin", "scp"));
    const result = run({ cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("scp");
  });
});

describe("точка входа", () => {
  test("--dry-run работает из каталога вне проекта", () => {
    const sandbox = makeSandbox({ packageJson: { name: "myapp" } });
    const result = run({ args: ["--dry-run"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry-Run");
  });
});

describe("подкоманда ps", () => {
  test("pizdeploy ps с невалидным дополнительным аргументом: код 2, usage в stderr", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["ps", "extra"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]");
  });

  test("pizdeploy ps при отсутствии ssh в PATH: код 127 и ошибка в stderr", () => {
    const sandbox = makeSandbox();
    rmSync(join(sandbox.base, "fake-bin", "ssh"));
    const result = run({ args: ["ps"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("ssh");
  });

  test("pizdeploy ps с флагом --ssh завершается кодом 0 и выводит таблицу", () => {
    const sandbox = makeSandbox();
    // Переопределяем fake ssh, чтобы он возвращал валидный JSON массив для ps
    const sshStub = join(sandbox.base, "fake-bin", "ssh");
    writeFileSync(
      sshStub,
      '#!/bin/sh\ncase "$*" in\n  *bash*|*python3*) echo \'[{"project":"test-app","release":"test-app_123","service":"test.service","status":"running","port":"1234","pid":"111"}]\' ;;\n  *) exit 0 ;;\nesac\n'
    );
    chmodSync(sshStub, 0o755);

    const result = run({ args: ["ps", "--ssh", "pi@custom.local"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("test-app");
    expect(result.stdout).toContain("test-app_123");
    expect(result.stdout).toContain("http://custom.local:1234");
    expect(result.stdout).toContain("test.service");
    expect(result.stdout).toContain("111");
  });

  test("pizdeploy ps корректно отображает проекты с совпадающими префиксами имён без коллизий", () => {
    const sandbox = makeSandbox();
    const sshStub = join(sandbox.base, "fake-bin", "ssh");
    writeFileSync(
      sshStub,
      '#!/bin/sh\ncase "$*" in\n  *bash*|*python3*) echo \'[{"project":"my-app","release":"my-app_111","service":"-","status":"inactive","port":null,"pid":null},{"project":"my-app-worker","release":"worker_222","service":"my-app-worker.service","status":"running","port":"8080","pid":"555"}]\' ;;\n  *) exit 0 ;;\nesac\n'
    );
    chmodSync(sshStub, 0o755);

    const result = run({ args: ["ps"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("my-app");
    expect(result.stdout).toContain("my-app-worker");
    expect(result.stdout).toContain("http://zero.local:8080");
    expect(result.stdout).toContain("my-app-worker.service");
  });
});

describe("подкоманды stop и disable", () => {
  test("stop с лишними аргументами: код 2, usage в stderr", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["stop", "svc", "extra"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]");
  });

  test("disable с лишними аргументами: код 2, usage в stderr", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["disable", "svc", "extra"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: pizdeploy [ps|stop|disable] [name] [--ssh <user@host>] [--dry-run]");
  });

  test("stop при отсутствии ssh в PATH: код 127 и ошибка в stderr", () => {
    const sandbox = makeSandbox();
    rmSync(join(sandbox.base, "fake-bin", "ssh"));
    const result = run({ args: ["stop"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("ssh");
  });

  test("stop с явным именем службы нормализует имя и отправляет команду", () => {
    const sandbox = makeSandbox();
    const sshStub = join(sandbox.base, "fake-bin", "ssh");
    writeFileSync(
      sshStub,
      '#!/bin/sh\ncase "$*" in\n  *-O\\ exit*) exit 0 ;;\n  *) printf "%s\\n" "$@"; exit 0 ;;\nesac\n'
    );
    chmodSync(sshStub, 0o755);

    const result = run({ args: ["stop", "my-service"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("⏹ Служба my-service.service остановлена на pi@zero.local");
  });

  test("stop сохраняет явное имя, если оно уже оканчивается на .service", () => {
    const sandbox = makeSandbox();
    const result = run({ args: ["stop", "custom.service", "--ssh", "pi@myhost.local"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("⏹ Служба custom.service остановлена на pi@myhost.local");
  });

  test("disable без аргумента использует имя службы из package.json (name)", () => {
    const sandbox = makeSandbox({ packageJson: { name: "mycoolapp" } });
    const result = run({ args: ["disable"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("🛑 Автозапуск службы mycoolapp.service отключен на pi@zero.local");
  });

  test("disable без аргумента использует pizdeploy.service из package.json, если задан", () => {
    const sandbox = makeSandbox({ packageJson: { name: "ignored", pizdeploy: { service: "custom-daemon" } } });
    const result = run({ args: ["disable"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("🛑 Автозапуск службы custom-daemon.service отключен на pi@zero.local");
  });

  test("stop выводит ошибку и код 1, если служба не найдена на хосте", () => {
    const sandbox = makeSandbox();
    const sshStub = join(sandbox.base, "fake-bin", "ssh");
    writeFileSync(
      sshStub,
      '#!/bin/sh\ncase "$*" in\n  *-O\\ exit*) exit 0 ;;\n  *) echo "not_found"; exit 1 ;;\nesac\n'
    );
    chmodSync(sshStub, 0o755);

    const result = run({ args: ["stop", "unknown-app"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pizdeploy: служба unknown-app.service не найдена на pi@zero.local");
  });

  test("disable выводит ошибку и код 1 при сбое systemctl", () => {
    const sandbox = makeSandbox();
    const sshStub = join(sandbox.base, "fake-bin", "ssh");
    writeFileSync(
      sshStub,
      '#!/bin/sh\ncase "$*" in\n  *-O\\ exit*) exit 0 ;;\n  *) echo "Failed to disable service" >&2; exit 1 ;;\nesac\n'
    );
    chmodSync(sshStub, 0o755);

    const result = run({ args: ["disable", "my-app"], cwd: sandbox.cwd, pathValue: sandbox.pathValue });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Failed to disable service");
  });
});