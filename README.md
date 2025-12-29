# Discord Homelab Bot

A Discord bot that reports homelab status, including Docker container uptime, and sends scheduled daily reports.

## What it does

- Responds to commands like `!status`, `!containers`, `!uptime`, and `!restart`.
- Reports running Docker containers and their uptime.
- Sends a scheduled daily status report at 8am (America/New_York).
- Includes external (public) IP in every status report and alerts when it changes.

## Required environment variables

- `DISCORD_TOKEN`: Discord bot token.
- `DISCORD_ALLOWED_CHANNEL_ID`: Channel ID allowed to issue commands (leave empty to allow any channel).
- `DISCORD_ALLOWED_USER_ID`: User ID allowed to issue commands and receive DMs.
- `DISCORD_REPORT_CHANNEL_ID`: Channel ID for scheduled reports (if not set, reports are sent via DM to `DISCORD_ALLOWED_USER_ID`).
- `BOT_STATE_DIR`: Directory for persisted bot state (default: `./data`).
- `TZ`: Timezone for scheduled reports (e.g., `America/New_York`).

## Docker / Portainer usage

This bot needs access to the Docker socket to list and restart containers. For Docker/Portainer deployments, mount the Docker socket and a persistent volume for `/data`:

- `/var/run/docker.sock` → `/var/run/docker.sock`
- `/data` → persistent volume for bot state (external IP history)

### Example docker-compose

```yaml
version: '3.9'
services:
  homelab-discord-bot:
    build: .
    restart: unless-stopped
    environment:
      - DISCORD_TOKEN
      - DISCORD_ALLOWED_CHANNEL_ID
      - DISCORD_ALLOWED_USER_ID
      - DISCORD_REPORT_CHANNEL_ID
      - BOT_STATE_DIR=/data
      - TZ=America/New_York
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
```

## Security note

Mounting `/var/run/docker.sock` grants the container root-level access to the Docker host. Only run this bot in trusted environments and restrict who can issue bot commands.
