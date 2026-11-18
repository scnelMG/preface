// Resolve external programs the same way everywhere (server, scan, doctor).
// python: LM_PYTHON -> ./.venv -> runtime.json "python" -> py/python3/python on PATH
// colmap: LM_COLMAP -> runtime.json "colmap" -> ./.tools/colmap -> C:\tools\colmap -> colmap on PATH
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const isWin = process.platform === 'win32';

export function readRuntime() {
  const out = {};
  for (const f of ['runtime.json', 'runtime.local.json']) {   // local overrides shared
    try { Object.assign(out, JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))); } catch {}
  }
  return out;
}

const exists = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
export function works(cmd, args = ['--version']) {
  try {
    const r = needsShell(cmd)
      ? spawnSync(shellLine(cmd, args), { encoding: 'utf8', timeout: 60000, shell: true, windowsHide: true })
      : spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
    return r.status === 0 ? ((r.stdout || '') + (r.stderr || '')).trim() : null;
  } catch { return null; }
}
export const needsShell = (cmd) => isWin && /\.(bat|cmd)$/i.test(cmd);
// .bat/.cmd must go through cmd.exe; pass ONE quoted command line (no args array -> no DEP0190 warning)
export const shellLine = (cmd, args) => [cmd, ...args].map((s) => (/[\s&()^|<>"]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s)).join(' ');

export function resolvePython() {
  const rt = readRuntime();
  const venv = path.join(root, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  const cands = [process.env.LM_PYTHON, exists(venv) ? venv : null, rt.python, isWin ? 'py' : 'python3', 'python'].filter(Boolean);
  for (const c of cands) {
    if (path.isAbsolute(c) && !exists(c)) continue;
    if (works(c)) return c;
  }
  return null;
}

export function resolveColmap() {
  const rt = readRuntime();
  const local = isWin ? [path.join(root, '.tools', 'colmap', 'COLMAP.bat'), 'C:\\tools\\colmap\\COLMAP.bat'] : [];
  const cands = [process.env.LM_COLMAP, rt.colmap, ...local].filter(Boolean);
  for (const c of cands) if (exists(c)) return c;
  if (works('colmap', ['help'])) return 'colmap';
  return null;
}

// spawn helper that streams output and resolves with the exit code; .bat needs a shell on Windows (Node >= 18.20)
import { spawn } from 'node:child_process';
export function run(cmd, args, { cwd = root, log = null, env = {}, quiet = false, stdoutFile = null } = {}) {
  return new Promise((resolve) => {
    const shell = needsShell(cmd);
    const opts = { cwd, shell, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env } };
    const p = shell ? spawn(shellLine(cmd, args), opts) : spawn(cmd, args, opts);
    if (stdoutFile) fs.writeFileSync(stdoutFile, '');
    const tee = (d, err) => {
      if (!quiet) (err ? process.stderr : process.stdout).write(d);
      if (log) fs.appendFileSync(log, d);
      if (stdoutFile && !err) fs.appendFileSync(stdoutFile, d);
    };
    p.stdout.on('data', (d) => tee(d, false));
    p.stderr.on('data', (d) => tee(d, true));
    p.on('error', (e) => { tee(String(e) + '\n', true); resolve(127); });
    p.on('close', (code) => resolve(code ?? 1));
  });
}
