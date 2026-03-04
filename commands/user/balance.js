const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dm = require('../../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your coin balance')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to check (leave empty for yourself)').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const balance = dm.getBalance(targetUser.id);
        const isSelf = targetUser.id === interaction.user.id;

        const embed = new EmbedBuilder()
            .setDescription(
                `### 💰 ${isSelf ? 'Your' : `${targetUser.username}'s`} Balance\n` +
                `**${balance.toLocaleString()}** coins`
            )
            .setColor(0xf1c40f)
            .setThumbnail(targetUser.displayAvatarURL());

        return interaction.reply({ embeds: [embed] });
    },
};
