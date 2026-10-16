import { describe, expect, test } from 'bun:test';
import { buildPsScript } from '../src/index';

describe('buildPsScript', () => {
  test('содержит сопоставление состояний active, activating и failed', () => {
    const script = buildPsScript();
    expect(script).toContain('systemctl --user show "${name}.service" -p ActiveState -p MainPID');
    expect(script).toContain(
      '[[ "$astate" == "active" && "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 0 ]]',
    );
    expect(script).toContain('stat="running"');
    expect(script).toContain('elif [[ "$astate" == "activating" ]]; then');
    expect(script).toContain('stat="restarting"');
    expect(script).toContain('elif [[ "$astate" == "failed" ]]; then');
    expect(script).toContain('stat="failed"');
  });

  test('не пропускает службы в состоянии restarting или failed даже при отсутствии current', () => {
    const script = buildPsScript();
    expect(script).toContain('[[ $has_current -eq 0 && "$stat" == "inactive" ]] && continue');
  });
});

describe('handlePs table formatting', () => {
  test('форматирует таблицу со статусами restarting и failed', () => {
    const logged: unknown[] = [];
    const origTable = console.table;
    console.table = (data: unknown) => logged.push(data);

    try {
      const items = [
        { project: 'p1', release: 'p1_1', status: 'running', port: '8080', pid: '100' },
        { project: 'p2', release: 'p2_1', status: 'restarting', port: null, pid: null },
        { project: 'p3', release: 'p3_1', status: 'failed', port: null, pid: null },
        { project: 'p4', release: 'p4_1', status: 'inactive', port: null, pid: null },
      ];

      const rows = items.map((item) => ({
        Project: item.project,
        Release: item.release,
        Status: item.status,
        URL: item.port ? `http://zero.local:${item.port}` : '-',
        PID: item.pid || '-',
      }));

      console.table(rows);

      expect(logged.length).toBe(1);
      expect(logged[0]).toEqual([
        {
          Project: 'p1',
          Release: 'p1_1',
          Status: 'running',
          URL: 'http://zero.local:8080',
          PID: '100',
        },
        { Project: 'p2', Release: 'p2_1', Status: 'restarting', URL: '-', PID: '-' },
        { Project: 'p3', Release: 'p3_1', Status: 'failed', URL: '-', PID: '-' },
        { Project: 'p4', Release: 'p4_1', Status: 'inactive', URL: '-', PID: '-' },
      ]);
    } finally {
      console.table = origTable;
    }
  });
});
