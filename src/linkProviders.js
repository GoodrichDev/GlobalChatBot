import {
  normalizeDiscordId,
  queryOnePlayer,
  queryPlayers,
  playerHasDiscordLink
} from './earthmc.js';
import {
  queryEarthPolLinkByDiscordId,
  queryEarthPolLinkByMinecraftName,
  queryEarthPolLinksByDiscordIds
} from './earthpol.js';

export const LINK_SOURCES = {
  emc: {
    label: 'EMC',
    displayName: 'EarthMC',
    roleConfigKey: 'linkedByEmcRole'
  },
  epmc: {
    label: 'EPMC',
    displayName: 'EarthPol',
    roleConfigKey: 'linkedByEpmcRole'
  }
};

export const LINK_SOURCE_KEYS = Object.keys(LINK_SOURCES);

export async function lookupLinkRecords(query, { sources = LINK_SOURCE_KEYS, logger = console } = {}) {
  const records = [];
  const errors = [];

  if (sources.includes('emc')) {
    try {
      const player = await queryOnePlayer(query);
      const record = earthMcPlayerToRecord(player);

      if (record) {
        records.push(record);
      }
    } catch (error) {
      errors.push({ source: 'emc', error });
      logger.warn('EarthMC linked lookup failed:', error);
    }
  }

  if (sources.includes('epmc')) {
    try {
      const discordId = normalizeDiscordId(query);
      const record = discordId
        ? await queryEarthPolLinkByDiscordId(discordId)
        : await queryEarthPolLinkByMinecraftName(query);

      if (record) {
        records.push(record);
      }
    } catch (error) {
      errors.push({ source: 'epmc', error });
      logger.warn('EarthPol linked lookup failed:', error);
    }
  }

  return { records: dedupeRecords(records), errors };
}

export async function lookupLinkRecordsByDiscordIds(discordIds, { logger = console } = {}) {
  const records = [];
  const errors = [];

  try {
    const earthMcPlayers = await queryPlayers(discordIds);
    records.push(...earthMcPlayers.map(earthMcPlayerToRecord).filter(Boolean));
  } catch (error) {
    errors.push({ source: 'emc', error });
    logger.warn('EarthMC guild sync lookup failed:', error);
  }

  try {
    records.push(...await queryEarthPolLinksByDiscordIds(discordIds));
  } catch (error) {
    errors.push({ source: 'epmc', error });
    logger.warn('EarthPol guild sync lookup failed:', error);
  }

  return { records: dedupeRecords(records), errors };
}

export function earthMcPlayerToRecord(player) {
  if (!playerHasDiscordLink(player)) {
    return null;
  }

  return {
    source: 'emc',
    discordId: String(player.discord),
    minecraftName: String(player.name),
    minecraftUuid: String(player.uuid)
  };
}

export function sourceLabel(source) {
  return LINK_SOURCES[source]?.label ?? source;
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];

  for (const record of records) {
    const key = `${record.source}:${record.discordId}:${record.minecraftUuid}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}
