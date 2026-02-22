const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the card collection leaderboard'),

    async execute(interaction) {
        const leaderboard = dm.getLeaderboard();

        if (leaderboard.length === 0) {
            return interaction.reply({ content: '🏆 No one has any cards yet! Use `/claim` to start collecting.', ephemeral: true });
        }

        const medals = ['🥇', '🥈', '🥉'];
        const totalCardsInGame = dm.getCards().length;

        const lines = leaderboard.slice(0, 15).map((entry, i) => {
            const medal = medals[i] || `**${i + 1}.**`;
            const completion = totalCardsInGame > 0
                ? ` (${Math.round((entry.uniqueCards / totalCardsInGame) * 100)}% complete)`
                : '';
            return `${medal} **${entry.username}** — ${entry.rarityScore} pts • ${entry.totalCards} cards • ${entry.uniqueCards} unique${completion}`;
        });

        // Highlight requester's position
        const userRank = leaderboard.findIndex(e => e.userId === interaction.user.id);
        let userLine = '';
        if (userRank >= 15) {
            const entry = leaderboard[userRank];
            userLine = `\n---\n**${userRank + 1}.** ${entry.username} — ${entry.rarityScore} pts • ${entry.totalCards} cards`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 Card Collection Leaderboard')
            .setDescription(lines.join('\n') + userLine)
            .setColor(0xffd700)
            .setFooter({ text: `${leaderboard.length} collectors • Ranked by rarity score` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },
};
