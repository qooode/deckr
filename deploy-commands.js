const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { config, validate } = require('./utils/config');

// Validate config
validate();

const commands = [];

function loadCommands(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            loadCommands(fullPath);
        } else if (entry.name.endsWith('.js')) {
            const command = require(fullPath);
            if (command.data) {
                commands.push(command.data.toJSON());
            }
        }
    }
}

loadCommands(path.join(__dirname, 'commands'));

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        console.log(`🔄 Registering ${commands.length} slash commands to guild ${config.guildId}...`);

        const data = await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands },
        );

        console.log(`✅ Successfully registered ${data.length} commands!`);
        console.log('Commands:', data.map(c => `/${c.name}`).join(', '));
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();
