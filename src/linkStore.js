import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDiscordId, normalizeMinecraftName } from './earthmc.js';

export class LinkStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = [];
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.records = Array.isArray(parsed.links)
        ? parsed.links.map(normalizeRecord).filter(Boolean)
        : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      this.records = [];
      await this.save();
    }
  }

  async save() {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      links: this.records
    };
    const tempPath = `${this.filePath}.tmp`;

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
    await rename(tempPath, this.filePath);
  }

  find(query) {
    return this.findAll(query)[0] ?? null;
  }

  findAll(query, source = null) {
    const discordId = normalizeDiscordId(query);

    if (discordId) {
      return this.findAllByDiscordId(discordId, source);
    }

    const minecraftName = normalizeMinecraftName(query);

    if (minecraftName) {
      return this.findAllByMinecraftName(minecraftName, source);
    }

    return [];
  }

  findByDiscordId(discordId, source = null) {
    return this.findAllByDiscordId(discordId, source)[0] ?? null;
  }

  findAllByDiscordId(discordId, source = null) {
    return this.records.filter((record) => (
      record.discordId === discordId
      && (!source || record.source === source)
    ));
  }

  findByMinecraftName(minecraftName, source = null) {
    return this.findAllByMinecraftName(minecraftName, source)[0] ?? null;
  }

  findAllByMinecraftName(minecraftName, source = null) {
    const normalized = minecraftName.toLowerCase();

    return this.records.filter((record) => (
      record.minecraftName.toLowerCase() === normalized
      && (!source || record.source === source)
    ));
  }

  async upsertPlayer(player, source = 'emc') {
    const record = this.playerToRecord(player, source);

    if (!record) {
      return null;
    }

    this.upsertRecord(record);
    await this.save();
    return record;
  }

  async upsertPlayers(players, source = 'emc') {
    const records = players
      .map((player) => this.playerToRecord(player, source))
      .filter(Boolean);

    for (const record of records) {
      this.upsertRecord(record);
    }

    if (records.length > 0) {
      await this.save();
    }

    return records;
  }

  async upsertRecords(records) {
    const normalizedRecords = records.map(normalizeRecord).filter(Boolean);

    for (const record of normalizedRecords) {
      this.upsertRecord(record);
    }

    if (normalizedRecords.length > 0) {
      await this.save();
    }

    return normalizedRecords;
  }

  playerToRecord(player, source) {
    if (!player?.discord || !player?.name || !player?.uuid) {
      return null;
    }

    return normalizeRecord({
      discordId: String(player.discord),
      minecraftName: String(player.name),
      minecraftUuid: String(player.uuid),
      source,
      updatedAt: new Date().toISOString()
    });
  }

  upsertRecord(record) {
    const normalizedRecord = normalizeRecord(record);

    if (!normalizedRecord) {
      return;
    }

    const minecraftName = normalizedRecord.minecraftName.toLowerCase();

    this.records = this.records.filter((existing) => (
      existing.source !== normalizedRecord.source
      || (
        existing.discordId !== normalizedRecord.discordId
        && existing.minecraftUuid !== normalizedRecord.minecraftUuid
        && existing.minecraftName.toLowerCase() !== minecraftName
      )
    ));
    this.records.push(normalizedRecord);
    this.records.sort((a, b) => (
      a.minecraftName.localeCompare(b.minecraftName)
      || a.source.localeCompare(b.source)
    ));
  }
}

function normalizeRecord(record) {
  if (!record?.discordId || !record?.minecraftName || !record?.minecraftUuid) {
    return null;
  }

  return {
    source: normalizeSource(record.source),
    discordId: String(record.discordId),
    minecraftName: String(record.minecraftName),
    minecraftUuid: String(record.minecraftUuid),
    updatedAt: record.updatedAt ?? new Date().toISOString()
  };
}

function normalizeSource(source) {
  if (source === 'earthmc') {
    return 'emc';
  }

  if (source === 'earthpol') {
    return 'epmc';
  }

  return source === 'epmc' ? 'epmc' : 'emc';
}
