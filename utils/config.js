const fs = require('fs');
const path = require('path');

// Load config.json as fallback defaults (for local development)
let fileConfig = {};
const configPath = path.join(__dirname, '..', 'config.json');
try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
    // No config.json — that's fine, we'll use env vars
}

// Environment variables take priority over config.json
const config = {
    token: process.env.DISCORD_TOKEN || fileConfig.token || '',
    clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId || '',
    guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId || '',
    adminIds: process.env.DISCORD_ADMIN_IDS
        ? process.env.DISCORD_ADMIN_IDS.split(',').map(id => id.trim())
        : fileConfig.adminIds || [],
    claimCooldownMinutes: parseInt(process.env.CLAIM_COOLDOWN_MINUTES || fileConfig.claimCooldownMinutes || 1440, 10),
    rarityWeights: fileConfig.rarityWeights || {
        common: 50,
        uncommon: 30,
        rare: 15,
        epic: 4,
        legendary: 1,
    },
    rarityColors: fileConfig.rarityColors || {
        common: '#9e9e9e',
        uncommon: '#4caf50',
        rare: '#2196f3',
        epic: '#9c27b0',
        legendary: '#ff9800',
    },
    rarityEmojis: fileConfig.rarityEmojis || {
        common: '⚪',
        uncommon: '🟢',
        rare: '🔵',
        epic: '🟣',
        legendary: '🟡',
    },
};

// Validate required fields
function validate() {
    const missing = [];
    if (!config.token) missing.push('DISCORD_TOKEN');
    if (!config.clientId) missing.push('DISCORD_CLIENT_ID');
    if (!config.guildId) missing.push('DISCORD_GUILD_ID');
    if (config.adminIds.length === 0) missing.push('DISCORD_ADMIN_IDS');
    if (missing.length > 0) {
        console.error(`\n❌ Missing required configuration: ${missing.join(', ')}`);
        console.error('Set them as environment variables or in config.json\n');
        process.exit(1);
    }
}

// Update cooldown at runtime (called by /setcooldown)
function setCooldown(minutes) {
    config.claimCooldownMinutes = minutes;
    // Also persist to config.json if it exists
    try {
        const current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        current.claimCooldownMinutes = minutes;
        fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf-8');
    } catch {
        // Running without config.json (Docker), just keep in memory
    }
}

module.exports = { config, validate, setCooldown };
