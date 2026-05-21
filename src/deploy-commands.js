import { REST, Routes } from 'discord.js';
import { commandPayloads } from './commands.js';
import { loadConfig, requireDiscordConfig } from './config.js';

const config = loadConfig();
requireDiscordConfig(config);

const rest = new REST({ version: '10' }).setToken(config.token);
const commands = commandPayloads();

if (config.guildId) {
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} guild command(s) for ${config.guildId}.`);
} else {
  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} global command(s).`);
}
