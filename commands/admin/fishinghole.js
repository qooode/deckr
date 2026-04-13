const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const DEFAULT_DURATION_SEC = 30;

const FISH_OUTCOMES = [
    { type: 'card', rarity: 'common', weight: 40 },
    { type: 'card', rarity: 'uncommon', weight: 25 },
    { type: 'card', rarity: 'rare', weight: 12 },
    { type: 'card', rarity: 'epic', weight: 4 },
    { type: 'card', rarity: 'legendary', weight: 1 },
    { type: 'nothing', weight: 13 },
    { type: 'snag', weight: 5 },
];

function rollOutcome() {
    const total = FISH_OUTCOMES.reduce((s, o) => s + o.weight, 0);
    let roll = Math.random() * total;
    for (const o of FISH_OUTCOMES) {
        roll -= o.weight;
        if (roll <= 0) return o;
    }
    return FISH_OUTCOMES[FISH_OUTCOMES.length - 1];
}

function pickCardOfRarity(rarity) {
    const pool = dm.getCards().filter(c => c.rarity === rarity);
    if (pool.length === 0) return dm.getRandomCard();
    return pool[Math.floor(Math.random() * pool.length)];
}

function pickRandomOwnedCard(userId) {
    const owned = dm.getUserInventory(userId).filter(e => e.quantity > 0);
    if (owned.length === 0) return null;
    return owned[Math.floor(Math.random() * owned.length)];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fishinghole')
        .setDescription('Drop a fishing hole in a channel (Admin only)')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to drop the fishing hole in').setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('duration')
                .setDescription(`How long to cast, in seconds (default ${DEFAULT_DURATION_SEC})`)
                .setRequired(false)
                .setMinValue(10)
                .setMaxValue(300))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        if (dm.getCards().length === 0) {
            return interaction.reply({ content: '❌ No cards in the pool. Create some with `/createcard` first.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const durationSec = interaction.options.getInteger('duration') ?? DEFAULT_DURATION_SEC;
        const durationMs = durationSec * 1000;
        const endsAt = Math.floor((Date.now() + durationMs) / 1000);

        const casters = new Map(); // userId -> username

        const buildEmbed = () => new EmbedBuilder()
            .setTitle('🎣 A fishing spot appeared!')
            .setDescription(
                `Click **Cast Line** to join the catch.\n` +
                `The spot dries up <t:${endsAt}:R>.\n\n` +
                `_Casters: ${casters.size}_`
            )
            .setColor(0x2196f3)
            .setFooter({ text: 'One cast per player. Snags lose a random card.' });

        const castRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`fish_cast_${Date.now()}`)
                .setLabel('Cast Line')
                .setEmoji('🎣')
                .setStyle(ButtonStyle.Primary),
        );

        await interaction.reply({ content: `✅ Fishing hole dropped in ${channel}!`, ephemeral: true });

        const msg = await channel.send({ embeds: [buildEmbed()], components: [castRow] });

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.customId.startsWith('fish_cast_'),
            time: durationMs,
        });

        collector.on('collect', async (i) => {
            if (casters.has(i.user.id)) {
                return i.reply({ content: '🎣 Your line is already in the water. Wait for the results!', ephemeral: true });
            }
            casters.set(i.user.id, i.user.username);

            await i.update({ embeds: [buildEmbed()], components: [castRow] });
        });

        collector.on('end', async () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(castRow.components[0])
                    .setDisabled(true)
                    .setLabel('Spot dried up'),
            );

            if (casters.size === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setTitle('🎣 Fishing spot dried up')
                    .setDescription('No one cast a line.')
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [emptyEmbed], components: [disabledRow] }).catch(() => { });
                return;
            }

            const lines = [];

            for (const [userId, username] of casters) {
                const outcome = rollOutcome();
                let line;

                if (outcome.type === 'card') {
                    const card = pickCardOfRarity(outcome.rarity);
                    if (!card) {
                        line = `🎣 **${username}** — caught nothing`;
                    } else {
                        dm.addCardToUser(userId, username, card.id);
                        const emoji = config.rarityEmojis[card.rarity] || '⚪';
                        const rarityName = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                        line = `🎣 **${username}** — caught ${emoji} **${card.name}** · ${rarityName}`;
                    }
                } else if (outcome.type === 'nothing') {
                    line = `🎣 **${username}** — caught nothing`;
                } else {
                    const owned = pickRandomOwnedCard(userId);
                    if (!owned) {
                        line = `🎣 **${username}** — caught nothing _(nothing to snag)_`;
                    } else {
                        const card = dm.findCardById(owned.cardId);
                        dm.removeCardFromUser(userId, owned.cardId);
                        const emoji = card ? (config.rarityEmojis[card.rarity] || '⚪') : '⚪';
                        const name = card ? card.name : owned.cardId;
                        line = `🪝 **${username}** — got snagged! Lost ${emoji} **${name}**`;
                    }
                }

                lines.push(line);
            }

            const resultEmbed = new EmbedBuilder()
                .setTitle('🎣 The catches are in!')
                .setDescription(lines.join('\n'))
                .setColor(0x2196f3)
                .setTimestamp();

            await msg.edit({ embeds: [resultEmbed], components: [disabledRow] }).catch(() => { });
        });
    },
};
