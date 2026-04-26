const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('craftcard')
        .setDescription('Create a new card by paying coins')
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
            opt.setName('image_url').setDescription('Direct URL to the card image').setRequired(true)),

    async execute(interaction) {
        const name = interaction.options.getString('name');
        const rarity = interaction.options.getString('rarity');
        const imageUrl = interaction.options.getString('image_url');
        const price = config.createCardPrice || 100000;

        if (dm.findCardByName(name)) {
            return interaction.reply({ content: `❌ A card named **${name}** already exists!`, ephemeral: true });
        }

        const balance = dm.getBalance(interaction.user.id);
        if (balance < price) {
            return interaction.reply({
                content: `❌ You don't have enough coins! Card creation costs **${price.toLocaleString()} coins** and you have **${balance.toLocaleString()} coins**.`,
                ephemeral: true,
            });
        }

        const newBalance = dm.removeCoins(interaction.user.id, price);
        if (newBalance === false) {
            return interaction.reply({ content: '❌ Transaction failed. Please try again.', ephemeral: true });
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
            .setTitle('✅ Card Crafted!')
            .setColor(parseInt(color.replace('#', ''), 16))
            .setImage(imageUrl)
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Rarity', value: `${emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`, inline: true },
                { name: 'ID', value: `\`${card.id}\``, inline: true },
                { name: 'Cost', value: `${price.toLocaleString()} coins`, inline: true },
                { name: 'Balance', value: `${newBalance.toLocaleString()} coins`, inline: true },
            )
            .setFooter({ text: `Crafted by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },
};
