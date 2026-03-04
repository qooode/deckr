const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('See who\'s stacking the most coins'),

    async execute(interaction) {
        const wallets = dm.getWallets();

        const sorted = Object.entries(wallets)
            .filter(([, data]) => data.balance > 0)
            .map(([userId, data]) => ({ userId, username: data.username, balance: data.balance }))
            .sort((a, b) => b.balance - a.balance);

        if (sorted.length === 0) {
            return interaction.reply({
                content: '💰 Nobody has any coins yet! Use `/sell` or `/coinflip` to start earning.',
                ephemeral: true,
            });
        }

        const medals = ['🥇', '🥈', '🥉'];

        const lines = sorted.slice(0, 15).map((entry, i) => {
            const medal = medals[i] || `**${i + 1}.**`;
            return `${medal} **${entry.username}** — **${entry.balance.toLocaleString()}** coins`;
        });

        // Highlight requester's position if not in top 15
        const userRank = sorted.findIndex(e => e.userId === interaction.user.id);
        let userLine = '';
        if (userRank >= 15) {
            const entry = sorted[userRank];
            userLine = `\n---\n**${userRank + 1}.** ${entry.username} — **${entry.balance.toLocaleString()}** coins`;
        } else if (userRank === -1) {
            userLine = `\n---\nYou have **0** coins`;
        }

        const totalCoins = sorted.reduce((sum, e) => sum + e.balance, 0);

        const embed = new EmbedBuilder()
            .setTitle('💰 Richest Players')
            .setDescription(lines.join('\n') + userLine)
            .setColor(0xf1c40f)
            .setFooter({ text: `${sorted.length} wallets • ${totalCoins.toLocaleString()} coins in circulation` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },
};
