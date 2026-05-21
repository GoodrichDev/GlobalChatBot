const EARTHMC_API_BASE = 'https://api.earthmc.net/v4';

export class EarthMcApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'EarthMcApiError';
    this.status = status;
    this.body = body;
  }
}

export function normalizeDiscordId(query) {
  const value = String(query ?? '').trim();
  const mentionMatch = value.match(/^<@!?(\d{16,22})>$/);

  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d{16,22}$/.test(value) ? value : null;
}

export function normalizeMinecraftName(query) {
  const value = String(query ?? '').trim();
  return /^[A-Za-z0-9_]{1,16}$/.test(value) ? value : null;
}

export function normalizeLookupQuery(query) {
  const discordId = normalizeDiscordId(query);

  if (discordId) {
    return { type: 'discord', value: discordId };
  }

  const minecraftName = normalizeMinecraftName(query);

  if (minecraftName) {
    return { type: 'minecraft', value: minecraftName };
  }

  return { type: 'unknown', value: String(query ?? '').trim() };
}

export async function queryPlayers(queries, { signal } = {}) {
  const cleanQueries = [...new Set(
    queries
      .map((query) => String(query ?? '').trim())
      .filter(Boolean)
  )];

  if (cleanQueries.length === 0) {
    return [];
  }

  const response = await fetch(`${EARTHMC_API_BASE}/players`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({
      query: cleanQueries,
      template: {
        name: true,
        uuid: true,
        discord: true
      }
    }),
    signal: signal ?? AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EarthMcApiError(`EarthMC API returned HTTP ${response.status}`, {
      status: response.status,
      body
    });
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    throw new EarthMcApiError('EarthMC API returned an unexpected response shape', {
      body: JSON.stringify(payload)
    });
  }

  return payload;
}

export async function queryOnePlayer(query, options) {
  const players = await queryPlayers([query], options);
  return players[0] ?? null;
}

export function playerHasDiscordLink(player) {
  return Boolean(player?.name && player?.uuid && player?.discord);
}
