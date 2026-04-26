const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { config, setCreateCardPrice } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setcreateprice')
        .setDescription('Set the price for users to create a card (Admin only)')
        .addIntegerOption(opt =>
            opt.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(0))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const price = interaction.options.getInteger('price');
        setCreateCardPrice(price);

        return interaction.reply({
            content: `✅ Card creation price set to **${price.toLocaleString()} coins**.`,
            ephemeral: true,
        });
    },
};
