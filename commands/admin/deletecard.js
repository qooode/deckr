const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletecard')
        .setDescription('🗑️ Delete a card (Admin only)')
        .addStringOption(opt =>
            opt.setName('card').setDescription('Card to delete').setRequired(true).setAutocomplete(true))
        .addBooleanOption(opt =>
            opt.setName('remove_from_inventories').setDescription('Also remove from all user inventories?').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const cards = dm.getCards();
        const filtered = cards
            .filter(c => c.name.toLowerCase().includes(focused) || c.id.includes(focused))
            .slice(0, 25);
        await interaction.respond(filtered.map(c => ({
            name: `${c.name} (${c.rarity}) [${c.id}]`,
            value: c.id,
        })));
    },

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const cardId = interaction.options.getString('card');
        const removeFromInventories = interaction.options.getBoolean('remove_from_inventories') ?? false;
        const card = dm.findCardById(cardId);

        if (!card) {
            return interaction.reply({ content: '❌ Card not found!', ephemeral: true });
        }

        dm.deleteCard(cardId);

        let inventoryNote = '';
        if (removeFromInventories) {
            const users = dm.getInventory();
            for (const [userId, userData] of Object.entries(users)) {
                userData.cards = userData.cards.filter(c => c.cardId !== cardId);
            }
            dm.saveInventory(users);
            inventoryNote = '\n📦 Also removed from all user inventories.';
        }

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Card Deleted')
            .setColor(0xff4444)
            .addFields(
                { name: 'Name', value: card.name, inline: true },
                { name: 'Rarity', value: card.rarity, inline: true },
                { name: 'ID', value: `\`${card.id}\``, inline: true },
            )
            .setTimestamp();

        if (inventoryNote) embed.setDescription(inventoryNote);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
