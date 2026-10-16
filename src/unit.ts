import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Каноничный шаблон user-юнита: чтение systemd-unit.service из текущего проекта
 * или эталонного шаблона pizdeploy, с автоинжекцией WorkingDirectory и ExecStart.
 */
export function renderUnit(
  name: string,
  execStart: string,
  port?: number,
  customTemplatePath?: string,
): string {
  let templateContent: string;
  const projectTemplate = customTemplatePath || resolve(process.cwd(), 'systemd-unit.service');
  const fallbackTemplate = resolve(import.meta.dir, '..', 'systemd-unit.service');

  if (existsSync(projectTemplate)) {
    templateContent = readFileSync(projectTemplate, 'utf8');
  } else if (existsSync(fallbackTemplate)) {
    templateContent = readFileSync(fallbackTemplate, 'utf8');
  } else {
    // Резервный встроенный шаблон на случай сборки в бинарник без внешних файлов
    templateContent = [
      '[Unit]',
      `Description=${name}`,
      'After=default.target',
      '',
      '[Service]',
      'Type=simple',
      'Restart=always',
      'RestartSec=2',
      'Environment="NODE_ENV=production"',
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n');
  }

  // Разбор на секции INI
  const sections: { name: string; lines: string[] }[] = [];
  let currentSection: { name: string; lines: string[] } | null = null;

  for (const rawLine of templateContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = { name: trimmed, lines: [] };
      sections.push(currentSection);
    } else if (currentSection && trimmed.length > 0) {
      currentSection.lines.push(trimmed);
    }
  }

  // 1. Секция [Unit]
  let unitSec = sections.find((s) => s.name.toLowerCase() === '[unit]');
  if (!unitSec) {
    unitSec = { name: '[Unit]', lines: [`Description=${name}`, 'After=default.target'] };
    sections.unshift(unitSec);
  } else {
    const descIdx = unitSec.lines.findIndex((l) => l.trim().startsWith('Description='));
    if (descIdx === -1) {
      unitSec.lines.unshift(`Description=${name}`);
    } else if (unitSec.lines[descIdx].trim() === 'Description=app' && name !== 'app') {
      unitSec.lines[descIdx] = `Description=${name}`;
    }
  }

  // 2. Секция [Service]
  let serviceSec = sections.find((s) => s.name.toLowerCase() === '[service]');
  if (!serviceSec) {
    serviceSec = {
      name: '[Service]',
      lines: ['Type=simple', 'Restart=always', 'RestartSec=2', 'Environment="NODE_ENV=production"'],
    };
    sections.push(serviceSec);
  }

  // Фильтруем любые старые WorkingDirectory= и ExecStart=
  serviceSec.lines = serviceSec.lines.filter((l) => {
    const t = l.trim();
    return !t.startsWith('WorkingDirectory=') && !t.startsWith('ExecStart=');
  });

  // Внедряем актуальные WorkingDirectory и ExecStart
  const injected = [`WorkingDirectory=%h/projects/${name}/current`, `ExecStart=${execStart}`];
  if (port) {
    const hasPortEnv = serviceSec.lines.some((l) => l.includes(`PORT=`));
    if (!hasPortEnv) {
      injected.push(`Environment="PORT=${port}"`);
    }
  }

  // Внедряем дефолтные Restart и RestartSec, если они не заданы явно
  if (!serviceSec.lines.some((l) => l.trim().startsWith('Restart='))) {
    injected.push('Restart=always');
  }
  if (!serviceSec.lines.some((l) => l.trim().startsWith('RestartSec='))) {
    injected.push('RestartSec=2');
  }

  serviceSec.lines.unshift(...injected);

  // 3. Секция [Install]
  let installSec = sections.find((s) => s.name.toLowerCase() === '[install]');
  if (!installSec) {
    installSec = { name: '[Install]', lines: ['WantedBy=default.target'] };
    sections.push(installSec);
  } else {
    const hasWantedBy = installSec.lines.some((l) => l.trim().startsWith('WantedBy='));
    if (!hasWantedBy) {
      installSec.lines.push('WantedBy=default.target');
    }
  }

  // Сборка итогового файла
  const resultLines: string[] = [];
  for (const sec of sections) {
    resultLines.push(sec.name);
    for (const line of sec.lines) {
      resultLines.push(line);
    }
    resultLines.push('');
  }

  return resultLines.join('\n').replace(/\n+$/, '\n');
}

export async function handleInit(cwd: string = process.cwd()): Promise<number> {
  const pkgPath = resolve(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error('pizdeploy: в текущем каталоге не найден package.json.');
    console.error(
      'Команда init предназначена для проектов с package.json, откуда берутся имя сервиса, скрипт запуска (scripts.start) и параметры хоста.',
    );
    return 1;
  }

  const targetFile = resolve(cwd, 'systemd-unit.service');
  if (existsSync(targetFile)) {
    console.log(
      'ℹ️ Файл systemd-unit.service уже существует в текущем каталоге. Пропускаем создание.',
    );
    return 0;
  }

  let pkgName = 'app';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
      pkgName = pkg.name.trim();
    }
  } catch {
    // Используем "app" при ошибке парсинга
  }

  const content = [
    '[Unit]',
    `Description=${pkgName}`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    'Restart=always',
    'RestartSec=2',
    'Environment="NODE_ENV=production"',
    '# Добавьте переменные окружения и секреты:',
    '# Environment="BOT_TOKEN=..."',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');

  writeFileSync(targetFile, content, 'utf8');
  console.log(`✨ Создан шаблон systemd-unit.service для "${pkgName}".`);
  console.log(
    '💡 WorkingDirectory и ExecStart указывать не нужно — pizdeploy настроит их автоматически при деплое.',
  );
  return 0;
}
