const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listcards')
        .setDescription('📇 List all cards in the database (Admin only)')
        .addStringOption(opt =>
            opt.setName('rarity').setDescription('Filter by rarity').setRequired(false)
                .addChoices(
                    { name: '⚪ Common', value: 'common' },
                    { name: '🟢 Uncommon', value: 'uncommon' },
                    { name: '🔵 Rare', value: 'rare' },
                    { name: '🟣 Epic', value: 'epic' },
                    { name: '🟡 Legendary', value: 'legendary' },
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        let cards = dm.getCards();
        const filterRarity = interaction.options.getString('rarity');

        if (filterRarity) {
            cards = cards.filter(c => c.rarity === filterRarity);
        }

        if (cards.length === 0) {
            const msg = filterRarity
                ? `📇 No **${filterRarity}** cards found.`
                : '📇 No cards in the database yet. Use `/createcard` to add some!';
            return interaction.reply({ content: msg, ephemeral: true });
        }

        const lines = cards.map((c, i) => {
            const emoji = config.rarityEmojis[c.rarity] || '⚪';
            return `${i + 1}. ${emoji} **${c.name}** — ${c.rarity} • \`${c.id}\``;
        });

        const chunks = [];
        let current = [];
        let currentLen = 0;
        for (const line of lines) {
            if (currentLen + line.length + 1 > 3800) {
                chunks.push(current.join('\n'));
                current = [];
                currentLen = 0;
            }
            current.push(line);
            currentLen += line.length + 1;
        }
        if (current.length > 0) chunks.push(current.join('\n'));

        const embeds = chunks.map((chunk, i) => {
            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setDescription(chunk);

            if (i === 0) {
                const title = filterRarity
                    ? `📇 ${filterRarity.charAt(0).toUpperCase() + filterRarity.slice(1)} Cards (${cards.length})`
                    : `📇 All Cards (${cards.length})`;
                embed.setTitle(title);
            }
            if (i === chunks.length - 1) {
                embed.setFooter({ text: `${cards.length} cards total` });
            }
            return embed;
        });

        return interaction.reply({ embeds: embeds.slice(0, 10), ephemeral: true });
    },
};
