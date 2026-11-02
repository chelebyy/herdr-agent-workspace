'use strict';
// Linux counterpart of sample.ps1: the given terminal root processes and all their descendants, read from /proc.
// Prints the same JSON: {at, cores, processes: [{pid, parent, started (ms), cpu (s), ram (bytes)}]}.
const fs = require('node:fs');
const os = require('node:os');
const {execFileSync} = require('node:child_process');

const ids = process.argv[2] || '';
if (!/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(ids) || ids.length > 4096) { console.error('Invalid process IDs'); process.exit(1); }
const roots = new Set(ids.split(',').map(Number));
const conf = (name, fallback) => { try { const n = Number(execFileSync('getconf', [name], {encoding: 'utf8', timeout: 2000}).trim()); return n > 0 ? n : fallback; } catch { return fallback; } };
const tick = conf('CLK_TCK', 100), page = conf('PAGESIZE', 4096);
const boot = Number(/^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf8'))?.[1]);
if (!(boot > 0)) { console.error('Cannot read boot time'); process.exit(1); }

const byId = new Map();
for (const name of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(name)) continue;
  let stat;
  try { stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8'); } catch { continue; } // exited meanwhile
  // The command name (field 2) may contain spaces and parentheses; the fields after its last ')' are fixed.
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const pid = Number(name);
  byId.set(pid, {pid, parent: Number(f[1]), started: Math.round((boot + Number(f[19]) / tick) * 1000), cpu: (Number(f[11]) + Number(f[12])) / tick, ram: Number(f[21]) * page});
}
// Same rule as sample.ps1: a child counts only if it started after its parent (guards against reused PIDs).
const selected = new Set([...roots].filter(pid => byId.has(pid)));
for (let added = true; added;) {
  added = false;
  for (const p of byId.values()) {
    const parent = byId.get(p.parent);
    if (selected.has(p.parent) && parent && p.started >= parent.started && !selected.has(p.pid)) { selected.add(p.pid); added = true; }
  }
}
console.log(JSON.stringify({at: Date.now(), cores: os.cpus().length, processes: [...selected].map(pid => byId.get(pid))}));
