import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits
} from 'discord.js';
import { canManageGuild } from './commands.js';
import { loadConfig, requireDiscordConfig } from './config.js';
import {
  LINK_SOURCE_KEYS,
  lookupLinkRecords,
  sourceLabel
} from './linkProviders.js';
import { LinkStore } from './linkStore.js';
import { ensureLinkRoles, syncGuild, syncMember } from './sync.js';

const config = loadConfig();
requireDiscordConfig(config);

const store = new LinkStore(config.linkStorePath);
await store.load();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);

  if (config.syncOnReady) {
    await syncConfiguredGuilds('startup');
  }

  if (config.syncIntervalMinutes > 0) {
    setInterval(() => {
      syncConfiguredGuilds('interval').catch((error) => {
        console.error('Scheduled sync failed:', error);
      });
    }, config.syncIntervalMinutes * 60 * 1000);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const roles = await ensureLinkRoles(member.guild, config);
    const result = await syncMember(member, { store, config, roles });

    if (result.status === 'linked') {
      console.log(`Synced linked member ${member.id} -> ${result.records.map((record) => record.minecraftName).join(', ')}.`);
    }
  } catch (error) {
    console.error(`Failed to sync joining member ${member.id}:`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'discord') {
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === 'linked') {
      await handleLinkedCommand(interaction);
      return;
    }

    if (subcommand === 'sync') {
      await handleSyncCommand(interaction);
      return;
    }

    if (subcommand === 'sync-guild') {
      await handleSyncGuildCommand(interaction);
    }
  } catch (error) {
    console.error(`Command /discord ${subcommand} failed:`, error);

    const message = 'That command failed while talking to Discord or EarthMC. Check the bot logs for details.';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

async function handleLinkedCommand(interaction) {
  const minecraftName = interaction.options.getString('minecraft');
  const discordUser = interaction.options.getUser('user');

  if ((!minecraftName && !discordUser) || (minecraftName && discordUser)) {
    await interaction.reply({
      content: 'Provide exactly one of `minecraft` or `user`.',
      ephemeral: true
    });
    return;
  }

  const lookupValue = discordUser?.id ?? minecraftName;
  const lookupLabel = discordUser ? `<@${discordUser.id}>` : `\`${minecraftName}\``;

  await interaction.deferReply();

  const localRecords = store.findAll(lookupValue);
  const localSources = new Set(localRecords.map((record) => record.source));
  const missingSources = LINK_SOURCE_KEYS.filter((source) => !localSources.has(source));
  const lookup = missingSources.length > 0
    ? await lookupLinkRecords(lookupValue, { sources: missingSources })
    : { records: [], errors: [] };
  const apiRecords = await store.upsertRecords(lookup.records);
  const records = mergeRecords(localRecords, apiRecords);

  if (records.length === 0) {
    const errorSuffix = lookup.errors.length > 0
      ? ` One or more providers failed: ${lookup.errors.map(({ source }) => sourceLabel(source)).join(', ')}.`
      : '';
    await interaction.editReply(`No linked EarthMC or EarthPol account was found for ${lookupLabel}.${errorSuffix}`);
    return;
  }

  await interaction.editReply({
    embeds: [linksEmbedFromRecords(records, localRecords.length > 0 ? 'Local cache + API' : 'API')]
  });
}

async function handleSyncCommand(interaction) {
  const requestedUser = interaction.options.getUser('member') ?? interaction.user;
  const isSelf = requestedUser.id === interaction.user.id;

  if (!isSelf && !canManageGuild(interaction.member)) {
    await interaction.reply({
      content: 'You need Manage Server to sync another member.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(requestedUser.id).catch(() => null);

  if (!member) {
    await interaction.editReply('That user is not a member of this server.');
    return;
  }

  const roles = await ensureLinkRoles(interaction.guild, config);
  const result = await syncMember(member, { store, config, roles });

  if (result.status === 'linked') {
    const changes = [];

    if (result.applied.nicknameChanged) {
      changes.push('nickname updated');
    }

    if (result.applied.roleAdded) {
      changes.push('role assigned');
    }

    if (result.applied.sourceRolesAdded > 0) {
      changes.push(`${result.applied.sourceRolesAdded} source role(s) assigned`);
    }

    await interaction.editReply(
      `Synced <@${member.id}> to ${formatRecordsForText(result.records)}${changes.length ? ` (${changes.join(', ')})` : ''}.`
    );
    return;
  }

  if (result.status === 'skipped_bot') {
    await interaction.editReply('Bot users are skipped by the current sync settings.');
    return;
  }

  if (result.status === 'lookup_failed') {
    await interaction.editReply(`Could not verify <@${member.id}> because one or more providers failed.`);
    return;
  }

  await interaction.editReply(`No linked EarthMC or EarthPol account was found for <@${member.id}>.`);
}

async function handleSyncGuildCommand(interaction) {
  if (!canManageGuild(interaction.member)) {
    await interaction.reply({
      content: 'You need Manage Server to sync the whole guild.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const summary = await syncGuild(interaction.guild, { store, config });

  await interaction.editReply(
    `Checked ${summary.checked} member(s), found ${summary.linked} linked account(s) (${summary.emcLinked} EMC, ${summary.epmcLinked} EPMC), changed ${summary.nicknamesChanged} nickname(s), assigned ${summary.rolesAdded} Linked role(s), and assigned ${summary.sourceRolesAdded} source role(s).`
  );
}

async function syncConfiguredGuilds(reason) {
  const guilds = config.guildId
    ? [await client.guilds.fetch(config.guildId)]
    : [...client.guilds.cache.values()];

  for (const guild of guilds) {
    try {
      console.log(`Starting ${reason} sync for ${guild.name} (${guild.id}).`);
      const summary = await syncGuild(guild, { store, config });
      console.log(`Finished ${reason} sync for ${guild.id}:`, summary);
    } catch (error) {
      console.error(`Failed ${reason} sync for ${guild.id}:`, error);
    }
  }
}

function linksEmbedFromRecords(records, source) {
  return new EmbedBuilder()
    .setTitle(records.length === 1 ? 'Linked Account' : 'Linked Accounts')
    .setColor(0x2f855a)
    .addFields(records.map((record) => ({
      name: sourceLabel(record.source),
      value: [
        `Discord: <@${record.discordId}> (\`${record.discordId}\`)`,
        `Minecraft: \`${record.minecraftName}\``,
        `UUID: \`${record.minecraftUuid}\``,
        `Cached: <t:${Math.floor(new Date(record.updatedAt).getTime() / 1000)}:R>`
      ].join('\n')
    })))
    .setFooter({ text: source });
}

function mergeRecords(...recordGroups) {
  const records = [];
  const seen = new Set();

  for (const group of recordGroups) {
    for (const record of group) {
      const key = `${record.source}:${record.discordId}:${record.minecraftUuid}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      records.push(record);
    }
  }

  return records;
}

function formatRecordsForText(records) {
  return records
    .map((record) => `\`${record.minecraftName}\` (${sourceLabel(record.source)})`)
    .join(', ');
}

await client.login(config.token);
