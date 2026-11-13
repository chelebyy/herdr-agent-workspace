# Installing Agent Workspace (for coding agents)

You are installing the Herdr layout **agent-workspace** from
https://github.com/chelebyy/herdr-agent-workspace into the user's Herdr. Follow these steps in order and
report back after each one that needs a decision.

## 1. Find the Herdr home

- It is `$HERDR_APP_HOME` if set, else `~/.config/herdr-app` (on Windows: `%USERPROFILE%\.config\herdr-app`).
- It must contain `AGENTS.md`, `layouts/` and `mods/`. If it does not, stop: Herdr is not installed or has
  not run yet.
- The layout also uses Herdr's own mods `workspace-chrome` and `pane` (every install has them; several mods
  load icons from `mods/workspace-chrome/`). If either is missing, stop and tell the user.
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
the chosen AI providers, and which files are written outside the mods' own folders. Also check now which tools
from step 7 are missing and list the ones you will install. Continue only when the user agrees; that answer
covers the installs in step 7 (the user may leave some out). Also ask whether they want folders in the
spaces list (step 8); they are on by default, and a no switches the list to `spaces-tr` in step 4.

## 4. Copy without overwriting

- Copy `layouts/agent-workspace.json` into `<Herdr home>/layouts/`.
- Copy every folder in `mods/` into `<Herdr home>/mods/`.
- **Never overwrite.** If a layout or mod name is already taken (by the user or by Herdr), give the new one
  another name (for example `quota-aw`) and change every reference to it:
  - its file or folder name;
  - the `"mod"` names in the layout, including `"terminal_menu": "menu-tr"`;
  - inside all copied mods: `mods/<name>/` paths and mod names in code, such as
    `openOverlay({ mod: "<name>" ... })` (search for the old name in quotes).
  A renamed mod keeps its shared-store keys (for example `quota.*`); mention this if the user's own mod
  with that name might use the same keys.
- `mods/space-folders` may already be there from jankeesvw/herdr-space-folders (an earlier version of this
  guide installed it in step 8; its `mod.json` title is "Space folders"). It is the same mod in English and
  uses the same folders file. Show the user `git diff --no-index <Herdr home>/mods/space-folders mods/space-folders`;
  on a yes, replace that folder instead of renaming ours (keep a copy of the old one). On a no, rename ours as
  above.
- If the user said no to folders in step 3, change the copied layout's spaces block (`"id": "spaces"`) from
  `"mod": "space-folders"` to `"mod": "spaces-tr"` (or the names chosen above) now, before step 6 switches to
  it, and do not copy `mods/space-folders`.
- Keep each file's line endings when you edit it (the files use CRLF).
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

`status` must show `"layout": "agent-workspace"` and `"errors": []`.

If no Herdr window is running for this home, both commands fail with "no Herdr window …". That is not an
install error: tell the user to start Herdr, pick **agent-workspace** with `ctrl-shift-l`, and run
`herdr-app status` once it is open.

## 7. Install the missing tools

Check which of these exist (on PATH, or where the note says). Install the missing ones the user agreed to in
step 3, using the command for this platform. Run user-level installs yourself. A command that needs `sudo` or
an administrator prompt: run it if you can; if you cannot (no terminal for the password), give the user the
exact command to run and wait. Never install anything the user left out, and stop on a failed install
instead of trying other sources.

| Tool | Needed for | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| `node` 22.19 or newer (with `npm`) | system gauges, Android, team mode, and installing the npm tools below | `winget install OpenJS.NodeJS.LTS` | `brew install node` | distro package: `sudo pacman -S nodejs npm`, `sudo apt install nodejs npm`, `sudo dnf install nodejs` |
| `quota-axi` | quota bars | `npm install -g quota-axi@0.1.69` | same | same |
| `pwsh` (PowerShell 7) | Agent resources panel (Windows only; Linux uses `node` and `/proc`) | `winget install Microsoft.PowerShell` | not needed | not needed |
| `adb` | Android panel (devices) | `winget install Google.PlatformTools` | `brew install android-platform-tools` | `sudo pacman -S android-tools`, `sudo apt install adb`, `sudo dnf install android-tools` |
| `codex` CLI | team mode | `npm install -g @openai/codex` | same | same |
| `claude` CLI | team mode | `irm https://claude.ai/install.ps1 \| iex` (PowerShell) | `curl -fsSL https://claude.ai/install.sh \| bash` | same as macOS |
| `opencode` CLI | team mode | `npm install -g @opencode/cli` | same | same |

Notes:
- Install `node` first; the npm rows need it. Then check `node --version`: `quota-axi` needs 22.19 or newer
  (npm only warns with `EBADENGINE` and installs it anyway). Distro packages are often older (Ubuntu 22.04 and
  24.04, Debian 12); if the version is too old, do not install the npm tools on it: tell the user and suggest
  a current Node (NodeSource packages, or a version manager such as `fnm` or `nvm`).
- If `npm install -g` fails with a permission error, do not use
  `sudo npm`: tell the user and suggest a user-level npm prefix (`npm config set prefix ~/.local/npm` and that
  folder's `bin` on PATH).
- `quota-axi` is a third-party tool, not part of this package: by kunchenguid, [github.com/kunchenguid/quota-axi](https://github.com/kunchenguid/quota-axi), MIT. It reads the agents' usage with their local sign-ins. Say this to the user when asking for consent in step 3. `quota-axi@0.1.69` is the version this layout was tested with; the quota mod reads its `--json` output.
- The Windows commands match where the team runner looks: Codex and OpenCode under the npm global folder in
  `%APPDATA%`, Claude at `~/.local/bin/claude.exe`. Elsewhere the runner finds the CLIs on PATH or in the login
  shell's PATH.
- Only offer the agent CLIs the user wants to use in team mode; each needs the user's own account. After
  installing, tell the user to sign in once: `codex login`, `claude` (then `/login`), `opencode auth login`.
- Not installed by this step (tell the user what each one turns off if it is missing): `nvidia-smi` (comes
  with the NVIDIA driver; GPU gauge on NVIDIA cards, while Linux reads AMD and Intel GPUs without it), the
  Android `emulator` (Android Studio's SDK Manager; emulators in the Android panel), and a Linux system monitor
  such as `plasma-systemmonitor` or `gnome-system-monitor` (clicking the gauges).
- If the Herdr window was already open, a tool installed into a new PATH folder may only be found after Herdr
  restarts; the quota mod and team runner also look in the login shell's PATH.

Then report which tools are present, which you installed and which are still missing, and what each missing
one turns off. Everything works on Windows and Linux. On macOS the GPU gauge and the Agent resources panel are
not supported yet and the rest is untested; say so if the machine is a Mac.

## 8. Folders in the spaces list

The layout's spaces list is `space-folders`: folders that group spaces (a folder button next to "+", drag and
drop, start folders, rules, colors). It is a translated copy of
[jankeesvw/herdr-space-folders](https://github.com/jankeesvw/herdr-space-folders) (MIT) and keeps its folders
per machine in `~/.config/herdr-space-folders.json`, the same file and format as that project, so folders made
with it before are kept.

- On this computer it reads and writes that file with Herdr's own file functions; no `sh` is needed.
- For spaces on another machine it runs POSIX `sh` there (`cat`, `mkdir`, `mv` on that file, and printing
  `$HOME`). A remote Windows machine without `sh` on PATH keeps no folders; say so if the user has one.
- If the user said no to folders in step 3, step 4 already set the spaces block to `spaces-tr`; nothing here.

Tell the user: folders are kept per machine, so folders made on another computer do not appear here; the
folder button next to "+" makes one (it gets a color no other folder has), right-click colors, edits or
deletes it. To go without folders later, keep a copy of the installed layout, set its spaces block to
`spaces-tr` (or the name chosen for it in step 4), run `herdr-app do layout.switch --name <that layout>` and check `herdr-app status` for errors.

## Language

The interface starts in Turkish. The user can switch to English with **TR | EN** at the bottom left of the
sidebar (the choice is remembered).

## Undo

The user's own layout is untouched: `ctrl-shift-l` switches back. To remove this layout, delete
`<Herdr home>/layouts/agent-workspace.json` and the copied mod folders. Folders stay in
`~/.config/herdr-space-folders.json`; delete that file too if the user wants them gone.
