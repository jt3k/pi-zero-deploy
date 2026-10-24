# pizdeploy

[![CI](https://github.com/jt3k/pi-zero-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/jt3k/pi-zero-deploy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jt3k/pi-zero-deploy?color=blue&logo=github)](https://github.com/jt3k/pi-zero-deploy/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-black?logo=bun)](https://bun.sh)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Raspberry%20Pi-E43E56?logo=raspberrypi)](https://www.raspberrypi.com/)

> **One-command deploys for your Raspberry Pi.** Build on your laptop, ship atomically,
> health-check, auto-rollback if it breaks. No Docker, no sudo, no SSH `npm install`.
> Developed against a 512 MB Pi Zero — works on **any Linux with systemd**
> (Debian, Ubuntu, Arch, Orange Pi, a $1 VPS, an old netbook).

![demo](demo.gif)

---

## Quickstart (60 seconds)

```bash
# 1. Install (pick one)
bun add -g github:jt3k/pi-zero-deploy
# or, once published: npm install -g pizdeploy

# 2. (Optional) Scaffold systemd unit template for custom env & restart policies
cd my-app
pizdeploy init

# 3. Deploy
pizdeploy --ssh pi@raspberrypi.local
# or set "pizdeploy": { "ssh": "pi@raspberrypi.local" } in package.json and just run:
pizdeploy
```

`pizdeploy` builds locally on your Mac/PC, uploads the artifact, atomically switches the
`current` symlink, reloads & starts `systemd --user`, verifies port & liveness, and automatically rolls back if the service fails.

---

## Why pizdeploy?

| Criterion              | pizdeploy                                                   | Docker                            | PM2                                     |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| Background agent       | **none** (0 MB overhead)                                    | yes (`dockerd`, 100–250+ MB)      | yes (PM2 daemon, 40–80 MB)              |
| Build on host          | **no** (build on Mac/PC)                                    | yes or via Hub                    | yes (heavy `npm i`)                     |
| Needs root / sudo      | **no** (`systemd --user`)                                   | yes (or `docker` group)           | no                                      |
| Atomic release         | **yes** (symlink switch)                                    | yes (container)                   | no (in-place code)                      |
| Auto-rollback on crash | **yes** (active + port probe)                               | via orchestrator                  | no (crash loop)                         |
| Host dependencies      | Linux + `systemd`                                           | Docker daemon                     | Node.js + npm                           |
| Honest trade-offs      | Linux + systemd only, single host, no built-in secret vault | High overhead, slow builds on ARM | No auto-rollback, `npm i` leaks on host |

**In one line:** Docker is too heavy for 512 MB, PM2 needs `npm install` on the device
and can't roll back, so `pizdeploy` builds on your laptop, ships atomically, and
uses native `systemd --user` — no sudo, no daemon, no surprises.

---

## Configuration

Configure options directly in your `package.json`:

```json
{
  "name": "my-app",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "pizdeploy": {
    "ssh": "pi@zero.local",
    "service": "my-app.service",
    "port": 3000
  }
}
```

- **`scripts.start`** _(required)_: Command executed on the target host. Path prefixes like `dist/` are automatically adapted for the release directory.
- **`scripts.build`** _(optional)_: Local build command. If omitted, `pizdeploy` automatically bundles your `scripts.start` entrypoint via `bun build --minify`.
- **`pizdeploy.ssh`** _(optional)_: Target host address for any Raspberry Pi or Linux VPS (override via `--ssh user@host`, default: `pi@zero.local`).
- **`pizdeploy.port`** _(optional)_: Port to verify via `ss -tln`. If omitted (e.g. bots or workers), liveness is verified by monitoring service stability and `NRestarts`.
- **`pizdeploy.service`** _(optional)_: Systemd unit name (defaults to `<name>.service`).

---

## Commands

| Command                       | What it does                                                               |
| ----------------------------- | -------------------------------------------------------------------------- |
| `pizdeploy`                   | Build, deliver, atomically switch, and verify deployment                   |
| `pizdeploy --ssh user@host`   | One-shot deploy to a remote host over SSH                                  |
| `pizdeploy --dry-run`         | Preview steps without building or network calls                            |
| `pizdeploy init`              | Scaffold `systemd-unit.service` template in the project                    |
| `pizdeploy ps`                | Inspect deployed projects, active releases, URLs, and statuses             |
| `pizdeploy logs [name]`       | Tail the last 50 log lines via `journalctl --user`                         |
| `pizdeploy start [name]`      | Start the user systemd service                                             |
| `pizdeploy stop [name]`       | Stop the user systemd service                                              |
| `pizdeploy restart [name]`    | Restart the user systemd service                                           |
| `pizdeploy status [name]`     | Show detailed `systemctl --user status`                                    |
| `pizdeploy remove\|rm [name]` | ⚠️ **Destructive:** Stop, disable, remove systemd unit and current release |

---

## Security notes

- **Zero-Privilege**: Runs entirely under user mode via `systemctl --user`. Never calls `sudo` and never touches `/etc/systemd/system`.
- **Environment & Secrets**: Store secrets in local `systemd-unit.service` (`Environment="KEY=..."`) or target host `EnvironmentFile=%h/.config/my-app.env`. Never commit secrets to git!
- **Safe Transport**: Unit definitions are transferred via Base64 stream to prevent shell injection, host arguments are sanitized against SSH parameter injection.

---

<details>
<summary><b>How the deploy pipeline works (11 steps, under the hood)</b></summary>

1. **Build locally** — `bun run build` or automatic `bun build` entry bundle on your laptop.
2. **Pack artifact** — bundles `dist/` into a temporary archive in OS `tmpdir()`.
3. **Hash** — calculates SHA-256 content hash (first 5 chars: `<hash5>`).
4. **Transport** — transfers archive via `scp` to `$HOME/projects/<name>/incoming/`.
5. **Session linger** — verifies `loginctl enable-linger` so services survive SSH disconnects.
6. **Unpack** — extracts to `$HOME/projects/<name>/releases/<name>_<hash5>`.
7. **Atomic switch** — updates symlink `$HOME/projects/<name>/current` atomically.
8. **Unit setup** — installs unit into `~/.config/systemd/user/<service>`, runs `daemon-reload`, enables and starts service.
9. **Verification** — checks `active` state, verifies listening port or checks that `NRestarts` remains 0.
10. **Auto-rollback** — on verification failure, points `current` back to previous working release and preserves failed directory for debugging.
11. **Safe rotation** — keeps 3 newest releases by mtime, guaranteed not to delete active `current`.

</details>

<details>
<summary><b>Exit codes</b></summary>

| Code  | Meaning                                                                     |
| ----- | --------------------------------------------------------------------------- |
| `0`   | Success (deployment verified, or informational command like `ps`, `--help`) |
| `1`   | Service not found, or verification failed (rolled back to previous release) |
| `2`   | CLI usage error (invalid host, unknown flag or subcommand)                  |
| `127` | Missing `ssh` or `scp` in `PATH`                                            |

</details>

<details>
<summary><b>Directory layout on the host</b></summary>

```
$HOME/projects/<name>/
├── incoming/                         # Temporary buffer (cleaned up after deploy)
├── releases/
│   ├── <name>_abc12/                 # Previous release
│   └── <name>_5fa9b/                 # Current active release
└── current -> releases/<name>_5fa9b/ # Symlink to active version
```

Unit files live in `~/.config/systemd/user/<service>.service`.

</details>

---

## Requirements

- **Local:** macOS / Linux, [Bun](https://bun.sh) ≥ 1.0, OpenSSH (`ssh`, `scp`).
- **Target Host:** Linux with `systemd` (`systemctl --user`), Node.js at `/usr/bin/node`.
- **Access:** SSH key access (`ssh-copy-id`). Password prompts are not supported (`BatchMode=yes`).

---

## License

MIT © [jt3k](https://github.com/jt3k)
