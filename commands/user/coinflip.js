const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Double or nothing — flip a coin!')
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('How many coins to bet')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(dm.COINFLIP_MAX)),

    async execute(interaction) {
        const bet = interaction.options.getInteger('amount');
        const balance = dm.getBalance(interaction.user.id);

        if (balance < bet) {
            return interaction.reply({
                content: `❌ You only have **${balance.toLocaleString()}** coins!`,
                ephemeral: true,
            });
        }

        const won = Math.random() < 0.5;

        if (won) {
            const newBalance = dm.addCoins(interaction.user.id, interaction.user.username, bet);

            const embed = new EmbedBuilder()
                .setDescription(
                    `### 🪙 Coinflip\n` +
                    `You bet **${bet.toLocaleString()}** and **won!** 🎉\n\n` +
                    `💰 **+${bet.toLocaleString()}** · Balance: **${newBalance.toLocaleString()}**`
                )
                .setColor(0x4caf50)
                .setFooter({ text: interaction.user.username })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        } else {
            const result = dm.removeCoins(interaction.user.id, bet);
            const newBalance = result === false ? 0 : result;

            const embed = new EmbedBuilder()
                .setDescription(
                    `### 🪙 Coinflip\n` +
                    `You bet **${bet.toLocaleString()}** and **lost.** 💀\n\n` +
                    `💸 **-${bet.toLocaleString()}** · Balance: **${newBalance.toLocaleString()}**`
                )
                .setColor(0xe74c3c)
                .setFooter({ text: interaction.user.username })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    },
};
