const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const CARDS_PER_PAGE = 5;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('📦 View your card collection (or another user\'s)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to view (leave empty for yourself)').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userCards = dm.getUserInventory(targetUser.id);
        const allCards = dm.getCards();

        if (userCards.length === 0) {
            return interaction.reply({
                content: targetUser.id === interaction.user.id
                    ? '📦 Your inventory is empty! Use `/claim` to get your first card.'
                    : `📦 **${targetUser.username}** has no cards yet.`,
                ephemeral: true,
            });
        }

        const cardEntries = userCards
            .filter(entry => entry.quantity > 0)
            .map(entry => {
                const card = allCards.find(c => c.id === entry.cardId);
                if (!card) return null;
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const qtyStr = entry.quantity > 1 ? ` x${entry.quantity}` : '';
                return `${emoji} **${card.name}**${qtyStr}`;
            })
            .filter(Boolean);

        const totalCards = userCards.reduce((sum, e) => sum + e.quantity, 0);
        const totalPages = Math.ceil(cardEntries.length / CARDS_PER_PAGE);
        let page = 0;

        const buildEmbed = (p) => {
            const start = p * CARDS_PER_PAGE;
            const pageCards = cardEntries.slice(start, start + CARDS_PER_PAGE);

            return new EmbedBuilder()
                .setTitle(`📦 ${targetUser.username}'s Collection`)
                .setDescription(pageCards.join('\n'))
                .setColor(0x5865f2)
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `${totalCards} total cards • ${cardEntries.length} unique • Page ${p + 1}/${totalPages}` });
        };

        const buildButtons = (p) => {
            if (totalPages <= 1) return [];
            return [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`inv_prev_${targetUser.id}`)
                    .setLabel('◀ Prev')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(p === 0),
                new ButtonBuilder()
                    .setCustomId(`inv_next_${targetUser.id}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(p === totalPages - 1),
            )];
        };

        const reply = await interaction.reply({
            embeds: [buildEmbed(page)],
            components: buildButtons(page),
            fetchReply: true,
        });

        if (totalPages <= 1) return;

        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 2 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            if (i.customId.startsWith('inv_prev')) page = Math.max(0, page - 1);
            if (i.customId.startsWith('inv_next')) page = Math.min(totalPages - 1, page + 1);
            await i.update({ embeds: [buildEmbed(page)], components: buildButtons(page) });
        });

        collector.on('end', async () => {
            await reply.edit({ components: [] }).catch(() => { });
        });
    },
};
