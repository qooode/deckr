const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { config, validate } = require('./utils/config');

// Validate config before anything else
validate();

// ---------- Create Client ----------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

// ---------- Load Commands ----------

client.commands = new Collection();

function loadCommands(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            loadCommands(fullPath);
        } else if (entry.name.endsWith('.js')) {
            const command = require(fullPath);
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command);
                console.log(`  ✅ Loaded command: /${command.data.name}`);
            }
        }
    }
}

console.log('');
console.log('╔═══════════════════════════════════╗');
console.log('║        🃏 DECKR BOT               ║');
console.log('╚═══════════════════════════════════╝');
console.log('');
console.log('📦 Loading commands...');
loadCommands(path.join(__dirname, 'commands'));

// ---------- Event: Ready ----------

client.once(Events.ClientReady, (c) => {
    console.log('');
    console.log(`🤖 Online as ${c.user.tag}`);
    console.log(`📇 ${client.commands.size} commands loaded`);
    console.log(`👑 Admin IDs: ${config.adminIds.join(', ')}`);
    console.log(`⏱️  Claim cooldown: ${config.claimCooldownMinutes} minutes`);
    console.log(`🏠 Guild: ${config.guildId}`);
    console.log('');
    console.log('🟢 Deckr is ready!');
    console.log('');
});

// ---------- Event: Interaction ----------

client.on(Events.InteractionCreate, async (interaction) => {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.autocomplete) return;
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(`❌ Autocomplete error for /${interaction.commandName}:`, error);
        }
        return;
    }

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`❌ Error executing /${interaction.commandName}:`, error);
            const reply = { content: '❌ Something went wrong executing that command.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply).catch(() => { });
            } else {
                await interaction.reply(reply).catch(() => { });
            }
        }
    }
});

// ---------- Login ----------

client.login(config.token);
