import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';

test('an old floorplan widget becomes the house widget with the 3D model', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'homepage-config-'));
  const file = path.join(dir, 'homepage.yaml');
  await writeFile(file, [
    'pages:',
    '  - title: House',
    '    widgets:',
    '      - { type: floorplan, w: 12, h: 8, floors: [{ name: Ground floor, image: /floorplans/ground.svg }] }',
  ].join('\n'));
  try {
    const [w] = (await loadConfig(file)).pages[0].widgets;
    assert.equal(w.type, 'house');
    assert.equal(w.w, 12);
    assert.equal(w.floors[0].plan, '/house/ground.svg');
    assert.equal(w.model.obj, '/house/house.obj');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
