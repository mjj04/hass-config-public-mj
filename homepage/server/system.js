// Host and Docker stats for the machine the homepage runs on.
//
// Host: CPU, memory, uptime and load come from the kernel, which a
// container shares with its host, so they describe the whole machine.
// Disks are measured at the paths listed under server.disks (default:
// the disk holding the data folder).
//
// Docker: read through docker-socket-proxy (see docker-compose.yml), which
// only allows read-only container calls. server.docker can also be a
// unix socket path like unix:///var/run/docker.sock.

import http from 'node:http';
import os from 'node:os';
import { readFile, readdir, statfs } from 'node:fs/promises';

let lastCpu = null;
let cache = { at: 0, data: null };
let pending = null; // one refresh at a time, shared by every screen
const TTL = 5_000;

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === 'idle') idle += v; }
  }
  return { idle, total };
}

async function cpuPercent() {
  if (!lastCpu) {
    lastCpu = cpuTimes();
    await new Promise((r) => setTimeout(r, 400));
  }
  const now = cpuTimes();
  const total = now.total - lastCpu.total;
  const idle = now.idle - lastCpu.idle;
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

// Linux reports MemAvailable, which counts reclaimable cache as free.
async function memory() {
  try {
    const info = Object.fromEntries((await readFile('/proc/meminfo', 'utf8')).split('\n')
      .map((l) => l.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map((m) => [m[1], Number(m[2]) * 1024]));
    return { total: info.MemTotal, used: info.MemTotal - info.MemAvailable };
  } catch {
    return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
  }
}

async function temperature() {
  try {
    const zones = (await readdir('/sys/class/thermal')).filter((z) => z.startsWith('thermal_zone'));
    const temps = await Promise.all(zones.map(async (z) =>
      Number(await readFile(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000));
    const valid = temps.filter((t) => t > 0 && t < 150);
    return valid.length ? Math.max(...valid) : null;
  } catch {
    return null;
  }
}

async function disks(list) {
  return Promise.all(list.map(async (d) => {
    try {
      const s = await statfs(d.path);
      const total = s.blocks * s.bsize;
      return { name: d.name, total, used: total - s.bavail * s.bsize };
    } catch (err) {
      return { name: d.name, error: err.code || err.message };
    }
  }));
}

function dockerGet(target, apiPath) {
  return new Promise((resolve, reject) => {
    const opts = target.startsWith('unix://')
      ? { socketPath: target.slice('unix://'.length), path: apiPath }
      : (() => { const u = new URL(apiPath, target); return { host: u.hostname, port: u.port || 2375, path: u.pathname + u.search }; })();
    const req = http.get({ ...opts, timeout: 5_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Docker API ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker API timed out')));
    req.on('error', reject);
  });
}

function containerStats(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage || 0);
  const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage || 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const mem = s.memory_stats || {};
  const cache = mem.stats?.inactive_file ?? mem.stats?.cache ?? 0;
  return {
    cpu: sysDelta > 0 && cpuDelta >= 0 ? Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10 : 0,
    memUsed: mem.usage ? mem.usage - cache : null,
  };
}

async function docker(target) {
  if (!target) return { available: false, error: 'Set server.docker in homepage.yaml' };
  try {
    const list = await dockerGet(target, '/containers/json?all=1');
    const containers = await Promise.all(list.map(async (c) => {
      const base = {
        id: c.Id.slice(0, 12),
        name: (c.Names?.[0] || c.Id).replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
        health: /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1] || null,
      };
      if (c.State !== 'running') return base;
      try {
        return { ...base, ...containerStats(await dockerGet(target, `/containers/${c.Id}/stats?stream=false`)) };
      } catch {
        return base;
      }
    }));
    containers.sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'running' ? -1 : 1));
    return { available: true, containers };
  } catch (err) {
    return { available: false, error: `can't reach ${target} (${err.message})` };
  }
}

export const routes = {
  'GET /api/system': async ({ config }) => {
    if (cache.data && Date.now() - cache.at < TTL) return cache.data;
    pending ??= collect(config.server).finally(() => { pending = null; });
    return pending;
  },
};

async function collect(s) {
  const [cpu, mem, temp, disk, dock] = await Promise.all([
    cpuPercent(),
    memory(),
    temperature(),
    disks(s.disks || [{ name: 'Disk', path: process.env.DATA_DIR || 'data' }]),
    docker(s.docker),
  ]);
  const data = {
    name: s.name || os.hostname(),
    host: {
      cpu, cores: os.cpus().length, load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      memory: mem, temperature: temp, uptime: os.uptime(), disks: disk,
    },
    docker: dock,
  };
  cache = { at: Date.now(), data };
  return data;
}
