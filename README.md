# 🃏 Deckr

A Discord bot for dropping, claiming, collecting, and trading cards. Admin-controlled card creation with image-based cards, weighted rarity system, daily claims, first-come-first-served drops, trading, and leaderboards.

## Features

- **🎴 Card Drops** — Admin drops cards in any channel, first person to click claims it
- **🎲 Daily Claims** — Users can claim a random card once per day (configurable cooldown)
- **📦 Inventories** — Paginated card collections with duplicate stacking
- **🔄 Trading** — Propose card trades with accept/decline buttons and ownership validation
- **🏆 Leaderboard** — Ranked by rarity score with collection completion %
- **📤 Export/Import** — Full JSON data backup and restore with auto-backups
- **⚡ Slash Commands** — Full autocomplete support, Discord-native UX
- **🐳 Docker Ready** — One-command deploy with persistent data volumes

---

## Commands

### 👑 Admin Commands

| Command | Description |
|---|---|
| `/createcard <name> <rarity> <series> <image_url>` | Create a new card |
| `/deletecard <card>` | Delete a card (autocomplete, optional inventory purge) |
| `/listcards [rarity]` | List all cards with optional rarity filter |
| `/drop <channel> [card]` | Drop a card — first to click claims it |
| `/setcooldown <minutes>` | Change claim cooldown (default: 1440 = 24h) |
| `/export` | Get all bot data as JSON file in DMs |
| `/import <file>` | Upload a JSON file to restore data |

### 🎮 User Commands

| Command | Description |
|---|---|
| `/claim` | Claim a random card (respects cooldown) |
| `/inventory [@user]` | View card collection (paginated) |
| `/view <card>` | View card details, owners, and stats |
| `/leaderboard` | View collection rankings |
| `/trade <@user> <your_card> <their_card>` | Propose a trade |

---

## Rarity System

| Rarity | Weight | Score | Emoji |
|---|---|---|---|
| Common | 50 | 1 pt | ⚪ |
| Uncommon | 30 | 2 pts | 🟢 |
| Rare | 15 | 5 pts | 🔵 |
| Epic | 4 | 10 pts | 🟣 |
| Legendary | 1 | 25 pts | 🟡 |

Higher weight = more likely to appear in random claims. Rarity score determines leaderboard ranking.

---

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it **Deckr** (or whatever you like)
3. Go to the **Bot** tab:
   - Click **Reset Token** → copy it (you'll need this as `DISCORD_TOKEN`)
   - Under **Privileged Gateway Intents**, you don't need any special intents
4. Generate an invite link:
   - Go to **OAuth2 → URL Generator**
   - Check scopes: `bot`, `applications.commands`
   - Check bot permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use Slash Commands`
   - Copy the generated URL and open it to invite the bot to your server
5. **Get your User ID**: In Discord, enable Developer Mode (*Settings → Advanced → Developer Mode*), then right-click yourself → **Copy User ID**

> 💡 The bot automatically extracts the Client ID from the token — you don't need to copy it separately.

---

### 2a. Run Locally

```bash
# Clone/download the project
cd deckr

# Install dependencies
npm install

# Create config file
cp .env.example .env
# Edit .env with your values (or create config.json — see below)

# Deploy slash commands + start bot
npm run dev
```

**Option A: Using `.env` file:**
```env
DISCORD_TOKEN=your-bot-token
DISCORD_ADMIN_IDS=your-user-id
```

> ⚠️ For `.env` to work locally, install dotenv: `npm install dotenv` and add `require('dotenv').config()` at the top of `bot.js` and `deploy-commands.js`. Or just use `config.json` for local development.

**Option B: Using `config.json` (recommended for local dev):**
```json
{
  "token": "your-bot-token",
  "adminIds": ["your-user-id"],
  "claimCooldownMinutes": 1440,
  "rarityWeights": {
    "common": 50,
    "uncommon": 30,
    "rare": 15,
    "epic": 4,
    "legendary": 1
  },
  "rarityColors": {
    "common": "#9e9e9e",
    "uncommon": "#4caf50",
    "rare": "#2196f3",
    "epic": "#9c27b0",
    "legendary": "#ff9800"
  },
  "rarityEmojis": {
    "common": "⚪",
    "uncommon": "🟢",
    "rare": "🔵",
    "epic": "🟣",
    "legendary": "🟡"
  }
}
```

```bash
# Deploy commands (run once, or when you add new commands)
npm run deploy

# Start the bot
npm start

# Or both at once
npm run dev
```

---

### 2b. Run with Docker

```bash
# Build image
docker build -t deckr .

# Run with environment variables
docker run -d \
  --name deckr \
  --restart unless-stopped \
  -e DISCORD_TOKEN=your-bot-token \
  -e DISCORD_ADMIN_IDS=your-user-id \
  -v deckr-data:/app/data \
  deckr
```

Or with **Docker Compose**:

```bash
# Copy and fill in environment variables
cp .env.example .env
nano .env  # fill in your values

# Start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

---

### 2c. Deploy on Coolify

#### Option 1: Docker Compose (Recommended)

1. In Coolify, create a new **Service** → Choose **Docker Compose**
2. Connect your Git repository (GitHub/GitLab/etc.)
3. Coolify will detect the `docker-compose.yml` automatically
4. Go to the **Environment Variables** tab and add:

   | Variable | Required | Value |
   |---|---|---|
   | `DISCORD_TOKEN` | ✅ | Your bot token |
   | `DISCORD_ADMIN_IDS` | ✅ | Your user ID (comma-separated for multiple) |
   | `DISCORD_CLIENT_ID` | ❌ | Auto-extracted from token |
   | `DISCORD_GUILD_ID` | ❌ | Your server ID (if set, commands appear instantly) |
   | `CLAIM_COOLDOWN_MINUTES` | ❌ | Default `1440` (24h) |

5. Under **Storages**, Coolify will automatically create a persistent volume for `deckr-data`. This is where your cards, inventories, and all data are stored.
6. Click **Deploy** 🚀

#### Option 2: Dockerfile

1. In Coolify, create a new **Application**
2. Connect your Git repository
3. Set **Build Pack** to **Dockerfile**
4. Coolify will detect the `Dockerfile` automatically
5. Go to **Environment Variables** and add the same variables as above
6. Go to **Storages** → Add a new volume mount:
   - **Source**: Create a named volume (e.g., `deckr-data`)
   - **Destination**: `/app/data`
7. Click **Deploy** 🚀

#### Coolify Tips

- **Persistent Data**: The `/app/data` volume contains all your bot data (cards, inventories, cooldowns, trades). As long as you keep this volume, your data survives redeployments and container restarts.
- **Backups**: Use the `/export` command before redeployments as an extra safety net. Or back up the volume directly from Coolify's storage settings.
- **Logs**: Check the deployment logs in Coolify to verify the bot started successfully. You should see the Deckr banner and "🟢 Deckr is ready!"
- **Updates**: Push code changes to your Git repo → click Redeploy in Coolify. Your data is safe in the volume.
- **Multiple Admins**: Set `DISCORD_ADMIN_IDS=id1,id2,id3` to allow multiple admins.

---

## Migration / Hosting Transfer

Moving Deckr to a different server or host:

1. **Export data**: Run `/export` in Discord — the bot will DM you a JSON file with everything
2. **Deploy** on the new host (Coolify, Docker, or bare metal)
3. **Import data**: Run `/import` and attach the JSON file
4. Done! All cards, inventories, and trades are restored.

Alternatively, if you have direct volume access, copy the `data/` directory between hosts.

---

## Project Structure

```
deckr/
├── bot.js                    # Main entry point
├── deploy-commands.js        # Slash command registration
├── docker-compose.yml        # Docker Compose config
├── Dockerfile                # Container build
├── docker-entrypoint.sh      # Container startup script
├── .env.example              # Environment variable template
├── config.json               # Local dev config (gitignored)
├── data/
│   ├── cards.json            # Card definitions
│   ├── inventory.json        # User inventories
│   ├── cooldowns.json        # Claim cooldown tracking
│   ├── trades.json           # Pending trades
│   └── backups/              # Auto-backups before imports
├── commands/
│   ├── admin/
│   │   ├── createcard.js     # /createcard
│   │   ├── deletecard.js     # /deletecard
│   │   ├── listcards.js      # /listcards
│   │   ├── drop.js           # /drop
│   │   ├── setcooldown.js    # /setcooldown
│   │   ├── export.js         # /export
│   │   └── import.js         # /import
│   └── user/
│       ├── claim.js          # /claim
│       ├── inventory.js      # /inventory
│       ├── view.js           # /view
│       ├── leaderboard.js    # /leaderboard
│       └── trade.js          # /trade
└── utils/
    ├── config.js             # Centralized config (env vars + config.json fallback)
    └── dataManager.js        # All JSON data operations
```

---

## License

MIT
