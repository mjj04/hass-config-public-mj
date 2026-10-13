// Smart devices API. Devices, scenes and their connections are set in
// homepage.yaml under devices: and scenes: (see README).

import { createDeviceManager } from '../lib/devices/index.js';

let manager;

export async function start({ store, emit, configDir, config }) {
  manager = createDeviceManager({ store, emit, configDir });
  await manager.configure(config);
}

export function configChanged(config) {
  manager.configure(config).catch((err) => console.error(`Devices: ${err.message}`));
}

export function stop() {
  manager?.stop();
}

export const routes = {
  'GET /api/devices': () => manager.list(),

  // Body: { on: true|false|"toggle", brightness, target, position, command: open|close|stop }
  'POST /api/devices/:id': ({ params, body }) => manager.command(params.id, body),

  'POST /api/rooms/:room/off': ({ params }) => manager.roomOff(params.room),

  'POST /api/scenes/:id': ({ params }) => manager.runScene(params.id),
};
