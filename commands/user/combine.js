const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_UP = { common: 'uncommon', uncommon: 'rare', rare: 'epic', epic: 'legendary' };
const RARITY_SKIP = { common: 'rare', uncommon: 'epic', rare: 'legendary' };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combine')
        .setDescription('Combine cards to forge a higher rarity card'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const allCards = dm.getCards();
        const userInv = dm.getUserInventory(userId);
        const combineId = `combine_${userId}_${Date.now()}`;

        if (userInv.length === 0) {
            return interaction.reply({
                content: 'You have no cards. Use `/claim` first.',
                ephemeral: true,
            });
        }

        // Count available cards per rarity (legendaries can't go higher)
        const rarityCounts = {};
        for (const entry of userInv) {
            if (entry.quantity <= 0) continue;
            const card = allCards.find(c => c.id === entry.cardId);
            if (!card || card.rarity === 'legendary') continue;
            rarityCounts[card.rarity] = (rarityCounts[card.rarity] || 0) + entry.quantity;
        }

        const canCombine = Object.entries(rarityCounts).filter(([, count]) => count >= 3);
        if (canCombine.length === 0) {
            return interaction.reply({
                content: 'You need at least **3 cards of the same rarity** to combine.',
                ephemeral: true,
            });
        }

        // ——— Rarity selection menu ———
        const rarityOptions = [];
        for (const rarity of RARITY_ORDER) {
            if (rarity === 'legendary') continue;
            const count = rarityCounts[rarity] || 0;
            if (count < 3) continue;

            const emoji = config.rarityEmojis[rarity] || '⚪';
            const nextUp = RARITY_UP[rarity];
            const nextSkip = RARITY_SKIP[rarity];
            let desc = `3× → ${cap(nextUp)}`;
            if (count >= 5 && nextSkip) desc += ` · 5× → ${cap(nextSkip)}`;

            rarityOptions.push({
                label: `${cap(rarity)} — ${count} available`,
                description: desc,
                value: rarity,
                emoji,
            });
        }

        const rarityMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${combineId}_rarity`)
                .setPlaceholder('Select rarity...')
                .addOptions(rarityOptions),
        );

        const introEmbed = new EmbedBuilder()
            .setDescription(
                `### 🔀 Combine\n` +
                `**3 cards** → next rarity\n` +
                `**5 cards** → skip a rarity\n`
            )
            .setColor(0x2b2d31)
            .setFooter({ text: 'Combined cards are destroyed' });

        const reply = await interaction.reply({
            embeds: [introEmbed],
            components: [rarityMenu],
            fetchReply: true,
        });

        // ——— State ———
        let chosenRarity = null;
        let combineCount = null;
        let selectedCardIds = [];
        let phase = 'rarity_select';

        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === userId,
            time: 2 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            // ——— RARITY SELECT ———
            if (phase === 'rarity_select' && i.customId === `${combineId}_rarity`) {
                chosenRarity = i.values[0];
                const count = rarityCounts[chosenRarity];
                const emoji = config.rarityEmojis[chosenRarity] || '⚪';
                const nextUp = RARITY_UP[chosenRarity];
                const nextSkip = RARITY_SKIP[chosenRarity];
                const nextUpEmoji = config.rarityEmojis[nextUp] || '⚪';

                phase = 'count_select';

                const countButtons = [
                    new ButtonBuilder()
                        .setCustomId(`${combineId}_count_3`)
                        .setLabel(`3× ${cap(chosenRarity)} → ${cap(nextUp)}`)
                        .setStyle(ButtonStyle.Secondary),
                ];

                if (count >= 5 && nextSkip) {
                    countButtons.push(
                        new ButtonBuilder()
                            .setCustomId(`${combineId}_count_5`)
                            .setLabel(`5× ${cap(chosenRarity)} → ${cap(nextSkip)}`)
                            .setStyle(ButtonStyle.Primary),
                    );
                }

                countButtons.push(
                    new ButtonBuilder()
                        .setCustomId(`${combineId}_back`)
                        .setLabel('Back')
                        .setStyle(ButtonStyle.Secondary),
                );

                const countRow = new ActionRowBuilder().addComponents(countButtons);
                const countEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🔀 Combine\n` +
                        `${emoji} **${cap(chosenRarity)}** — ${count} available\n`
                    )
                    .setColor(0x2b2d31);

                return i.update({ embeds: [countEmbed], components: [countRow] });
            }

            // ——— BACK ———
            if (i.customId === `${combineId}_back`) {
                phase = 'rarity_select';
                chosenRarity = null;
                combineCount = null;
                selectedCardIds = [];
                return i.update({ embeds: [introEmbed], components: [rarityMenu] });
            }

            // ——— COUNT SELECT ———
            if (phase === 'count_select' && i.customId.startsWith(`${combineId}_count_`)) {
                combineCount = parseInt(i.customId.split('_').pop());
                phase = 'card_select';
                selectedCardIds = [];
                return showCardPicker(i);
            }

            // ——— CARD SELECT ———
            if (phase === 'card_select' && i.customId === `${combineId}_cards`) {
                selectedCardIds.push(i.values[0]);

                if (selectedCardIds.length < combineCount) {
                    return showCardPicker(i);
                }

                // ——— CONFIRM ———
                phase = 'confirm';
                const emoji = config.rarityEmojis[chosenRarity] || '⚪';
                const selectedCards = selectedCardIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
                const targetRarity = combineCount === 5 ? RARITY_SKIP[chosenRarity] : RARITY_UP[chosenRarity];
                const targetEmoji = config.rarityEmojis[targetRarity] || '⚪';

                const cardLines = selectedCards.map(c => `╰ ${c.name}`).join('\n');
                const confirmEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🔀 Combine — Confirm\n` +
                        `${emoji} **${cap(chosenRarity)}** × ${combineCount}\n` +
                        `${cardLines}\n\n` +
                        `Result: ${targetEmoji} 1× random **${cap(targetRarity)}**\n`
                    )
                    .setColor(0x2b2d31)
                    .setFooter({ text: 'This cannot be undone' });

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${combineId}_confirm`)
                        .setLabel('Combine')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`${combineId}_back`)
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary),
                );

                return i.update({ embeds: [confirmEmbed], components: [confirmRow] });
            }

            // ——— CONFIRM ———
            if (phase === 'confirm' && i.customId === `${combineId}_confirm`) {
                phase = 'done';

                // Verify ownership
                for (const cardId of selectedCardIds) {
                    if (!dm.userHasCard(userId, cardId)) {
                        collector.stop('card_gone');
                        return i.update({
                            components: [],
                            embeds: [new EmbedBuilder().setColor(0x2b2d31)
                                .setDescription('You no longer own one of the selected cards.')],
                        });
                    }
                }

                const targetRarity = combineCount === 5 ? RARITY_SKIP[chosenRarity] : RARITY_UP[chosenRarity];
                const eligibleResults = allCards.filter(c => c.rarity === targetRarity);

                if (eligibleResults.length === 0) {
                    collector.stop('no_results');
                    return i.update({
                        components: [],
                        embeds: [new EmbedBuilder().setColor(0x2b2d31)
                            .setDescription(`No **${cap(targetRarity)}** cards exist in the pool yet.`)],
                    });
                }

                // ——— ANIMATION: cards consumed one by one ———
                const emoji = config.rarityEmojis[chosenRarity] || '⚪';
                const sacrificedCards = selectedCardIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
                const targetRarityLabel = combineCount === 5 ? RARITY_SKIP[chosenRarity] : RARITY_UP[chosenRarity];
                const targetEmoji = config.rarityEmojis[targetRarityLabel] || '⚪';
                const targetColor = config.rarityColors[targetRarityLabel] || '#2b2d31';

                // Step 1: show all cards alive
                function buildForgingLines(fadedCount) {
                    return sacrificedCards.map((c, idx) => {
                        if (idx < fadedCount) return `╰ ~~${c.name}~~`;
                        return `╰ ${c.name}`;
                    }).join('\n');
                }

                const step1Embed = new EmbedBuilder()
                    .setDescription(
                        `### 🔥 Combining...\n` +
                        `${emoji} **${cap(chosenRarity)}** → ${targetEmoji} **${cap(targetRarityLabel)}**\n\n` +
                        `${buildForgingLines(0)}\n`
                    )
                    .setColor(0x2b2d31);

                await i.update({ embeds: [step1Embed], components: [] });

                // Remove cards & pick result early (so data is safe)
                for (const cardId of selectedCardIds) {
                    dm.removeCardFromUser(userId, cardId);
                }
                const resultCard = pick(eligibleResults);
                dm.addCardToUser(userId, username, resultCard.id);

                // Steps 2+: strike through cards one by one
                const CARD_DELAY = 800;

                for (let step = 1; step <= sacrificedCards.length; step++) {
                    await new Promise(r => setTimeout(r, CARD_DELAY));
                    const stepEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 🔥 Combining...\n` +
                            `${emoji} **${cap(chosenRarity)}** → ${targetEmoji} **${cap(targetRarityLabel)}**\n\n` +
                            `${buildForgingLines(step)}\n`
                        )
                        .setColor(0x2b2d31);
                    await reply.edit({ embeds: [stepEmbed] }).catch(() => { });
                }

                // Brief pause before reveal
                await new Promise(r => setTimeout(r, 1200));

                // ——— REVEAL ———
                const resultEmoji = config.rarityEmojis[resultCard.rarity] || '⚪';
                const resultColor = config.rarityColors[resultCard.rarity] || '#2b2d31';
                const isSkip = combineCount === 5;

                const revealEmbed = new EmbedBuilder()
                    .setDescription(
                        `### ${resultEmoji} ${resultCard.name}\n` +
                        `${cap(resultCard.rarity)}` +
                        (isSkip ? ' — rarity skip' : '') + `\n\n` +
                        `Added to ${username}'s collection.`
                    )
                    .setColor(parseInt(resultColor.replace('#', ''), 16))
                    .setFooter({ text: `${combineCount}× ${cap(chosenRarity)} combined` })
                    .setTimestamp();

                if (resultCard.imageUrl) revealEmbed.setImage(resultCard.imageUrl);

                collector.stop('finished');
                await reply.edit({ embeds: [revealEmbed], components: [] }).catch(() => { });
            }
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'time') {
                await reply.edit({
                    components: [],
                    embeds: [new EmbedBuilder().setColor(0x2b2d31)
                        .setDescription('Combine expired. No cards used.')],
                }).catch(() => { });
            }
        });

        // ——— Helper: card picker ———
        async function showCardPicker(i) {
            const emoji = config.rarityEmojis[chosenRarity] || '⚪';

            const freshInv = dm.getUserInventory(userId);
            const availableCards = [];
            for (const entry of freshInv) {
                if (entry.quantity <= 0) continue;
                const card = allCards.find(c => c.id === entry.cardId);
                if (!card || card.rarity !== chosenRarity) continue;

                const alreadyUsed = selectedCardIds.filter(id => id === card.id).length;
                const remaining = entry.quantity - alreadyUsed;
                if (remaining <= 0) continue;

                availableCards.push({ card, remaining });
            }

            availableCards.sort((a, b) => a.card.name.localeCompare(b.card.name));

            const options = availableCards.slice(0, 25).map(({ card, remaining }) => ({
                label: card.name + (remaining > 1 ? ` ×${remaining}` : ''),
                value: card.id,
                emoji,
            }));

            if (options.length === 0) {
                phase = 'done';
                collector.stop('not_enough');
                return i.update({
                    components: [],
                    embeds: [new EmbedBuilder().setColor(0x2b2d31)
                        .setDescription('Not enough cards to complete the combine.')],
                });
            }

            const already = selectedCardIds.map(id => {
                const c = allCards.find(x => x.id === id);
                return c ? `╰ ${c.name}` : id;
            });

            const progress = selectedCardIds.length > 0
                ? `\n${already.join('\n')}`
                : '';

            const pickerEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🔀 Combine — ${selectedCardIds.length + 1} of ${combineCount}\n` +
                    `Select a **${cap(chosenRarity)}** card.${progress}\n`
                )
                .setColor(0x2b2d31);

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${combineId}_cards`)
                    .setPlaceholder(`Card ${selectedCardIds.length + 1} of ${combineCount}`)
                    .addOptions(options),
            );

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${combineId}_back`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary),
            );

            return i.update({ embeds: [pickerEmbed], components: [menu, backRow] });
        }
    },
};
