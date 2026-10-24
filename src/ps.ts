import { closeControlMaster, remoteExec, socketPathFor, sshOptions } from './ssh';

export function buildPsScript(): string {
  return `bash -c '
declare -A ports
while read -r _ _ _ addr _ proc; do
  port="\${addr##*:}"
  [[ "$proc" =~ pid=([0-9]+) ]] && ports["\${BASH_REMATCH[1]}"]="$port"
done < <(ss -tlpn 2>/dev/null)

projects_dir="\${HOME}/projects"
first=1
printf "["
for p in "$projects_dir"/*; do
  [[ -d "$p" ]] || continue
  name="\${p##*/}"
  has_current=0
  rel="-"
  if [[ -L "$p/current" ]]; then
    has_current=1
    rel=$(basename "$(readlink -f "$p/current" 2>/dev/null)")
  fi
  m_pid="null"
  m_port="null"
  stat="inactive"
  for pid in "\${!ports[@]}"; do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
    if [[ "$cwd" == "$p" || "$cwd" == "$p/"* ]]; then
      m_pid="$pid"
      m_port="\${ports[$pid]}"
      stat="running"
      break
    fi
  done
  load_state=""
  if [[ "$stat" == "inactive" ]]; then
    astate=""
    main_pid="0"
    while IFS="=" read -r k v; do
      [[ "$k" == "ActiveState" ]] && astate="$v"
      [[ "$k" == "MainPID" ]] && main_pid="$v"
      [[ "$k" == "LoadState" ]] && load_state="$v"
    done < <(systemctl --user show "\${name}.service" -p ActiveState -p MainPID -p LoadState 2>/dev/null)
    if [[ "$load_state" != "not-found" ]]; then
      if [[ "$astate" == "active" && "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 0 ]]; then
        stat="running"
        m_pid="$main_pid"
      elif [[ "$astate" == "activating" ]]; then
        stat="restarting"
      elif [[ "$astate" == "failed" ]]; then
        stat="failed"
      fi
    fi
  fi
  [[ $has_current -eq 0 && ( "$stat" == "inactive" || "$load_state" == "not-found" ) ]] && continue
  [[ $first -eq 0 ]] && printf ","
  first=0
  printf "{\\"project\\":\\"%s\\",\\"release\\":\\"%s\\",\\"status\\":\\"%s\\",\\"port\\":%s,\\"pid\\":%s}" \
    "$name" "$rel" "$stat" "$m_port" "$m_pid"
done
printf "]\\n"
'`;
}

export function formatPsRelease(
  project: string,
  release: string,
  maxProjectLen: number = project.length,
): string {
  let hash = '-';
  if (release && release !== '-') {
    if (release.startsWith(`${project}_`)) {
      hash = release.slice(project.length + 1);
    } else {
      const idx = release.lastIndexOf('_');
      hash = idx !== -1 ? release.slice(idx + 1) : release;
    }
  }

  const effectiveMax = Math.max(maxProjectLen, project.length);
  const paddedProject = project.padEnd(effectiveMax + 1);
  return `${paddedProject}${hash}`;
}

export async function handlePs(host: string): Promise<number> {
  const socketPath = socketPathFor(host);
  const sshOpts = sshOptions(host, socketPath);
  const remoteBashScript = buildPsScript();

  try {
    const res = await remoteExec(sshOpts, host, remoteBashScript);
    if (res.exitCode !== 0) {
      console.error(res.stderr.trim() || 'Ошибка при получении статуса сервисов');
      return res.exitCode || 1;
    }
    const rawText = res.stdout.trim();
    let data: Array<{
      project: string;
      release: string;
      status: string;
      port: string | null;
      pid: string | null;
    }> = [];

    try {
      data = JSON.parse(rawText || '[]');
    } catch {
      // При получении не-JSON ответа (например, в тестовых заглушках)
      data = [];
    }

    const hostname = host.replace(/^.*@/, '');
    const maxProjectLen = data.reduce((max, item) => Math.max(max, item.project?.length || 0), 0);
    const rows = data.map((item) => ({
      Release: formatPsRelease(item.project, item.release, maxProjectLen),
      Status: item.status,
      URL: item.port ? `http://${hostname}:${item.port}` : '-',
      PID: item.pid || '-',
    }));

    console.table(rows);
    return 0;
  } finally {
    await closeControlMaster(host, socketPath);
  }
}
