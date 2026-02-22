const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createcard')
        .setDescription('🎨 Create a new card (Admin only)')
        .addStringOption(opt =>
            opt.setName('name').setDescription('Card name').setRequired(true))
        .addStringOption(opt =>
            opt.setName('rarity').setDescription('Card rarity')
                .setRequired(true)
                .addChoices(
                    { name: '⚪ Common', value: 'common' },
                    { name: '🟢 Uncommon', value: 'uncommon' },
                    { name: '🔵 Rare', value: 'rare' },
                    { name: '🟣 Epic', value: 'epic' },
                    { name: '🟡 Legendary', value: 'legendary' },
                ))

        .addStringOption(opt =>
            opt.setName('image_url').setDescription('Direct URL to the card image').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const rarity = interaction.options.getString('rarity');

        const imageUrl = interaction.options.getString('image_url');

        if (dm.findCardByName(name)) {
            return interaction.reply({ content: `❌ A card named **${name}** already exists!`, ephemeral: true });
        }

        const card = {
            id: dm.generateCardId(),
            name,
            rarity,

            imageUrl,
            createdAt: new Date().toISOString(),
        };

        dm.addCard(card);

        const emoji = config.rarityEmojis[rarity] || '⚪';
        const color = config.rarityColors[rarity] || '#9e9e9e';

        const embed = new EmbedBuilder()
            .setTitle('✅ Card Created!')
            .setColor(parseInt(color.replace('#', ''), 16))
            .setImage(imageUrl)
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Rarity', value: `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`, inline: true },

                { name: 'ID', value: `\`${card.id}\``, inline: true },
            )
            .setFooter({ text: `Created by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
