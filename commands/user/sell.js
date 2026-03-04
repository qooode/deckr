const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell cards for coins')
        .addStringOption(opt =>
            opt.setName('card')
                .setDescription('Card to sell (or type "extras" to sell all extras)')
                .setRequired(true)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const allCards = dm.getCards();
        const userCards = dm.getUserInventory(interaction.user.id);
        const ownedCardIds = userCards.filter(c => c.quantity > 0).map(c => c.cardId);

        const choices = [];

        // Always show the "duplicates" option
        if ('extras'.includes(focused) || focused === '') {
            // Count dupes
            let dupeCount = 0;
            let dupeValue = 0;
            for (const entry of userCards) {
                if (entry.quantity > 1) {
                    const card = allCards.find(c => c.id === entry.cardId);
                    if (card) {
                        const extras = entry.quantity - 1;
                        dupeCount += extras;
                        dupeValue += (dm.SELL_PRICES[card.rarity] ?? 0) * extras;
                    }
                }
            }
            if (dupeCount > 0) {
                choices.push({
                    name: `📦 Sell all extras (${dupeCount} cards → ${dupeValue} coins)`,
                    value: 'extras',
                });
            }
        }

        // Show owned cards with sell prices
        const ownedCards = allCards.filter(c => ownedCardIds.includes(c.id));
        const filtered = ownedCards
            .filter(c => c.name.toLowerCase().includes(focused))
            .slice(0, 25 - choices.length);

        for (const c of filtered) {
            const entry = userCards.find(e => e.cardId === c.id);
            const qty = entry ? entry.quantity : 0;
            const price = dm.SELL_PRICES[c.rarity] ?? 0;
            const emoji = config.rarityEmojis[c.rarity] || '⚪';
            choices.push({
                name: `${emoji} ${c.name} — ${price} coins (x${qty})`,
                value: c.id,
            });
        }

        await interaction.respond(choices);
    },

    async execute(interaction) {
        const cardOption = interaction.options.getString('card');

        // ---------- Sell Duplicates ----------
        if (cardOption === 'extras') {
            const allCards = dm.getCards();
            const inventory = dm.getInventory();
            const userData = inventory[interaction.user.id];

            if (!userData || !userData.cards || userData.cards.length === 0) {
                return interaction.reply({
                    content: '📦 You have no cards to sell!',
                    ephemeral: true,
                });
            }

            let totalSold = 0;
            let totalCoins = 0;
            const soldLines = [];

            for (const entry of userData.cards) {
                if (entry.quantity <= 1) continue;
                const card = allCards.find(c => c.id === entry.cardId);
                if (!card) continue;

                const extras = entry.quantity - 1;
                const price = dm.SELL_PRICES[card.rarity] ?? 0;
                const earned = price * extras;

                // Keep exactly 1
                entry.quantity = 1;

                totalSold += extras;
                totalCoins += earned;

                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                soldLines.push(`${emoji} ${card.name} x${extras} → **${earned}** coins`);
            }

            if (totalSold === 0) {
                return interaction.reply({
                    content: '📦 You have no extra cards to sell!',
                    ephemeral: true,
                });
            }

            // Single write
            dm.saveInventory(inventory);

            // Add coins
            const newBalance = dm.addCoins(interaction.user.id, interaction.user.username, totalCoins);

            const embed = new EmbedBuilder()
                .setDescription(
                    `### 📦 Sold ${totalSold} extras\n\n` +
                    soldLines.join('\n') +
                    `\n\n💰 **+${totalCoins.toLocaleString()}** coins · Balance: **${newBalance.toLocaleString()}**`
                )
                .setColor(0x4caf50)
                .setFooter({ text: interaction.user.username })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        // ---------- Sell Single Card ----------
        const card = dm.findCardById(cardOption);
        if (!card) {
            return interaction.reply({ content: '❌ Card not found!', ephemeral: true });
        }

        if (!dm.userHasCard(interaction.user.id, cardOption)) {
            return interaction.reply({ content: `❌ You don't own **${card.name}**!`, ephemeral: true });
        }

        if (dm.isCardLocked(interaction.user.id, cardOption)) {
            return interaction.reply({ content: `❌ **${card.name}** is staked in a duel!`, ephemeral: true });
        }

        const price = dm.SELL_PRICES[card.rarity] ?? 0;
        const emoji = config.rarityEmojis[card.rarity] || '⚪';

        dm.removeCardFromUser(interaction.user.id, cardOption);
        const newBalance = dm.addCoins(interaction.user.id, interaction.user.username, price);

        const embed = new EmbedBuilder()
            .setDescription(
                `### Sold ${emoji} ${card.name}\n` +
                `💰 **+${price}** coins · Balance: **${newBalance.toLocaleString()}**`
            )
            .setColor(0x4caf50)
            .setThumbnail(card.imageUrl)
            .setFooter({ text: interaction.user.username })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },
};
