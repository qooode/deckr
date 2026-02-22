const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export')
        .setDescription('📤 Export all bot data as JSON (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const allData = dm.exportAll();
        const jsonString = JSON.stringify(allData, null, 2);
        const buffer = Buffer.from(jsonString, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `deckr_export_${Date.now()}.json` });

        try {
            await interaction.user.send({
                content: '📤 **Deckr Data Export**\nHere is your full data export. You can use `/import` to restore this later.',
                files: [attachment],
            });
            return interaction.reply({ content: '✅ Export sent to your DMs!', ephemeral: true });
        } catch {
            return interaction.reply({
                content: '📤 **Deckr Data Export**\n(Could not DM you, sending here privately)',
                files: [attachment],
                ephemeral: true,
            });
        }
    },
};
