import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkStore } from '../src/linkStore.js';

test('LinkStore upserts and finds records by Discord ID, mention, and Minecraft name', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'global-chat-bot-'));

  try {
    const store = new LinkStore(path.join(dir, 'links.json'));
    await store.load();

    await store.upsertPlayer({
      name: 'Fruitloopins',
      uuid: 'fed0ec4a-f1ad-4b97-9443-876391668b34',
      discord: '160374716928884736'
    });

    assert.equal(store.find('160374716928884736').minecraftName, 'Fruitloopins');
    assert.equal(store.find('<@160374716928884736>').minecraftName, 'Fruitloopins');
    assert.equal(store.find('fruitloopins').discordId, '160374716928884736');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('LinkStore replaces stale username ownership on upsert', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'global-chat-bot-'));

  try {
    const store = new LinkStore(path.join(dir, 'links.json'));
    await store.load();

    await store.upsertPlayer({
      name: 'OldName',
      uuid: 'fed0ec4a-f1ad-4b97-9443-876391668b34',
      discord: '160374716928884736'
    });
    await store.upsertPlayer({
      name: 'NewName',
      uuid: 'fed0ec4a-f1ad-4b97-9443-876391668b34',
      discord: '160374716928884736'
    });

    assert.equal(store.records.length, 1);
    assert.equal(store.find('NewName').discordId, '160374716928884736');
    assert.equal(store.find('OldName'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('LinkStore keeps one record per linking source', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'global-chat-bot-'));

  try {
    const store = new LinkStore(path.join(dir, 'links.json'));
    await store.load();

    await store.upsertRecords([
      {
        source: 'emc',
        minecraftName: 'EarthMcName',
        minecraftUuid: 'fed0ec4a-f1ad-4b97-9443-876391668b34',
        discordId: '160374716928884736'
      },
      {
        source: 'epmc',
        minecraftName: 'EarthPolName',
        minecraftUuid: 'd904bb76-412d-4f6a-af9f-13853b5fc614',
        discordId: '160374716928884736'
      }
    ]);

    const records = store.findAll('160374716928884736');

    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => record.source).sort(), ['emc', 'epmc']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
