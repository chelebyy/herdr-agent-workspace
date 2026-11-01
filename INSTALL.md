# Installing Agent Workspace (for coding agents)

You are installing the Herdr layout **agent-workspace** from
https://github.com/chelebyy/herdr-agent-workspace into the user's Herdr. Follow these steps in order and
report back after each one that needs a decision.

## 1. Find the Herdr home

- It is `$HERDR_APP_HOME` if set, else `~/.config/herdr-app` (on Windows: `%USERPROFILE%\.config\herdr-app`).
- It must contain `AGENTS.md`, `layouts/` and `mods/`. If it does not, stop: Herdr is not installed or has
  not run yet.
- Read the section "Layouts and mods other people made" in that `AGENTS.md`. Where it and this file differ,
  the user's `AGENTS.md` wins.

## 2. Get the package

Clone or download the repo into a new temporary folder (not into the Herdr home):

```sh
git clone --depth 1 https://github.com/chelebyy/herdr-agent-workspace <temp-folder>
```

Read `README.md` and `RECIPE.md` there before copying anything.

## 3. Tell the user what it runs, then ask to continue

Summarise the README's **What it runs** section for the user in a few lines: which mods start programs
(`node`, `pwsh`, `powershell`, `git`, `adb`, `quota-axi`, the agent CLIs), that team mode sends task text to
the chosen AI providers, and which files are written outside the mods' own folders. Continue only when the
user agrees.

## 4. Copy without overwriting

- Copy `layouts/agent-workspace.json` into `<Herdr home>/layouts/`.
- Copy every folder in `mods/` into `<Herdr home>/mods/`.
- **Never overwrite.** If a layout or mod name is already taken (by the user or by Herdr), give the new one
  another name and change every reference to it: its file or folder name, the `"mod"` names in the layout
  (including `"terminal_menu": "menu-tr"`), and the `mods/<name>/` paths inside the copied mods.
- Do not copy `README.md`, `RECIPE.md`, `INSTALL.md`, `I18N.md`, `LICENSE*`, `NOTICE`, `preview.png`,
  `screenshots/`, `.gitignore` or `.herdr-export.json`.

## 5. Check every mod

Run `herdr-app check <Herdr home>/mods/<name>` for each copied mod. Report any failure to the user with the
exact error. Do not edit the mods to make a check pass unless the user asks.

## 6. Switch and confirm

```sh
herdr-app do layout.switch --name agent-workspace
herdr-app status
```

`status` must show `"layout": "agent-workspace"` and `"errors": []`. If Herdr is not running, tell the user to
start it and switch with `ctrl-shift-l`.

## 7. Report optional tools

Check which of these exist on this machine and tell the user which features each missing one turns off:

| Tool | Needed for |
| --- | --- |
| `node` on PATH | system gauges, Android panel, task presets team mode |
| `pwsh` (PowerShell 7, Windows) | Agent resources panel |
| `nvidia-smi` (Windows) | GPU gauge |
| Android SDK `platform-tools` / `emulator` (`ANDROID_HOME`) | Android panel |
| `quota-axi` | quota bars |
| `codex`, `claude`, `opencode` CLIs | task presets (single agent uses Herdr's installed agents; team mode uses these) |

On macOS and Linux the system gauges, Agent resources panel and team mode do not work yet; everything else
should. Say so if the machine is not Windows.

## Language

The interface starts in Turkish. The user can switch to English with **TR | EN** at the bottom left of the
sidebar (the choice is remembered).

## Undo

The user's own layout is untouched: `ctrl-shift-l` switches back. To remove this layout, delete
`<Herdr home>/layouts/agent-workspace.json` and the copied mod folders.
