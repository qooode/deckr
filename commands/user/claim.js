const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('🎴 Claim a random card!'),

    async execute(interaction) {
        const cards = dm.getCards();

        if (cards.length === 0) {
            return interaction.reply({ content: '❌ No cards available yet! Ask an admin to create some.', ephemeral: true });
        }

        const { allowed, remainingMs } = dm.canClaim(interaction.user.id, config.claimCooldownMinutes);

        if (!allowed) {
            const remainingMin = Math.ceil(remainingMs / 60000);
            const hours = Math.floor(remainingMin / 60);
            const mins = remainingMin % 60;
            let timeStr = '';
            if (hours > 0) timeStr += `${hours}h `;
            if (mins > 0) timeStr += `${mins}m`;

            return interaction.reply({
                content: `⏱️ You already claimed a card! Come back in **${timeStr.trim()}**.`,
                ephemeral: true,
            });
        }

        const card = dm.getRandomCard();
        if (!card) {
            return interaction.reply({ content: '❌ Something went wrong getting a card.', ephemeral: true });
        }

        dm.addCardToUser(interaction.user.id, interaction.user.username, card.id);
        dm.recordClaim(interaction.user.id);

        const emoji = config.rarityEmojis[card.rarity] || '⚪';
        const color = config.rarityColors[card.rarity] || '#9e9e9e';

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} You got a card!`)
            .setDescription(`**${card.name}**\n${emoji} ${card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)} • ${card.series}`)
            .setImage(card.imageUrl)
            .setColor(parseInt(color.replace('#', ''), 16))
            .setFooter({ text: `Claimed by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },
};
