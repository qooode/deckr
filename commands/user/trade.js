const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Propose a card trade with another user')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to trade with').setRequired(true))
        .addStringOption(opt =>
            opt.setName('your_card').setDescription('Card you want to give').setRequired(true).setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('their_card').setDescription('Card you want to receive').setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const allCards = dm.getCards();

        if (focused.name === 'your_card') {
            const userCards = dm.getUserInventory(interaction.user.id);
            const ownedCardIds = userCards.filter(c => c.quantity > 0).map(c => c.cardId);
            const ownedCards = allCards.filter(c => ownedCardIds.includes(c.id));
            const filtered = ownedCards
                .filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()))
                .slice(0, 25);
            await interaction.respond(filtered.map(c => ({
                name: `${c.name} (${c.rarity})`,
                value: c.id,
            })));
        } else {
            const filtered = allCards
                .filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()))
                .slice(0, 25);
            await interaction.respond(filtered.map(c => ({
                name: `${c.name} (${c.rarity})`,
                value: c.id,
            })));
        }
    },

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const yourCardId = interaction.options.getString('your_card');
        const theirCardId = interaction.options.getString('their_card');

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You can\'t trade with yourself!', ephemeral: true });
        }

        if (targetUser.bot) {
            return interaction.reply({ content: '❌ You can\'t trade with bots!', ephemeral: true });
        }

        const yourCard = dm.findCardById(yourCardId);
        const theirCard = dm.findCardById(theirCardId);

        if (!yourCard || !theirCard) {
            return interaction.reply({ content: '❌ One or both cards not found!', ephemeral: true });
        }

        if (!dm.userHasCard(interaction.user.id, yourCardId)) {
            return interaction.reply({ content: `❌ You don't own **${yourCard.name}**!`, ephemeral: true });
        }

        if (!dm.userHasCard(targetUser.id, theirCardId)) {
            return interaction.reply({ content: `❌ **${targetUser.username}** doesn't own **${theirCard.name}**!`, ephemeral: true });
        }

        const tradeId = dm.generateTradeId();
        const trade = {
            id: tradeId,
            fromUserId: interaction.user.id,
            fromUsername: interaction.user.username,
            fromCardId: yourCardId,
            toUserId: targetUser.id,
            toUsername: targetUser.username,
            toCardId: theirCardId,
            createdAt: new Date().toISOString(),
        };
        dm.addTrade(trade);

        const yourEmoji = config.rarityEmojis[yourCard.rarity] || '⚪';
        const theirEmoji = config.rarityEmojis[theirCard.rarity] || '⚪';

        const embed = new EmbedBuilder()
            .setTitle('🔄 Trade Proposal')
            .setColor(0x5865f2)
            .setDescription(
                `**${interaction.user.username}** wants to trade with **${targetUser.username}**!\n\n` +
                `📤 Giving: ${yourEmoji} **${yourCard.name}** (${yourCard.rarity})\n` +
                `📥 Wants: ${theirEmoji} **${theirCard.name}** (${theirCard.rarity})`
            )
            .setFooter({ text: `Trade ID: ${tradeId} • Expires in 5 minutes` })
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`trade_accept_${tradeId}`)
                .setLabel('✅ Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`trade_decline_${tradeId}`)
                .setLabel('❌ Decline')
                .setStyle(ButtonStyle.Danger),
        );

        const reply = await interaction.reply({
            content: `${targetUser}`,
            embeds: [embed],
            components: [buttons],
            fetchReply: true,
        });

        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === targetUser.id,
            max: 1,
            time: 5 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            const currentTrade = dm.findTradeById(tradeId);
            if (!currentTrade) {
                return i.reply({ content: '❌ This trade no longer exists.', ephemeral: true });
            }

            if (i.customId.startsWith('trade_accept')) {
                if (!dm.userHasCard(interaction.user.id, yourCardId)) {
                    dm.removeTrade(tradeId);
                    return i.update({
                        content: `❌ Trade failed — **${interaction.user.username}** no longer has the card.`,
                        embeds: [],
                        components: [],
                    });
                }
                if (!dm.userHasCard(targetUser.id, theirCardId)) {
                    dm.removeTrade(tradeId);
                    return i.update({
                        content: `❌ Trade failed — **${targetUser.username}** no longer has the card.`,
                        embeds: [],
                        components: [],
                    });
                }

                dm.removeCardFromUser(interaction.user.id, yourCardId);
                dm.addCardToUser(targetUser.id, targetUser.username, yourCardId);
                dm.removeCardFromUser(targetUser.id, theirCardId);
                dm.addCardToUser(interaction.user.id, interaction.user.username, theirCardId);
                dm.removeTrade(tradeId);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Trade Complete!')
                    .setColor(0x4caf50)
                    .setDescription(
                        `**${interaction.user.username}** gave ${yourEmoji} **${yourCard.name}**\n` +
                        `**${targetUser.username}** gave ${theirEmoji} **${theirCard.name}**`
                    )
                    .setTimestamp();

                await i.update({ content: '', embeds: [successEmbed], components: [] });
            } else {
                dm.removeTrade(tradeId);
                await i.update({
                    content: `❌ **${targetUser.username}** declined the trade.`,
                    embeds: [],
                    components: [],
                });
            }
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                dm.removeTrade(tradeId);
                const expiredButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('trade_expired')
                        .setLabel('⏰ Trade Expired')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                );
                await reply.edit({ components: [expiredButtons] }).catch(() => { });
            }
        });
    },
};
