const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const DEFAULT_DURATION_SEC = 30;

const NORMAL_OUTCOMES = [
    { type: 'card', rarity: 'common', weight: 40 },
    { type: 'card', rarity: 'uncommon', weight: 25 },
    { type: 'card', rarity: 'rare', weight: 12 },
    { type: 'card', rarity: 'epic', weight: 4 },
    { type: 'card', rarity: 'legendary', weight: 1 },
    { type: 'nothing', weight: 13 },
    { type: 'snag', weight: 5 },
];

const NORMAL_INTROS = [
    'The water is calm. Good day for a cast.',
    'The tide is turning — perfect window.',
    'Overcast sky. Fish sit higher when the sun hides.',
    'Fresh ripples in the shallows. Something\'s feeding.',
    'Low wind, glassy surface. Read the water carefully.',
    'Cool morning. The shallows are just starting to warm.',
    'Mayflies on the surface. They\'re up top today.',
];

const EVENT_MODES = {
    normal: {
        weight: 78,
        title: '🎣 A fishing spot appeared',
        color: 0x2196f3,
        outcomes: NORMAL_OUTCOMES,
    },
    storm: {
        weight: 9,
        title: '🌩 STORM ROLLING IN',
        intro: 'Rain lashes the surface. The big ones rise in weather like this — but so does the risk.',
        color: 0x512da8,
        outcomes: [
            { type: 'card', rarity: 'common', weight: 20 },
            { type: 'card', rarity: 'uncommon', weight: 22 },
            { type: 'card', rarity: 'rare', weight: 20 },
            { type: 'card', rarity: 'epic', weight: 10 },
            { type: 'card', rarity: 'legendary', weight: 3 },
            { type: 'nothing', weight: 10 },
            { type: 'snag', weight: 15 },
        ],
    },
    frenzy: {
        weight: 8,
        title: '🐟 THEY\'RE BITING — feeding frenzy',
        intro: 'The school is running hot. Every line will find something. No snags today.',
        color: 0x00c853,
        outcomes: [
            { type: 'card', rarity: 'common', weight: 38 },
            { type: 'card', rarity: 'uncommon', weight: 30 },
            { type: 'card', rarity: 'rare', weight: 20 },
            { type: 'card', rarity: 'epic', weight: 10 },
            { type: 'card', rarity: 'legendary', weight: 2 },
        ],
    },
    kraken: {
        weight: 5,
        title: '🐙 THE KRAKEN RISES',
        intro: 'Something massive moves beneath the boats. Only one will land it. The rest get pulled under.',
        color: 0x1a237e,
        special: 'kraken',
    },
};

function rollEvent() {
    const entries = Object.entries(EVENT_MODES);
    const total = entries.reduce((s, [, m]) => s + m.weight, 0);
    let roll = Math.random() * total;
    for (const [key, mode] of entries) {
        roll -= mode.weight;
        if (roll <= 0) return { key, ...mode };
    }
    return { key: 'normal', ...EVENT_MODES.normal };
}

function rollOutcome(outcomes) {
    const total = outcomes.reduce((s, o) => s + o.weight, 0);
    let roll = Math.random() * total;
    for (const o of outcomes) {
        roll -= o.weight;
        if (roll <= 0) return o;
    }
    return outcomes[outcomes.length - 1];
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

const RARITY_TIER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
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
        const event = rollEvent();
        const intro = event.intro ?? NORMAL_INTROS[Math.floor(Math.random() * NORMAL_INTROS.length)];

        const footerText = event.key === 'kraken'
            ? 'Only one lands the kraken. The rest lose a card.'
            : event.key === 'frenzy'
                ? 'No snags. Everyone catches something.'
                : event.key === 'storm'
                    ? 'Higher rewards. Higher risk.'
                    : 'One cast per player. Snags lose a random card.';

        const buildEmbed = () => new EmbedBuilder()
            .setTitle(event.title)
            .setDescription(
                `*${intro}*\n\n` +
                `Click **Cast Line** to throw your hook in.\n` +
                `The spot dries up <t:${endsAt}:R>.\n\n` +
                `_Casters: ${casters.size}_`
            )
            .setColor(event.color)
            .setFooter({ text: footerText });

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
                    .setTitle(`${event.title} — dried up`)
                    .setDescription('Nobody cast a line. The water goes still again.')
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [emptyEmbed], components: [disabledRow] }).catch(() => { });
                return;
            }

            // Compute all results upfront. { tier, line } — tier sorts reveal order.
            const results = [];

            if (event.special === 'kraken') {
                const casterArray = [...casters.entries()];
                const winnerIdx = Math.floor(Math.random() * casterArray.length);

                casterArray.forEach(([userId, username], idx) => {
                    if (idx === winnerIdx) {
                        const card = dm.getRandomCardMinRarity('rare') || dm.getRandomCard();
                        if (!card) {
                            results.push({ tier: 6, line: `🐙 **${username}** grappled with the kraken — but the pool was empty` });
                            return;
                        }
                        dm.addCardToUser(userId, username, card.id);
                        const emoji = config.rarityEmojis[card.rarity] || '⚪';
                        const rarityName = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                        results.push({
                            tier: 6,
                            line: `🐙 **${username}** landed the kraken — ${emoji} **${card.name}** · ${rarityName}`,
                        });
                    } else {
                        const owned = pickRandomOwnedCard(userId);
                        if (!owned) {
                            results.push({ tier: 0, line: `🪝 **${username}** was pulled under — nothing left to take` });
                            return;
                        }
                        const card = dm.findCardById(owned.cardId);
                        dm.removeCardFromUser(userId, owned.cardId);
                        const emoji = card ? (config.rarityEmojis[card.rarity] || '⚪') : '⚪';
                        const name = card ? card.name : owned.cardId;
                        results.push({
                            tier: 0,
                            line: `🪝 **${username}** went under with ${emoji} **${name}**`,
                        });
                    }
                });
            } else {
                for (const [userId, username] of casters) {
                    const outcome = rollOutcome(event.outcomes);

                    if (outcome.type === 'card') {
                        const card = pickCardOfRarity(outcome.rarity);
                        if (!card) {
                            results.push({ tier: 0, line: `🎣 **${username}** — line came up empty` });
                            continue;
                        }
                        dm.addCardToUser(userId, username, card.id);
                        const emoji = config.rarityEmojis[card.rarity] || '⚪';
                        const rarityName = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);
                        results.push({
                            tier: RARITY_TIER[card.rarity] ?? 1,
                            line: `🎣 **${username}** — ${emoji} **${card.name}** · ${rarityName}`,
                        });
                    } else if (outcome.type === 'nothing') {
                        results.push({ tier: 0, line: `🎣 **${username}** — line came up empty` });
                    } else {
                        const owned = pickRandomOwnedCard(userId);
                        if (!owned) {
                            results.push({ tier: 0, line: `🪝 **${username}** — hook snagged, but had nothing to lose` });
                            continue;
                        }
                        const card = dm.findCardById(owned.cardId);
                        dm.removeCardFromUser(userId, owned.cardId);
                        const emoji = card ? (config.rarityEmojis[card.rarity] || '⚪') : '⚪';
                        const name = card ? card.name : owned.cardId;
                        results.push({
                            tier: 0,
                            line: `🪝 **${username}** — snagged, lost ${emoji} **${name}**`,
                        });
                    }
                }
            }

            // Sort ascending: losses/nothings first, legendaries/kraken last.
            results.sort((a, b) => a.tier - b.tier);

            // --- Staged reveal ---
            const revealTitle = '🎣 Reeling in...';

            const makeStageEmbed = (desc, revealedLines) => new EmbedBuilder()
                .setTitle(revealTitle)
                .setDescription(
                    `*${intro}*\n\n` +
                    (revealedLines.length ? revealedLines.join('\n') + '\n\n' : '') +
                    `_${desc}_`
                )
                .setColor(event.color);

            await msg.edit({ embeds: [makeStageEmbed('The lines go taut...', [])], components: [disabledRow] }).catch(() => { });
            await sleep(1100);

            await msg.edit({ embeds: [makeStageEmbed('Something\'s taking the bait...', [])], components: [disabledRow] }).catch(() => { });
            await sleep(1100);

            // Reveal in tiers: losses → low → mid → high/kraken.
            const tierGroups = [
                { max: 0, flavor: 'Lines coming in empty...' },
                { max: 2, flavor: 'A few keepers on the stringer...' },
                { max: 4, flavor: 'The rod bends hard...' },
                { max: 6, flavor: 'Something the lake doesn\'t usually give up...' },
            ];

            const revealed = [];
            let cursor = 0;
            for (const group of tierGroups) {
                const take = [];
                while (cursor < results.length && results[cursor].tier <= group.max) {
                    take.push(results[cursor].line);
                    cursor++;
                }
                if (take.length === 0) continue;
                revealed.push(...take);
                await msg.edit({ embeds: [makeStageEmbed(group.flavor, revealed)], components: [disabledRow] }).catch(() => { });
                await sleep(1000);
            }

            // Final embed
            const finalEmbed = new EmbedBuilder()
                .setTitle(`${event.title} — catches are in`)
                .setDescription(`*${intro}*\n\n${revealed.join('\n')}`)
                .setColor(event.color)
                .setTimestamp();

            await msg.edit({ embeds: [finalEmbed], components: [disabledRow] }).catch(() => { });
        });
    },
};
