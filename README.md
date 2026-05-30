# Mission Control

Local web interface for managing to-dos stored in `~/.claude/workspace/*/todo.md`.

## Usage

The server starts automatically at login via launchd. Open [http://mc.local](http://mc.local) (or [http://localhost:3333](http://localhost:3333) before domain setup).

To start/stop manually:

```bash
launchctl load   ~/Library/LaunchAgents/com.miqueladell.mission-control.plist
launchctl unload ~/Library/LaunchAgents/com.miqueladell.mission-control.plist
```

Logs: `tail -f ~/Library/Logs/mission-control.log`

## First-time domain setup

Run once to enable `http://mc.local` (sets up `/etc/hosts` + pf port redirect):

```bash
sudo bash ~/code/mission-control/setup-domain.sh
```

No reboot needed. The redirect (port 80 → 3333) and hosts entry survive reboots.

## Features

- **View** all open to-dos across all workspace projects in one table
- **Work / Personal tabs** — defaults to work; personal projects are configured in `public/app.js`
- **Filter** by project, priority (Now / Next / Someday), or text search
- **Sort** by priority, due date, or project
- **Mark done** — click ✓ to move an item to the project's `done.md` with today's date
- **Edit** — double-click any to-do text to edit inline; click the priority badge to change priority
- **Create** — `+` button opens a form (project, priority, text); tab through fields, Enter to save
- **Date parsing** — items with `[YYYY-MM-DD ...]` tags are parsed and sortable; overdue dates shown in red
- **Markdown rendering** — bold, inline code, and links rendered in the table
- **Auto-link** — bare URLs are saved as `[url](url)` on create/edit

All data stays in the existing `.md` files. No database, no migration.

## File structure

```
mission-control/
├── server.js           # Express backend — reads/writes .md files
├── start.sh            # nvm-aware wrapper used by the LaunchAgent
├── setup-domain.sh     # One-time domain + port-forward setup (needs sudo)
├── package.json
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

## Todo file format

```
## Now        ← high priority
## Next       ← medium priority  
## Someday    ← low priority (hidden by default, toggle to show)

- [ ] **Item text** — added YYYY-MM-DD
- [ ] **[2026-06-01 deadline] Item with due date** — added YYYY-MM-DD
```

Done items in `done.md`:

```
- [YYYY-MM-DD] Item text
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3333` | HTTP port |
