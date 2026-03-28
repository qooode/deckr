const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const MYSTERY_COST = 250;

// Outcomes — weights must add to 100
const OUTCOMES = [
    { weight: 40, type: 'nothing' },
    { weight: 25, type: 'coins',  amount: 500 },
    { weight: 15, type: 'coins',  amount: 1000 },
    { weight: 10, type: 'card',   minRarity: 'rare' },
    { weight: 5,  type: 'card',   minRarity: 'epic' },
    { weight: 3,  type: 'coins',  amount: 2500 },
    { weight: 2,  type: 'card',   minRarity: 'legendary' },
];

function rollOutcome() {
    let roll = Math.random() * 100;
    for (const outcome of OUTCOMES) {
        roll -= outcome.weight;
        if (roll <= 0) return outcome;
    }
    return OUTCOMES[0];
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mystery')
        .setDescription(`Open a mystery box for ${MYSTERY_COST} coins — anything could happen!`),

    async execute(interaction) {
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const balance = dm.getBalance(userId);

        if (balance < MYSTERY_COST) {
            return interaction.reply({
                content: `❌ You need **${MYSTERY_COST}** coins but only have **${balance.toLocaleString()}**!`,
                ephemeral: true,
            });
        }

        const cards = dm.getCards();
        if (cards.length === 0) {
            return interaction.reply({ content: '❌ No cards in the pool yet!', ephemeral: true });
        }

        // Deduct cost
        dm.removeCoins(userId, MYSTERY_COST);

        // Suspense embed
        const suspenseEmbed = new EmbedBuilder()
            .setDescription(`### 🎁 Mystery Box\nOpening...`)
            .setColor(0x2b2d31)
            .setFooter({ text: username });

        const reply = await interaction.reply({ embeds: [suspenseEmbed], fetchReply: true });

        // Suspense delay
        await new Promise(r => setTimeout(r, 2000));

        // Roll
        const outcome = rollOutcome();
        let resultEmbed;

        if (outcome.type === 'nothing') {
            resultEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🎁 Mystery Box\n` +
                    `💀 **Empty!** Better luck next time.\n\n` +
                    `💰 **-${MYSTERY_COST}** coins · Balance: **${dm.getBalance(userId).toLocaleString()}**`
                )
                .setColor(0x2b2d31)
                .setFooter({ text: username })
                .setTimestamp();

        } else if (outcome.type === 'coins') {
            const newBalance = dm.addCoins(userId, username, outcome.amount);
            const profit = outcome.amount - MYSTERY_COST;
            const sign = profit > 0 ? '+' : '';

            resultEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🎁 Mystery Box\n` +
                    `💰 **${outcome.amount.toLocaleString()} coins!**\n\n` +
                    `Net: **${sign}${profit.toLocaleString()}** coins · Balance: **${newBalance.toLocaleString()}**`
                )
                .setColor(profit > 0 ? 0x4caf50 : 0xfee75c)
                .setFooter({ text: username })
                .setTimestamp();

        } else if (outcome.type === 'card') {
            const card = dm.getRandomCardMinRarity(outcome.minRarity);
            if (!card) {
                // Fallback to coins if no cards of that rarity exist
                const fallback = 1000;
                const newBalance = dm.addCoins(userId, username, fallback);
                resultEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🎁 Mystery Box\n` +
                        `No ${cap(outcome.minRarity)}+ cards exist — **${fallback.toLocaleString()} coins** instead!\n\n` +
                        `Balance: **${newBalance.toLocaleString()}**`
                    )
                    .setColor(0xfee75c)
                    .setFooter({ text: username })
                    .setTimestamp();
            } else {
                dm.addCardToUser(userId, username, card.id);
                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const color = config.rarityColors[card.rarity] || '#2b2d31';

                resultEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🎁 Mystery Box\n` +
                        `${emoji} **${card.name}** — ${cap(card.rarity)}!\n\n` +
                        `💰 **-${MYSTERY_COST}** coins · Balance: **${dm.getBalance(userId).toLocaleString()}**`
                    )
                    .setColor(parseInt(color.replace('#', ''), 16))
                    .setFooter({ text: username })
                    .setTimestamp();

                if (card.imageUrl) resultEmbed.setImage(card.imageUrl);
            }
        }

        await reply.edit({ embeds: [resultEmbed] }).catch(() => {});
    },
};
