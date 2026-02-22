const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('drop')
        .setDescription('🎴 Drop a card in a channel (Admin only)')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to drop the card in').setRequired(true))
        .addStringOption(opt =>
            opt.setName('card').setDescription('Card to drop (leave empty for random)').setRequired(false).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const cards = dm.getCards();
        const results = [{ name: '🎲 Random Card', value: 'random' }];
        const filtered = cards
            .filter(c => c.name.toLowerCase().includes(focused) || c.id.includes(focused))
            .slice(0, 24);
        results.push(...filtered.map(c => ({
            name: `${c.name} (${c.rarity})`,
            value: c.id,
        })));
        await interaction.respond(results.slice(0, 25));
    },

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const cardChoice = interaction.options.getString('card') || 'random';

        let card;
        if (cardChoice === 'random') {
            card = dm.getRandomCard();
        } else {
            card = dm.findCardById(cardChoice);
        }

        if (!card) {
            return interaction.reply({ content: '❌ No cards available! Create some cards first with `/createcard`.', ephemeral: true });
        }

        const emoji = config.rarityEmojis[card.rarity] || '⚪';
        const color = config.rarityColors[card.rarity] || '#9e9e9e';

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} A wild card appeared!`)
            .setDescription(`**${card.name}**\n${emoji} ${card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)}${card.series ? ` • ${card.series}` : ''}`)
            .setImage(card.imageUrl)
            .setColor(parseInt(color.replace('#', ''), 16))
            .setFooter({ text: 'First to claim gets it!' })
            .setTimestamp();

        const claimButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`drop_claim_${card.id}_${Date.now()}`)
                .setLabel('🎴 Claim!')
                .setStyle(ButtonStyle.Success),
        );

        await interaction.reply({ content: `✅ Dropped **${card.name}** in ${channel}!`, ephemeral: true });

        const msg = await channel.send({ embeds: [embed], components: [claimButton] });

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.customId.startsWith('drop_claim_'),
            max: 1,
            time: 5 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            dm.addCardToUser(i.user.id, i.user.username, card.id);

            const claimedEmbed = EmbedBuilder.from(embed)
                .setTitle(`${emoji} Card Claimed!`)
                .setDescription(`**${card.name}** was claimed by **${i.user.username}**!\n${emoji} ${card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)}${card.series ? ` • ${card.series}` : ''}`)
                .setFooter({ text: `Claimed by ${i.user.username}` });

            const disabledButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claimed_disabled')
                    .setLabel(`✅ Claimed by ${i.user.username}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
            );

            await msg.edit({ embeds: [claimedEmbed], components: [disabledButton] });
            await i.reply({ content: `🎉 You claimed **${card.name}**! Check your \`/inventory\`.`, ephemeral: true });
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                const expiredButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('expired_disabled')
                        .setLabel('⏰ Expired — No one claimed it')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                );
                const expiredEmbed = EmbedBuilder.from(embed)
                    .setTitle(`${emoji} Card Expired`)
                    .setFooter({ text: 'No one claimed this card in time.' });
                await msg.edit({ embeds: [expiredEmbed], components: [expiredButton] }).catch(() => { });
            }
        });
    },
};
