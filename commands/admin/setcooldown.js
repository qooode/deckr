const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { config, setCooldown } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setcooldown')
        .setDescription('Set the claim cooldown in minutes (Admin only)')
        .addIntegerOption(opt =>
            opt.setName('minutes').setDescription('Cooldown in minutes (1440 = 24 hours)').setRequired(true).setMinValue(1))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const minutes = interaction.options.getInteger('minutes');
        setCooldown(minutes);

        const hours = (minutes / 60).toFixed(1);
        return interaction.reply({
            content: `✅ Claim cooldown set to **${minutes} minutes** (${hours} hours).`,
            ephemeral: true,
        });
    },
};
