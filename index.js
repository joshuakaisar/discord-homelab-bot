import { Client, Events, GatewayIntentBits } from 'discord.js';
import Docker from 'dockerode';
import cron from 'node-cron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Discord bot for the homelab. Real implementations for Docker
// interactions and command responses should be added later.

const token = process.env.DISCORD_TOKEN;
const allowedChannelId = process.env.DISCORD_ALLOWED_CHANNEL_ID;
const allowedUserId = process.env.DISCORD_ALLOWED_USER_ID;
const reportChannelId = process.env.DISCORD_REPORT_CHANNEL_ID;
const stateDir = process.env.BOT_STATE_DIR || path.join(process.cwd(), 'data');
const lastExternalIpPath = path.join(stateDir, 'last_external_ip.txt');

const HELP_TEXT = `Available commands:
!help — Show this help message
!ping — Test bot responsiveness
!status — Show homelab status
!containers — List running containers
!uptime — Show host + container uptime
!ip — Show current homelab IP
!restart <container-name> — Restart a Docker container by name
!stop <container-name> — Stop a Docker container by name
!start <container-name> — Start a Docker container by name`;

if (!token) {
  console.error('DISCORD_TOKEN is required to start the bot.');
  process.exit(1);
}

ensureStateDir(stateDir);

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, () => {
  console.log(`Discord bot logged in as ${client.user?.tag ?? 'unknown user'}`);
  scheduleDailyReport(client);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (allowedChannelId && message.channel.id !== allowedChannelId) return;
  if (allowedUserId && message.author.id !== allowedUserId) return;

  const [command, ...args] = message.content.trim().split(/\s+/);

  switch (command) {
    case '!ping': {
      await message.reply('Hello there! 👋');
      break;
    }
    case '!status': {
      const statusReport = await buildStatusReport();
      const statusMessage = statusReport?.report;
      if (!statusMessage) {
        await message.reply('Unable to read container status right now.');
        return;
      }
      await message.reply(statusMessage);
      if (statusReport?.externalIpChanged) {
        await sendExternalIpChangeAlert(client, statusReport.lastExternalIp, statusReport.externalIp);
      }
      break;
    }
    case '!help': {
      await message.reply(HELP_TEXT);
      break;
    }
    case '!containers': {
      try {
        const containers = await listRunningContainersWithUptime();
        if (containers.length === 0) {
          await message.reply('No running containers found.');
          return;
        }
        const containerList = containers.map((container) => container.name).join('\n');
        await message.reply(containerList);
      } catch (error) {
        console.error('Failed to list running containers.', error);
        await message.reply('Unable to list running containers right now.');
      }
      break;
    }
    case '!uptime': {
      try {
        const hostUptime = formatDuration(os.uptime() * 1000);
        const containers = await listRunningContainersWithUptime();
        const response = `Host uptime: ${hostUptime}\nRunning containers: ${containers.length}`;
        await message.reply(response);
      } catch (error) {
        console.error('Failed to read uptime.', error);
        await message.reply('Unable to read uptime right now.');
      }
      break;
    }
    case '!ip': {
      try {
        const gatewayIp = getGatewayIpAddress();
        await message.reply(`Host IP: ${gatewayIp}`);
      } catch (error) {
        console.error('Failed to read host IP.', error);
        await message.reply('Unable to read host IP right now.');
      }
      break;
    }
    case '!restart': {
      const target = args[0];
      if (!target) {
        await message.reply('Usage: !restart <container-name>');
        return;
      }
      const result = await restartContainer(target);
      await message.reply(result);
      break;
    }
    case '!stop': {
      const target = args[0];
      if (!target) {
        await message.reply('Usage: !stop <container-name>');
        return;
      }
      const result = await stopContainer(target);
      await message.reply(result);
      break;
    }
    case '!start': {
      const target = args[0];
      if (!target) {
        await message.reply('Usage: !start <container-name>');
        return;
      }
      const result = await startContainer(target);
      await message.reply(result);
      break;
    }
    default: {
      // Ignore unknown commands for now.
    }
  }
});

async function buildStatusReport() {
  try {
    const gatewayIp = getGatewayIpAddress();
    const externalIp = await getExternalIpAddress();
    const lastExternalIp = await readLastExternalIp(lastExternalIpPath);
    const externalIpChanged =
      isValidExternalIp(externalIp) &&
      isValidExternalIp(lastExternalIp) &&
      externalIp !== lastExternalIp;
    if (isValidExternalIp(externalIp) && (externalIpChanged || !isValidExternalIp(lastExternalIp))) {
      await writeLastExternalIp(lastExternalIpPath, externalIp);
    }
    const containers = await listRunningContainersWithUptime();
    return {
      report: formatStatusReport(gatewayIp, externalIp, containers),
      externalIp,
      lastExternalIp,
      externalIpChanged,
    };
  } catch (error) {
    console.error('Failed to build status report.', error);
    return null;
  }
}

async function restartContainer(containerName) {
  if (!containerName) {
    return 'Usage: !restart <container-name>';
  }
  try {
    const container = docker.getContainer(containerName);
    await container.restart();
    return `Restarted ${containerName}.`;
  } catch (error) {
    console.error(`Failed to restart container ${containerName}.`, error);
    return `Unable to restart ${containerName} right now.`;
  }
}

async function stopContainer(containerName) {
  if (!containerName) {
    return 'Usage: !stop <container-name>';
  }
  try {
    const container = docker.getContainer(containerName);
    const details = await container.inspect();
    const isRunning = Boolean(details?.State?.Running);
    if (!isRunning) {
      return `${containerName} is already stopped.`;
    }
    await container.stop();
    return `Stopped ${containerName}.`;
  } catch (error) {
    console.error(`Failed to stop container ${containerName}.`, error);
    return `Unable to stop ${containerName} right now.`;
  }
}

async function startContainer(containerName) {
  if (!containerName) {
    return 'Usage: !start <container-name>';
  }
  try {
    const container = docker.getContainer(containerName);
    const details = await container.inspect();
    const isRunning = Boolean(details?.State?.Running);
    if (isRunning) {
      return `${containerName} is already running.`;
    }
    await container.start();
    return `Started ${containerName}.`;
  } catch (error) {
    console.error(`Failed to start container ${containerName}.`, error);
    return `Unable to start ${containerName} right now.`;
  }
}

async function listRunningContainersWithUptime() {
  const summaries = await docker.listContainers({ filters: { status: ['running'] } });
  const inspections = await Promise.all(
    summaries.map(async (summary) => {
      const container = docker.getContainer(summary.Id);
      const details = await container.inspect();
      return {
        name: (details.Name || summary.Names?.[0] || summary.Id).replace(/^\//, ''),
        startedAt: details.State?.StartedAt,
      };
    })
  );

  return inspections
    .map((entry) => ({
      name: entry.name,
      uptime: formatUptime(entry.startedAt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatUptime(startedAt) {
  if (!startedAt) return 'unknown uptime';
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return 'unknown uptime';
  const diffMs = Date.now() - started.getTime();
  return formatDuration(diffMs);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatStatusReport(gatewayIp, externalIp, containers) {
  const header = `📊 **Homelab Status Report**

**Host IP:** \`${gatewayIp}\`
**External IP:** \`${externalIp}\`
**Running containers:** \`${containers.length}\`

**Containers**`;

  const formattedContainers =
    containers.length === 0
      ? ['(no running containers)']
      : containers.map((container) => `${container.name} — ${container.uptime}`);

  const maxLength = 1900;
  const available = maxLength - header.length - 1;
  const lines = [];
  let used = 0;

  for (let index = 0; index < formattedContainers.length; index += 1) {
    const line = formattedContainers[index];
    const lineLength = (lines.length ? 1 : 0) + line.length;
    if (used + lineLength > available) {
      const remaining = formattedContainers.length - index;
      const truncationLine = `…and ${remaining} more`;
      const truncationLength = (lines.length ? 1 : 0) + truncationLine.length;
      if (used + truncationLength <= available) {
        lines.push(truncationLine);
      }
      break;
    }
    lines.push(line);
    used += lineLength;
  }

  return `${header}\n${lines.join('\n')}`;
}

function getGatewayIpAddress() {
  try {
    const routeData = fs.readFileSync('/proc/net/route', 'utf8');
    const lines = routeData.trim().split('\n').slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const destination = parts[1];
      const gateway = parts[2];
      if (destination === '00000000' && gateway) {
        return hexToIp(gateway);
      }
    }
  } catch (error) {
    console.error('Failed to read gateway IP.', error);
  }
  return 'unknown';
}

function hexToIp(hexString) {
  const bytes = [];
  for (let index = 0; index < 8; index += 2) {
    bytes.push(hexString.substring(index, index + 2));
  }
  return bytes
    .map((byte) => parseInt(byte, 16))
    .reverse()
    .join('.');
}

function scheduleDailyReport(discordClient) {
  cron.schedule(
    '0 8 * * *',
    async () => {
      await sendScheduledReport(discordClient);
    },
    { timezone: 'America/New_York' }
  );
}

async function sendScheduledReport(discordClient) {
  const statusReport = await buildStatusReport();
  const statusMessage = statusReport?.report;
  if (!statusMessage) {
    console.error('Skipping scheduled report; status message unavailable.');
    return;
  }

  await sendReportMessage(discordClient, statusMessage);
  if (statusReport?.externalIpChanged) {
    await sendExternalIpChangeAlert(discordClient, statusReport.lastExternalIp, statusReport.externalIp);
  }
}

async function sendExternalIpChangeAlert(discordClient, previousIp, currentIp) {
  if (!isValidExternalIp(previousIp) || !isValidExternalIp(currentIp) || previousIp === currentIp) {
    return;
  }
  const alertMessage = `⚠️ **External IP changed**\n\`${previousIp}\` → \`${currentIp}\``;
  await sendReportMessage(discordClient, alertMessage);
}

async function sendReportMessage(discordClient, message) {
  if (reportChannelId) {
    try {
      const channel = await discordClient.channels.fetch(reportChannelId);
      if (channel?.isTextBased()) {
        await channel.send(message);
        return;
      }
      console.error('Report channel is not text-based.');
    } catch (error) {
      console.error('Failed to send report to channel.', error);
    }
  }

  if (allowedUserId) {
    try {
      const user = await discordClient.users.fetch(allowedUserId);
      await user.send(message);
      return;
    } catch (error) {
      console.error('Failed to send report via DM.', error);
    }
  } else {
    console.error('DISCORD_ALLOWED_USER_ID is missing; cannot send report.');
  }
}

function isValidExternalIp(ipAddress) {
  return Boolean(ipAddress) && ipAddress !== 'unknown';
}

function ensureStateDir(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    console.error(`Failed to ensure state directory at ${directory}.`, error);
  }
}

async function getExternalIpAddress() {
  try {
    const response = await fetch('https://api.ipify.org?format=text');
    if (!response.ok) {
      throw new Error(`Unexpected response ${response.status}`);
    }
    const ipAddress = (await response.text()).trim();
    return ipAddress || 'unknown';
  } catch (error) {
    console.error('Failed to fetch external IP.', error);
    return 'unknown';
  }
}

async function readLastExternalIp(filePath) {
  try {
    const saved = await fs.promises.readFile(filePath, 'utf8');
    const trimmed = saved.trim();
    return trimmed.length ? trimmed : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Failed to read last external IP.', error);
    }
    return null;
  }
}

async function writeLastExternalIp(filePath, ipAddress) {
  try {
    await fs.promises.writeFile(filePath, `${ipAddress}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write last external IP.', error);
  }
}

client
  .login(token)
  .then(() => console.log('Discord bot login initialized.'))
  .catch((error) => console.error('Failed to login to Discord: ', error));
