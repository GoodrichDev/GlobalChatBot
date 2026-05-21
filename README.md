# GlobalChatBot

Node.js Discord bot for EarthMC and EarthPol account linking.

## Features

- Looks up EarthMC player links through `POST https://api.earthmc.net/v4/players`.
- Looks up EarthPol/EPMC player links through `POST https://api.earthpol.com/astra/discord`.
- Stores linked Discord ID, Minecraft username, Minecraft UUID, and source in `data/links.json`.
- `/discord linked` checks local storage first, then EarthMC and EarthPol.
- Syncs linked users by setting their server nickname to their Minecraft username and assigning a generic `Linked` role.
- Assigns source-specific roles: `Linked By EMC` and `Linked By EPMC`.
- Runs sync on startup, on member join, and on an optional interval.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable the bot's **Server Members Intent**.
3. Invite the bot with `bot` and `applications.commands` scopes.
4. Give the bot **Manage Nicknames** and **Manage Roles** permissions.
5. Keep the bot's highest role above `Linked`, `Linked By EMC`, and `Linked By EPMC`.
6. Install dependencies:

```bash
npm install
```

7. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optionally `DISCORD_GUILD_ID`.
8. Register slash commands:

```bash
npm run deploy:commands
```

9. Start the bot:

```bash
npm start
```

## Commands

`/discord linked minecraft:<username>`

`/discord linked user:<Discord user>`

Looks up links locally first. On a cache miss it queries EarthMC and EarthPol, then saves linked results. Provide exactly one of `minecraft` or `user`.

`/discord sync [member]`

Syncs your own member record, or a selected member when the command user has **Manage Server**. This command updates nickname and roles when either provider reports a link. If both providers are linked, the EarthMC name is preferred for the nickname.

`/discord sync-guild`

Requires **Manage Server**. Fetches guild members, queries EarthMC and EarthPol by Discord ID, caches links, and applies nicknames plus linked roles.

## API Notes

EarthMC API v4 is documented at https://earthmc.net/docs/api. The old Discord endpoint has been merged into the players endpoint, and player queries can use Minecraft UUIDs, Minecraft usernames, or linked Discord IDs.

EarthPol API docs are at https://earthpol.com/docs/api. Its Discord link endpoint is `POST https://api.earthpol.com/astra/discord`; username lookup is resolved through Minecraft UUID before checking this endpoint.
