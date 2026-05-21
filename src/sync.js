import { PermissionFlagsBits } from 'discord.js';
import {
  LINK_SOURCE_KEYS,
  LINK_SOURCES,
  lookupLinkRecords,
  lookupLinkRecordsByDiscordIds
} from './linkProviders.js';

export async function ensureLinkedRole(guild, config) {
  return ensureRole(guild, {
    id: config.linkedRoleId,
    name: config.linkedRoleName,
    create: true,
    reason: 'Linked account role'
  });
}

export async function ensureLinkRoles(guild, config) {
  const linkedRole = await ensureLinkedRole(guild, config);
  const sourceRoles = new Map();

  for (const source of LINK_SOURCE_KEYS) {
    const roleConfig = config[LINK_SOURCES[source].roleConfigKey];
    const role = await ensureRole(guild, {
      id: roleConfig.id,
      name: roleConfig.name,
      create: !roleConfig.id,
      reason: `${LINK_SOURCES[source].displayName} linked account role`
    });

    sourceRoles.set(source, role);
  }

  return { linkedRole, sourceRoles };
}

async function ensureRole(guild, { id, name, create, reason }) {
  if (id) {
    const role = guild.roles.cache.get(id)
      ?? await guild.roles.fetch(id).catch(() => null);

    if (!role) {
      throw new Error(`Could not find role ID ${id}${name ? ` (${name})` : ''}`);
    }

    return role;
  }

  const existingRole = guild.roles.cache.find((role) => role.name === name);

  if (existingRole) {
    return existingRole;
  }

  if (!create) {
    throw new Error(`Could not find role "${name}"`);
  }

  const me = await guild.members.fetchMe();

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error(`Role "${name}" does not exist and the bot cannot create roles`);
  }

  return guild.roles.create({ name, reason });
}

export async function applyLinkedMemberState(
  member,
  records,
  roles,
  { logger = console, removeMissingSourceRoles = false } = {}
) {
  const preferredRecord = preferredNicknameRecord(records);
  const result = {
    discordId: member.id,
    minecraftName: preferredRecord.minecraftName,
    nicknameChanged: false,
    roleAdded: false,
    sourceRolesAdded: 0,
    sourceRolesRemoved: 0,
    warnings: []
  };

  if (!member.manageable) {
    result.warnings.push('member is above the bot in the role hierarchy');
  } else if (member.nickname !== preferredRecord.minecraftName) {
    try {
      await member.setNickname(preferredRecord.minecraftName, 'Linked Minecraft username sync');
      result.nicknameChanged = true;
    } catch (error) {
      result.warnings.push(`nickname update failed: ${error.message}`);
      logger.warn(`Failed to update nickname for ${member.id}:`, error);
    }
  }

  result.roleAdded = await addRole(member, roles.linkedRole, 'Linked account sync', logger);

  const linkedSources = new Set(records.map((record) => record.source));

  for (const source of linkedSources) {
    const sourceRole = roles.sourceRoles.get(source);

    if (!sourceRole) {
      continue;
    }

    const added = await addRole(
      member,
      sourceRole,
      `${LINK_SOURCES[source]?.displayName ?? source} linked account sync`,
      logger
    );

    if (added) {
      result.sourceRolesAdded += 1;
    }
  }

  if (removeMissingSourceRoles) {
    for (const [source, sourceRole] of roles.sourceRoles.entries()) {
      if (linkedSources.has(source)) {
        continue;
      }

      const removed = await removeRole(
        member,
        sourceRole,
        `${LINK_SOURCES[source]?.displayName ?? source} account no longer linked`,
        logger
      );

      if (removed) {
        result.sourceRolesRemoved += 1;
      }
    }
  }

  return result;
}

export async function removeLinkedRole(member, role, logger = console) {
  return removeRole(member, role, 'Account no longer linked', logger);
}

export async function removeLinkedRoles(member, roles, logger = console) {
  let removed = 0;

  if (await removeRole(member, roles.linkedRole, 'Account no longer linked', logger)) {
    removed += 1;
  }

  for (const sourceRole of roles.sourceRoles.values()) {
    if (await removeRole(member, sourceRole, 'Account no longer linked', logger)) {
      removed += 1;
    }
  }

  return removed;
}

export async function syncMember(member, { store, config, roles, logger = console }) {
  if (member.user.bot && !config.syncBots) {
    return { status: 'skipped_bot', discordId: member.id };
  }

  const lookup = await lookupLinkRecords(member.id, { logger });

  if (lookup.records.length === 0) {
    if (config.syncRemoveUnlinked && lookup.errors.length === 0 && roles) {
      await removeLinkedRoles(member, roles, logger);
    }

    return {
      status: lookup.errors.length > 0 ? 'lookup_failed' : 'unlinked',
      discordId: member.id,
      errors: lookup.errors
    };
  }

  const linkRoles = roles ?? await ensureLinkRoles(member.guild, config);
  const records = await store.upsertRecords(lookup.records);
  const applied = await applyLinkedMemberState(member, records, linkRoles, {
    logger,
    removeMissingSourceRoles: config.syncRemoveUnlinked && lookup.errors.length === 0
  });

  return {
    status: 'linked',
    records,
    applied
  };
}

export async function syncGuild(guild, { store, config, logger = console }) {
  const roles = await ensureLinkRoles(guild, config);
  const members = await guild.members.fetch();
  const syncableMembers = [...members.values()].filter((member) => (
    config.syncBots || !member.user.bot
  ));
  const batchSize = Math.max(1, config.syncBatchSize);
  const summary = {
    checked: syncableMembers.length,
    linked: 0,
    emcLinked: 0,
    epmcLinked: 0,
    nicknamesChanged: 0,
    rolesAdded: 0,
    sourceRolesAdded: 0,
    warnings: 0
  };

  for (let index = 0; index < syncableMembers.length; index += batchSize) {
    const batch = syncableMembers.slice(index, index + batchSize);
    const lookup = await lookupLinkRecordsByDiscordIds(batch.map((member) => member.id), { logger });
    const records = await store.upsertRecords(lookup.records);
    const recordsByDiscordId = groupRecordsByDiscordId(records);
    const canRemoveMissing = config.syncRemoveUnlinked && lookup.errors.length === 0;

    for (const member of batch) {
      const memberRecords = recordsByDiscordId.get(member.id) ?? [];

      if (memberRecords.length === 0) {
        if (canRemoveMissing) {
          await removeLinkedRoles(member, roles, logger);
        }

        continue;
      }

      const linkedSources = new Set(memberRecords.map((record) => record.source));
      summary.linked += 1;
      summary.emcLinked += linkedSources.has('emc') ? 1 : 0;
      summary.epmcLinked += linkedSources.has('epmc') ? 1 : 0;

      const applied = await applyLinkedMemberState(member, memberRecords, roles, {
        logger,
        removeMissingSourceRoles: canRemoveMissing
      });

      if (applied.nicknameChanged) {
        summary.nicknamesChanged += 1;
      }

      if (applied.roleAdded) {
        summary.rolesAdded += 1;
      }

      summary.sourceRolesAdded += applied.sourceRolesAdded;
      summary.warnings += applied.warnings.length;
    }
  }

  return summary;
}

async function addRole(member, role, reason, logger) {
  if (member.roles.cache.has(role.id)) {
    return false;
  }

  try {
    await member.roles.add(role, reason);
    return true;
  } catch (error) {
    logger.warn(`Failed to add role ${role.id} for ${member.id}:`, error);
    return false;
  }
}

async function removeRole(member, role, reason, logger) {
  if (!member.roles.cache.has(role.id)) {
    return false;
  }

  try {
    await member.roles.remove(role, reason);
    return true;
  } catch (error) {
    logger.warn(`Failed to remove role ${role.id} from ${member.id}:`, error);
    return false;
  }
}

function preferredNicknameRecord(records) {
  return records.find((record) => record.source === 'emc') ?? records[0];
}

function groupRecordsByDiscordId(records) {
  const grouped = new Map();

  for (const record of records) {
    const current = grouped.get(record.discordId) ?? [];
    current.push(record);
    grouped.set(record.discordId, current);
  }

  return grouped;
}
