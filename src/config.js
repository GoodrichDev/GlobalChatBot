import 'dotenv/config';
import path from 'node:path';

function boolEnv(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intEnv(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function loadConfig() {
  const token = optionalEnv('DISCORD_TOKEN');
  const clientId = optionalEnv('DISCORD_CLIENT_ID');
  const guildId = optionalEnv('DISCORD_GUILD_ID');

  return {
    token,
    clientId,
    guildId,
    linkedRoleId: optionalEnv('LINKED_ROLE_ID'),
    linkedRoleName: optionalEnv('LINKED_ROLE_NAME') ?? 'Linked',
    linkedByEmcRole: {
      id: optionalEnv('LINKED_BY_EMC_ROLE_ID') ?? '1507128585633140927',
      name: optionalEnv('LINKED_BY_EMC_ROLE_NAME') ?? 'Linked By EMC'
    },
    linkedByEpmcRole: {
      id: optionalEnv('LINKED_BY_EPMC_ROLE_ID') ?? '1507128672606228681',
      name: optionalEnv('LINKED_BY_EPMC_ROLE_NAME') ?? 'Linked By EPMC'
    },
    linkStorePath: path.resolve(optionalEnv('LINK_STORE_PATH') ?? 'data/links.json'),
    syncOnReady: boolEnv('SYNC_ON_READY', true),
    syncIntervalMinutes: intEnv('SYNC_INTERVAL_MINUTES', 360),
    syncBatchSize: intEnv('SYNC_BATCH_SIZE', 50),
    syncBots: boolEnv('SYNC_BOTS', false),
    syncRemoveUnlinked: boolEnv('SYNC_REMOVE_UNLINKED', false)
  };
}

export function requireDiscordConfig(config) {
  const missing = [];

  if (!config.token) {
    missing.push('DISCORD_TOKEN');
  }

  if (!config.clientId) {
    missing.push('DISCORD_CLIENT_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}
