const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('🔍 View a specific card')
        .addStringOption(opt =>
            opt.setName('card').setDescription('Card to view').setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const cards = dm.getCards();
        const filtered = cards
            .filter(c => c.name.toLowerCase().includes(focused))
            .slice(0, 25);
        await interaction.respond(filtered.map(c => ({
            name: `${c.name} (${c.rarity})`,
            value: c.id,
        })));
    },

    async execute(interaction) {
        const cardId = interaction.options.getString('card');
        const card = dm.findCardById(cardId);

        if (!card) {
            return interaction.reply({ content: '❌ Card not found!', ephemeral: true });
        }

        const inventory = dm.getInventory();
        let totalOwned = 0;
        let owners = [];
        for (const [userId, userData] of Object.entries(inventory)) {
            const entry = userData.cards.find(c => c.cardId === card.id);
            if (entry && entry.quantity > 0) {
                totalOwned += entry.quantity;
                owners.push(`<@${userId}> (x${entry.quantity})`);
            }
        }

        const emoji = config.rarityEmojis[card.rarity] || '⚪';
        const color = config.rarityColors[card.rarity] || '#9e9e9e';

        const embed = new EmbedBuilder()
            .setTitle(card.name)
            .setImage(card.imageUrl)
            .setColor(parseInt(color.replace('#', ''), 16))
            .addFields(
                { name: 'Rarity', value: `${emoji} ${card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)}`, inline: true },
                { name: 'Total Owned', value: `${totalOwned} copies`, inline: true },
            )
            .setFooter({ text: `ID: ${card.id}` })
            .setTimestamp();

        if (owners.length > 0) {
            const ownerList = owners.slice(0, 10).join('\n');
            const extra = owners.length > 10 ? `\n...and ${owners.length - 10} more` : '';
            embed.addFields({ name: 'Owners', value: ownerList + extra });
        } else {
            embed.addFields({ name: 'Owners', value: 'No one owns this card yet!' });
        }

        return interaction.reply({ embeds: [embed] });
    },
};
