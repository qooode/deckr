const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const LINES_PER_PAGE = 8;

const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('missing')
        .setDescription('See which cards you still need')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to check (leave empty for yourself)').setRequired(false))
        .addStringOption(opt =>
            opt.setName('rarity')
                .setDescription('Filter by rarity')
                .setRequired(false)
                .addChoices(
                    { name: 'Common', value: 'common' },
                    { name: 'Uncommon', value: 'uncommon' },
                    { name: 'Rare', value: 'rare' },
                    { name: 'Epic', value: 'epic' },
                    { name: 'Legendary', value: 'legendary' },
                )),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const rarityFilter = interaction.options.getString('rarity');
        const allCards = dm.getCards();
        const userCards = dm.getUserInventory(targetUser.id);

        if (allCards.length === 0) {
            return interaction.reply({ content: 'No cards exist in the pool yet.', ephemeral: true });
        }

        // Build a set of card IDs the user owns (with quantity > 0)
        const ownedIds = new Set(
            userCards.filter(e => e.quantity > 0).map(e => e.cardId)
        );

        // Find cards the user does NOT own
        let missing = allCards.filter(c => !ownedIds.has(c.id));

        // Apply rarity filter if specified
        if (rarityFilter) {
            missing = missing.filter(c => c.rarity === rarityFilter);
        }

        const totalPool = rarityFilter
            ? allCards.filter(c => c.rarity === rarityFilter).length
            : allCards.length;
        const ownedCount = totalPool - missing.length;

        if (missing.length === 0) {
            const filterLabel = rarityFilter
                ? ` ${rarityFilter.charAt(0).toUpperCase() + rarityFilter.slice(1)}`
                : '';
            const msg = targetUser.id === interaction.user.id
                ? `🎉 You own every${filterLabel} card! (${ownedCount}/${totalPool})`
                : `🎉 **${targetUser.username}** owns every${filterLabel} card! (${ownedCount}/${totalPool})`;
            return interaction.reply({ content: msg, ephemeral: true });
        }

        // Sort missing cards by rarity (legendary first), then by name
        missing.sort((a, b) => {
            const ai = RARITY_ORDER.indexOf(a.rarity);
            const bi = RARITY_ORDER.indexOf(b.rarity);
            const rarityDiff = (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            if (rarityDiff !== 0) return rarityDiff;
            return a.name.localeCompare(b.name);
        });

        // Build display lines grouped by rarity
        const displayLines = [];
        let lastRarity = null;

        for (const card of missing) {
            if (card.rarity !== lastRarity) {
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const label = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                if (lastRarity !== null) displayLines.push('');
                displayLines.push(`${emoji} **${label}**`);
                lastRarity = card.rarity;
            }
            displayLines.push(`╰ ${card.name}`);
        }

        // Paginate
        const pages = [];
        for (let i = 0; i < displayLines.length; i += LINES_PER_PAGE) {
            pages.push(displayLines.slice(i, i + LINES_PER_PAGE));
        }
        if (pages.length === 0) pages.push(['No cards to display.']);

        const totalPages = pages.length;
        let page = 0;

        const progressPct = totalPool > 0 ? Math.round((ownedCount / totalPool) * 100) : 0;
        const filterLabel = rarityFilter
            ? ` (${rarityFilter.charAt(0).toUpperCase() + rarityFilter.slice(1)})`
            : '';

        const buildEmbed = (p) => {
            return new EmbedBuilder()
                .setTitle(`🔍 ${targetUser.username}'s Missing Cards${filterLabel}`)
                .setDescription(pages[p].join('\n'))
                .setColor(0xed4245)
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `${missing.length} missing · ${ownedCount}/${totalPool} owned (${progressPct}%) · Page ${p + 1}/${totalPages}` });
        };

        const buildButtons = (p) => {
            if (totalPages <= 1) return [];
            return [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`miss_prev_${targetUser.id}`)
                    .setLabel('◀ Prev')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(p === 0),
                new ButtonBuilder()
                    .setCustomId(`miss_next_${targetUser.id}`)
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
            if (i.customId.startsWith('miss_prev')) page = Math.max(0, page - 1);
            if (i.customId.startsWith('miss_next')) page = Math.min(totalPages - 1, page + 1);
            await i.update({ embeds: [buildEmbed(page)], components: buildButtons(page) });
        });

        collector.on('end', async () => {
            await reply.edit({ components: [] }).catch(() => { });
        });
    },
};
