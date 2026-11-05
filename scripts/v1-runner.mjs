import {spawn, execFile} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {performance} from 'node:perf_hooks';

export function parseBudget(args) {
  let budgetMs = 600_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--budget-ms' || i + 1 >= args.length) throw new Error('Usage: npm run verify:next -- [--budget-ms 600000]');
    budgetMs = Number(args[++i]);
  }
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 100 || budgetMs > 600_000) throw new Error('Budget must be an integer from 100 to 600000 milliseconds');
  return budgetMs;
}

export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform === 'win32') return new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => resolve()));
  try {process.kill(-child.pid, 'SIGKILL');} catch {try {child.kill('SIGKILL');} catch {}}
  return Promise.resolve();
}

/** One deadline shared by all stages. Timeout rejects; it never becomes a pass. */
export async function runProcess(command, args, {cwd, env = process.env, deadline, logPath, active = new Set()} = {}) {
  const remaining = deadline - performance.now();
  if (!(remaining > 0)) throw new Error('Verification budget exhausted before starting process');
  const log = logPath ? createWriteStream(logPath, {flags: 'a'}) : null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    active.add(child);
    let tail = '', timedOut = false;
    const output = chunk => {log?.write(chunk); tail = (tail + chunk.toString()).slice(-12_000);};
    child.stdout.on('data', output); child.stderr.on('data', output);
    const timer = setTimeout(() => {timedOut = true; void killTree(child);}, remaining);
    const finish = () => {clearTimeout(timer); active.delete(child); log?.end();};
    child.on('error', error => {finish(); reject(error);});
    child.on('close', (code, signal) => {
      finish();
      if (timedOut) reject(new Error(`Verification budget exceeded; process tree terminated.\n${tail}`));
      else if (code !== 0) reject(new Error(`Process failed (${code ?? signal}): ${command} ${args.join(' ')}\n${tail}`));
      else resolve({exitCode: code, tail});
    });
  });
}
