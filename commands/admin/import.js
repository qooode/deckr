const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');
const https = require('https');
const http = require('http');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('import')
        .setDescription('Import bot data from a JSON file (Admin only)')
        .addAttachmentOption(opt =>
            opt.setName('file').setDescription('JSON file to import').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const attachment = interaction.options.getAttachment('file');

        if (!attachment.name.endsWith('.json')) {
            return interaction.reply({ content: '❌ Please upload a `.json` file.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const jsonString = await new Promise((resolve, reject) => {
                const getter = attachment.url.startsWith('https') ? https : http;
                getter.get(attachment.url, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                    res.on('error', reject);
                }).on('error', reject);
            });

            const data = JSON.parse(jsonString);

            if (!data.cards && !data.inventory && !data.cooldowns && !data.trades) {
                return interaction.editReply({ content: '❌ Invalid file structure. Expected keys: `cards`, `inventory`, `cooldowns`, `trades`.' });
            }

            dm.importAll(data);

            const summary = [];
            if (data.cards?.cards) summary.push(`📇 ${data.cards.cards.length} cards`);
            if (data.inventory?.users) summary.push(`👤 ${Object.keys(data.inventory.users).length} users`);
            if (data.cooldowns?.claims) summary.push(`⏱️ ${Object.keys(data.cooldowns.claims).length} cooldown records`);
            if (data.trades?.pending) summary.push(`🔄 ${data.trades.pending.length} pending trades`);

            return interaction.editReply({
                content: `✅ **Import successful!** A backup of the old data was saved.\n\n${summary.join('\n')}`,
            });
        } catch (err) {
            return interaction.editReply({ content: `❌ Import failed: ${err.message}` });
        }
    },
};
