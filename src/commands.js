import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

export function buildDiscordCommand() {
  return new SlashCommandBuilder()
    .setName('discord')
    .setDescription('Discord and Minecraft linking tools')
    .setDMPermission(false)
    .addSubcommand((subcommand) => (
      subcommand
        .setName('linked')
        .setDescription('Look up a linked Discord or Minecraft account')
        .addStringOption((option) => (
          option
            .setName('minecraft')
            .setDescription('Minecraft username')
            .setMinLength(1)
            .setMaxLength(16)
            .setRequired(false)
        ))
        .addUserOption((option) => (
          option
            .setName('user')
            .setDescription('Discord user')
            .setRequired(false)
        ))
    ))
    .addSubcommand((subcommand) => (
      subcommand
        .setName('sync')
        .setDescription('Sync a linked member nickname and role')
        .addUserOption((option) => (
          option
            .setName('member')
            .setDescription('Member to sync; requires Manage Server when not yourself')
            .setRequired(false)
        ))
    ))
    .addSubcommand((subcommand) => (
      subcommand
        .setName('sync-guild')
        .setDescription('Sync all linked members in this server')
    ));
}

export function commandPayloads() {
  return [buildDiscordCommand().toJSON()];
}

export function canManageGuild(member) {
  const permissions = member?.permissions;

  if (!permissions) {
    return false;
  }

  if (typeof permissions.has === 'function') {
    return permissions.has(PermissionFlagsBits.ManageGuild);
  }

  return (BigInt(permissions) & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
}
