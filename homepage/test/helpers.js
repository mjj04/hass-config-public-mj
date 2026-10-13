// Starts the real server against a temporary config folder.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer(yaml, files = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'homepage-test-'));
  const config = path.join(dir, 'config');
  await mkdir(config, { recursive: true });
  await writeFile(path.join(config, 'homepage.yaml'), yaml);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(config, name)), { recursive: true });
    await writeFile(path.join(config, name), text);
  }
  const port = 18000 + Math.floor(Math.random() * 1500);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CONFIG_DIR: config, DATA_DIR: path.join(dir, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { log += d; if (String(d).includes('Family homepage on')) resolve(); });
    proc.stderr.on('data', (d) => { log += d; });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}\n${log}`)));
  });
  const json = async (p, opts = {}) => {
    const res = await fetch(base + p, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    dir, base, json,
    log: () => log,
    async stop() {
      proc.kill();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls fn until it returns something truthy.
export async function eventually(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await wait(50);
  }
}
