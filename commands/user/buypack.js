const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const PACK_PRICE = 100;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buypack')
        .setDescription(`Buy a card pack for ${PACK_PRICE} coins — pick one of three!`),

    async execute(interaction) {
        const balance = dm.getBalance(interaction.user.id);

        if (balance < PACK_PRICE) {
            return interaction.reply({
                content: `❌ You need **${PACK_PRICE}** coins but only have **${balance.toLocaleString()}**!`,
                ephemeral: true,
            });
        }

        const cards = dm.getCards();
        if (cards.length < 3) {
            return interaction.reply({ content: '❌ Not enough cards in the pool (need at least 3).', ephemeral: true });
        }

        // Deduct coins immediately
        const newBalance = dm.removeCoins(interaction.user.id, PACK_PRICE);
        if (newBalance === false) {
            return interaction.reply({ content: '❌ Not enough coins!', ephemeral: true });
        }

        // Generate 3 random cards
        const threeCards = dm.getRandomCards(3);
        const pickId = `pack_${interaction.user.id}_${Date.now()}`;

        const embed = new EmbedBuilder()
            .setDescription(
                `### 📦 Card Pack\n` +
                `Three cards are face down. Pick one to keep!\n` +
                `💰 **-${PACK_PRICE}** coins · Balance: **${newBalance.toLocaleString()}**`
            )
            .setColor(0x5865f2)
            .setFooter({ text: interaction.user.username });

        if (config.claimImageUrl) {
            embed.setImage(config.claimImageUrl);
        }

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${pickId}_0`)
                .setLabel('Left')
                .setEmoji('🃏')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${pickId}_1`)
                .setLabel('Middle')
                .setEmoji('🃏')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${pickId}_2`)
                .setLabel('Right')
                .setEmoji('🃏')
                .setStyle(ButtonStyle.Secondary),
        );

        const reply = await interaction.reply({
            embeds: [embed],
            components: [buttons],
            fetchReply: true,
        });

        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(pickId),
            max: 1,
            time: 30 * 1000,
        });

        collector.on('collect', async (i) => {
            const pickedIndex = parseInt(i.customId.split('_').pop());
            const pickedCard = threeCards[pickedIndex];

            // Add the picked card to inventory
            dm.addCardToUser(interaction.user.id, interaction.user.username, pickedCard.id);

            const pickedColor = config.rarityColors[pickedCard.rarity] || '#9e9e9e';
            const positions = ['Left', 'Middle', 'Right'];

            const lines = threeCards.map((card, idx) => {
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const rarity = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                const price = dm.SELL_PRICES[card.rarity] ?? 0;

                if (idx === pickedIndex) {
                    return `**${positions[idx]}** · ${emoji} **${card.name}** · ${rarity} · ${price} coins  ◂`;
                }
                return `${positions[idx]} · ${emoji} ${card.name} · ${rarity} · ${price} coins`;
            });

            const resultEmbed = new EmbedBuilder()
                .setDescription(
                    `### 📦 ${pickedCard.name}\n` +
                    `Opened by ${interaction.user.username}\n\n` +
                    lines.join('\n')
                )
                .setImage(pickedCard.imageUrl)
                .setColor(parseInt(pickedColor.replace('#', ''), 16))
                .setTimestamp();

            const disabledButtons = new ActionRowBuilder().addComponents(
                ...buttons.components.map((btn, idx) => {
                    const b = ButtonBuilder.from(btn).setDisabled(true);
                    if (idx === pickedIndex) b.setStyle(ButtonStyle.Primary);
                    return b;
                })
            );

            await i.update({ embeds: [resultEmbed], components: [disabledButtons] });
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                // Refund coins if timed out
                dm.addCoins(interaction.user.id, interaction.user.username, PACK_PRICE);

                const expiredEmbed = new EmbedBuilder()
                    .setDescription(`📦 Pack expired. Your **${PACK_PRICE}** coins have been refunded.`)
                    .setColor(0x2b2d31);

                const disabledButtons = new ActionRowBuilder().addComponents(
                    ...buttons.components.map(btn =>
                        ButtonBuilder.from(btn).setDisabled(true)
                    )
                );

                await reply.edit({ embeds: [expiredEmbed], components: [disabledButtons] }).catch(() => { });
            }
        });
    },
};
