const EARTHPOL_API_BASE = 'https://api.earthpol.com/astra';
const PLAYERDB_API_BASE = 'https://playerdb.co/api/player/minecraft';

export class EarthPolApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'EarthPolApiError';
    this.status = status;
    this.body = body;
  }
}

export function normalizeUuid(uuid) {
  const value = String(uuid ?? '').trim();

  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    return value.toLowerCase();
  }

  const match = value.match(/^([0-9a-fA-F]{8})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{12})$/);

  if (!match) {
    return value;
  }

  return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`.toLowerCase();
}

async function postEarthPol(path, queries, { signal } = {}) {
  const response = await fetch(`${EARTHPOL_API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({ query: queries }),
    signal: signal ?? AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EarthPolApiError(`EarthPol API returned HTTP ${response.status}`, {
      status: response.status,
      body
    });
  }

  return response.json();
}

export async function fetchMinecraftProfile(query, { signal } = {}) {
  const response = await fetch(`${PLAYERDB_API_BASE}/${encodeURIComponent(query)}`, {
    headers: { 'accept': 'application/json' },
    signal: signal ?? AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const player = payload?.data?.player;

  if (!player?.username || !player?.id) {
    return null;
  }

  return {
    name: player.username,
    uuid: normalizeUuid(player.id)
  };
}

export async function queryEarthPolPlayers(queries, options) {
  const cleanQueries = [...new Set(
    queries
      .map((query) => String(query ?? '').trim())
      .filter(Boolean)
  )];

  if (cleanQueries.length === 0) {
    return [];
  }

  const payload = await postEarthPol('players', cleanQueries, options);

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((player) => player?.name && player?.uuid)
    .map((player) => ({
      name: String(player.name),
      uuid: normalizeUuid(player.uuid)
    }));
}

export async function queryEarthPolDiscordLink(query, options) {
  const value = String(query ?? '').trim();

  if (!value) {
    return null;
  }

  const payload = await postEarthPol('discord', [value], options);

  if (payload?.discord && payload?.uuid) {
    return {
      discordId: String(payload.discord),
      minecraftUuid: normalizeUuid(payload.uuid)
    };
  }

  return null;
}

export async function queryEarthPolLinkByDiscordId(discordId, options) {
  const mapping = await queryEarthPolDiscordLink(discordId, options);

  if (!mapping) {
    return null;
  }

  const player = await resolveMinecraftPlayer(mapping.minecraftUuid, options);

  if (!player) {
    return null;
  }

  return {
    source: 'epmc',
    discordId: mapping.discordId,
    minecraftName: player.name,
    minecraftUuid: mapping.minecraftUuid
  };
}

export async function queryEarthPolLinkByMinecraftName(minecraftName, options) {
  const player = await resolveMinecraftPlayer(minecraftName, options);

  if (!player) {
    return null;
  }

  const mapping = await queryEarthPolDiscordLink(player.uuid, options);

  if (!mapping) {
    return null;
  }

  return {
    source: 'epmc',
    discordId: mapping.discordId,
    minecraftName: player.name,
    minecraftUuid: player.uuid
  };
}

export async function queryEarthPolLinksByDiscordIds(discordIds, options) {
  const uniqueDiscordIds = [...new Set(
    discordIds
      .map((discordId) => String(discordId ?? '').trim())
      .filter(Boolean)
  )];
  const mappings = [];

  for (let index = 0; index < uniqueDiscordIds.length; index += 5) {
    const chunk = uniqueDiscordIds.slice(index, index + 5);
    const chunkMappings = await Promise.all(
      chunk.map(async (discordId) => queryEarthPolDiscordLink(discordId, options))
    );

    mappings.push(...chunkMappings.filter(Boolean));
  }

  if (mappings.length === 0) {
    return [];
  }

  const players = await queryEarthPolPlayers(mappings.map((mapping) => mapping.minecraftUuid), options);
  const playersByUuid = new Map(players.map((player) => [normalizeUuid(player.uuid), player]));
  const missingUuids = mappings
    .map((mapping) => mapping.minecraftUuid)
    .filter((uuid) => !playersByUuid.has(uuid));

  for (const uuid of missingUuids) {
    const profile = await fetchMinecraftProfile(uuid, options).catch(() => null);

    if (profile) {
      playersByUuid.set(uuid, profile);
    }
  }

  return mappings
    .map((mapping) => {
      const player = playersByUuid.get(mapping.minecraftUuid);

      if (!player) {
        return null;
      }

      return {
        source: 'epmc',
        discordId: mapping.discordId,
        minecraftName: player.name,
        minecraftUuid: mapping.minecraftUuid
      };
    })
    .filter(Boolean);
}

async function resolveMinecraftPlayer(query, options) {
  const profile = await fetchMinecraftProfile(query, options).catch(() => null);

  if (profile) {
    return profile;
  }

  const players = await queryEarthPolPlayers([query], options);
  return players[0] ?? null;
}
