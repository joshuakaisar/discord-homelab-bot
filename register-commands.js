import { REST, Routes, SlashCommandBuilder } from 'discord.js';

// Environment variables:
// DISCORD_TOKEN (required)
// DISCORD_CLIENT_ID (required)
// DISCORD_GUILD_ID (required for guild-scoped registration)
// DISCORD_REGISTER_GLOBAL (optional, set to 'true' for global registration)

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Show available commands'),
  new SlashCommandBuilder().setName('ping').setDescription('Test bot responsiveness'),
  new SlashCommandBuilder().setName('status').setDescription('Show homelab status'),
  new SlashCommandBuilder().setName('containers').setDescription('List running containers'),
  new SlashCommandBuilder().setName('uptime').setDescription('Show host + container uptime'),
  new SlashCommandBuilder().setName('ip').setDescription('Show current homelab IP'),
  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart a Docker container by name')
    .addStringOption((option) =>
      option.setName('container').setDescription('Container name').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop a Docker container by name')
    .addStringOption((option) =>
      option.setName('container').setDescription('Container name').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start a Docker container by name')
    .addStringOption((option) =>
      option.setName('container').setDescription('Container name').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Show recent Docker logs')
    .addStringOption((option) =>
      option.setName('container').setDescription('Container name').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('lines')
        .setDescription('Number of log lines (max 50)')
        .setMinValue(1)
        .setMaxValue(50)
    ),
];

export async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const registerGlobal = process.env.DISCORD_REGISTER_GLOBAL === 'true';

  if (!token) {
    throw new Error('DISCORD_TOKEN is required to register commands.');
  }
  if (!clientId) {
    throw new Error('DISCORD_CLIENT_ID is required to register commands.');
  }
  if (!registerGlobal && !guildId) {
    throw new Error('DISCORD_GUILD_ID is required for guild command registration.');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const route = registerGlobal
    ? Routes.applicationCommands(clientId)
    : Routes.applicationGuildCommands(clientId, guildId);
  const body = commands.map((command) => command.toJSON());

  await rest.put(route, { body });

  return {
    count: body.length,
    scope: registerGlobal ? 'global' : `guild ${guildId}`,
  };
}
