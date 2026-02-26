const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const LINES_PER_PAGE = 8;

const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your card collection (or another user\'s)')
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

        // Resolve cards and attach rarity for sorting
        const resolved = userCards
            .filter(entry => entry.quantity > 0)
            .map(entry => {
                const card = allCards.find(c => c.id === entry.cardId);
                if (!card) return null;
                return { card, quantity: entry.quantity };
            })
            .filter(Boolean);

        // Sort by rarity (legendary first)
        resolved.sort((a, b) => {
            const ai = RARITY_ORDER.indexOf(a.card.rarity);
            const bi = RARITY_ORDER.indexOf(b.card.rarity);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        // Build display lines with rarity headers
        const displayLines = [];
        let lastRarity = null;

        for (const { card, quantity } of resolved) {
            if (card.rarity !== lastRarity) {
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const label = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                if (lastRarity !== null) displayLines.push('');
                displayLines.push(`${emoji} **${label}**`);
                lastRarity = card.rarity;
            }
            const qtyStr = quantity > 1 ? ` x${quantity}` : '';
            displayLines.push(`╰ ${card.name}${qtyStr}`);
        }

        const totalCards = userCards.reduce((sum, e) => sum + e.quantity, 0);
        const uniqueCount = resolved.length;

        // Paginate the display lines
        const pages = [];
        for (let i = 0; i < displayLines.length; i += LINES_PER_PAGE) {
            pages.push(displayLines.slice(i, i + LINES_PER_PAGE));
        }
        if (pages.length === 0) pages.push(['No cards to display.']);

        const totalPages = pages.length;
        let page = 0;

        const buildEmbed = (p) => {
            return new EmbedBuilder()
                .setTitle(`📦 ${targetUser.username}'s Collection`)
                .setDescription(pages[p].join('\n'))
                .setColor(0x5865f2)
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `${totalCards} total · ${uniqueCount} unique · Page ${p + 1}/${totalPages}` });
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
