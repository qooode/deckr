const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Draw three cards, keep one'),

    async execute(interaction) {
        const cards = dm.getCards();

        if (cards.length === 0) {
            return interaction.reply({ content: 'No cards in the pool yet.', ephemeral: true });
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
                content: `Next claim available in **${timeStr.trim()}**.`,
                ephemeral: true,
            });
        }

        const threeCards = dm.getRandomCards(3);
        if (threeCards.length < 3) {
            return interaction.reply({ content: 'Need at least 3 cards in the pool.', ephemeral: true });
        }

        const pickId = `pick_${interaction.user.id}_${Date.now()}`;

        const embed = new EmbedBuilder()
            .setTitle('Choose a card')
            .setDescription('Three cards have been drawn face-down.\nPick one to keep — the rest will be revealed.')
            .addFields(
                { name: 'Left', value: '🂠', inline: true },
                { name: 'Middle', value: '🂠', inline: true },
                { name: 'Right', value: '🂠', inline: true },
            )
            .setColor(0x2b2d31)
            .setFooter({ text: `${interaction.user.username} · 30s to pick` });

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${pickId}_0`)
                .setLabel('Left')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${pickId}_1`)
                .setLabel('Middle')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${pickId}_2`)
                .setLabel('Right')
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

            dm.addCardToUser(interaction.user.id, interaction.user.username, pickedCard.id);
            dm.recordClaim(interaction.user.id);

            const pickedColor = config.rarityColors[pickedCard.rarity] || '#9e9e9e';
            const positions = ['Left', 'Middle', 'Right'];

            // Build reveal fields — picked card is bold, others are dimmed
            const fields = threeCards.map((card, idx) => {
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const rarity = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                const isPick = idx === pickedIndex;

                return {
                    name: isPick ? `${positions[idx]} ✦` : positions[idx],
                    value: isPick
                        ? `${emoji} **${card.name}**\n${rarity}`
                        : `-# ${emoji} ${card.name}\n-# ${rarity}`,
                    inline: true,
                };
            });

            const resultEmbed = new EmbedBuilder()
                .setTitle(pickedCard.name)
                .setDescription(`Claimed by ${interaction.user.username}`)
                .addFields(fields)
                .setImage(pickedCard.imageUrl)
                .setColor(parseInt(pickedColor.replace('#', ''), 16))
                .setFooter({ text: pickedCard.rarity.charAt(0).toUpperCase() + pickedCard.rarity.slice(1) })
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
                const expiredEmbed = new EmbedBuilder()
                    .setDescription('Cards expired — use `/claim` again.')
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
