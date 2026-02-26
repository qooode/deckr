const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const MAX_HP = 3;
const RARITY_BONUS = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

const HIT_LINES = [
    '💥 Direct hit!', '� Solid strike!', '⚡ Landed clean!',
    '� Ouch!', '🎯 That connected!', '� Felt that one!',
];
const CLASH_LINES = [
    '⚡ Clash! Both hold.', '💨 Both dodge!',
    '🔄 Stalemate!', '🤝 Tied! No damage.',
];
const KO_LINES = [
    '� K.O.!', '☠️ DESTROYED!', '🏆 IT\'S OVER!', '⚡ FINISHED!',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function dice() { return Math.floor(Math.random() * 6) + 1; }
function hpBar(hp) { return '❤️'.repeat(hp) + '🩶'.repeat(MAX_HP - hp); }

function fightEmbed(round, c1, c2, n1, n2, hp1, hp2, statusText) {
    const e1 = config.rarityEmojis[c1.rarity] || '⚪';
    const e2 = config.rarityEmojis[c2.rarity] || '⚪';
    const embed = new EmbedBuilder()
        .setTitle(`⚔️ Round ${round}`)
        .setColor(0xed4245)
        .setDescription(
            `${e1} **${c1.name}**\n${hpBar(hp1)} — ${n1}\n\n` +
            `**VS**\n\n` +
            `${e2} **${c2.name}**\n${hpBar(hp2)} — ${n2}\n\n` +
            `───────────────\n${statusText}`
        );
    return embed;
}

function rollRow(duelId) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${duelId}_roll`)
            .setLabel('Roll 🎲')
            .setStyle(ButtonStyle.Primary),
    )];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Stake a card and fight — winner takes all!')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Who to duel').setRequired(true))
        .addStringOption(opt =>
            opt.setName('card').setDescription('Card you\'re staking').setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const inv = dm.getUserInventory(interaction.user.id);
        const all = dm.getCards();
        const owned = inv.filter(c => c.quantity > 0).map(c => c.cardId);
        const results = all
            .filter(c => owned.includes(c.id) && c.name.toLowerCase().includes(focused))
            .slice(0, 25);
        await interaction.respond(results.map(c => ({
            name: `${c.name} (${c.rarity})`,
            value: c.id,
        })));
    },

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const cardId = interaction.options.getString('card');

        if (target.id === interaction.user.id) return interaction.reply({ content: '❌ You can\'t duel yourself.', ephemeral: true });
        if (target.bot) return interaction.reply({ content: '❌ Bots don\'t play cards.', ephemeral: true });

        const card1 = dm.findCardById(cardId);
        if (!card1) return interaction.reply({ content: '❌ Card not found.', ephemeral: true });
        if (!dm.userHasCard(interaction.user.id, cardId)) return interaction.reply({ content: `❌ You don't own **${card1.name}**.`, ephemeral: true });
        if (dm.isCardLocked(interaction.user.id, cardId)) return interaction.reply({ content: `❌ **${card1.name}** is already staked in another duel!`, ephemeral: true });
        if (dm.isInDuel(interaction.user.id)) return interaction.reply({ content: '❌ You\'re already in a duel! Finish it first.', ephemeral: true });
        if (dm.isInDuel(target.id)) return interaction.reply({ content: `❌ **${target.username}** is already in a duel!`, ephemeral: true });

        const duelId = `duel_${Date.now()}`;
        const e1 = config.rarityEmojis[card1.rarity] || '⚪';
        const r1Label = card1.rarity.charAt(0).toUpperCase() + card1.rarity.slice(1);
        const name1 = interaction.user.username;
        const name2 = target.username;
        const id1 = interaction.user.id;
        const id2 = target.id;

        // ——— Challenge ———
        const challengeEmbed = new EmbedBuilder()
            .setTitle('⚔️ Duel Challenge')
            .setColor(0xed4245)
            .setDescription(
                `**${name1}** wants to fight!\n\n` +
                `Staking: ${e1} **${card1.name}** · ${r1Label}\n\n` +
                `${target}, accept?`
            )
            .setFooter({ text: 'Winner takes the loser\'s card' });

        if (card1.imageUrl) challengeEmbed.setImage(card1.imageUrl);

        const challengeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${duelId}_accept`).setLabel('Accept ⚔️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`${duelId}_decline`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
        );

        const reply = await interaction.reply({
            content: `${target}`,
            embeds: [challengeEmbed],
            components: [challengeRow],
            fetchReply: true,
        });

        // Mark both players as in a duel
        dm.setInDuel(id1);
        dm.setInDuel(id2);

        // ——— State ———
        let card2 = null;
        let hp1 = MAX_HP, hp2 = MAX_HP;
        let round = 0;
        let rolls = {};
        let phase = 'challenge';
        let resolving = false;
        let roundTimer = null;

        function cleanup() {
            clearTimeout(roundTimer);
            dm.unlockCard(id1, card1.id);
            if (card2) dm.unlockCard(id2, card2.id);
            dm.clearDuel(id1);
            dm.clearDuel(id2);
        }

        const collector = reply.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        function startRoundTimer() {
            clearTimeout(roundTimer);
            roundTimer = setTimeout(async () => {
                if (resolving || phase !== 'fight') return;
                resolving = true;
                collector.stop('round_timeout');

                const p1Rolled = !!rolls[id1];
                const p2Rolled = !!rolls[id2];
                let msg;
                if (!p1Rolled && !p2Rolled) {
                    msg = '⏰ Neither player rolled. Duel cancelled — no cards lost.';
                } else if (!p1Rolled) {
                    msg = `⏰ **${name1}** didn't roll. **${name2}** wins by forfeit!\nTook ${e1} **${card1.name}** from ${name1}`;
                    dm.transferCard(id1, id2, name2, card1.id);
                } else {
                    const e2 = config.rarityEmojis[card2.rarity] || '⚪';
                    msg = `⏰ **${name2}** didn't roll. **${name1}** wins by forfeit!\nTook ${e2} **${card2.name}** from ${name2}`;
                    dm.transferCard(id2, id1, name1, card2.id);
                }
                await reply.edit({
                    content: '', components: [],
                    embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(msg)],
                }).catch(() => { });
            }, 30_000);
        }

        collector.on('collect', async (i) => {
            // ——— CHALLENGE PHASE ———
            if (phase === 'challenge') {
                if (i.user.id !== id2) return i.reply({ content: '❌ This duel isn\'t for you.', ephemeral: true });

                if (i.customId === `${duelId}_decline`) {
                    cleanup();
                    collector.stop('declined');
                    return i.update({
                        content: '', components: [],
                        embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(`**${name2}** declined. No cards lost.`)],
                    });
                }

                if (i.customId === `${duelId}_accept`) {
                    // Show card picker
                    const targetInv = dm.getUserInventory(id2);
                    const allCards = dm.getCards();
                    const targetOwned = targetInv
                        .filter(e => e.quantity > 0)
                        .map(e => allCards.find(c => c.id === e.cardId))
                        .filter(Boolean);

                    if (targetOwned.length === 0) {
                        cleanup();
                        collector.stop('no_cards');
                        return i.update({
                            content: '', components: [],
                            embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(`❌ **${name2}** has no cards to stake.`)],
                        });
                    }

                    phase = 'card_select';
                    targetOwned.sort((a, b) => {
                        const ai = RARITY_ORDER.indexOf(a.rarity);
                        const bi = RARITY_ORDER.indexOf(b.rarity);
                        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                    });
                    const options = targetOwned.slice(0, 25).map(c => ({
                        label: c.name,
                        description: c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1),
                        value: c.id,
                        emoji: config.rarityEmojis[c.rarity] || '⚪',
                    }));
                    const menu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`${duelId}_pick`)
                            .setPlaceholder('Pick your card to stake...')
                            .addOptions(options),
                    );
                    return i.update({
                        content: '', components: [menu],
                        embeds: [new EmbedBuilder().setTitle('⚔️ Duel Accepted!').setColor(0xed4245)
                            .setDescription(
                                `**${name1}** stakes: ${e1} **${card1.name}** · ${r1Label}\n\n` +
                                `**${name2}**, pick your card below:`
                            )],
                    });
                }
                return;
            }

            // ——— CARD SELECT PHASE ———
            if (phase === 'card_select') {
                if (i.user.id !== id2) return i.reply({ content: '❌ This duel isn\'t for you.', ephemeral: true });
                if (i.customId !== `${duelId}_pick`) return;

                const pickedId = i.values[0];
                card2 = dm.findCardById(pickedId);
                if (!card2 || !dm.userHasCard(id2, pickedId)) {
                    return i.reply({ content: '❌ You no longer own that card.', ephemeral: true });
                }
                if (dm.isCardLocked(id2, pickedId)) {
                    return i.reply({ content: '❌ That card is staked in another duel!', ephemeral: true });
                }
                if (!dm.userHasCard(id1, cardId)) {
                    cleanup();
                    collector.stop('card_gone');
                    return i.update({
                        content: '', components: [],
                        embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(`❌ Duel cancelled — **${name1}** no longer owns their card.`)],
                    });
                }

                // ——— CONFIRM PHASE ———
                phase = 'confirm';
                const e2 = config.rarityEmojis[card2.rarity] || '⚪';
                const r2Label = card2.rarity.charAt(0).toUpperCase() + card2.rarity.slice(1);

                const confirmEmbed = new EmbedBuilder()
                    .setTitle('⚔️ Ready to fight?')
                    .setColor(0xed4245)
                    .setDescription(
                        `${e1} **${card1.name}** · ${r1Label} — ${name1}\n\n` +
                        `**VS**\n\n` +
                        `${e2} **${card2.name}** · ${r2Label} — ${name2}\n\n` +
                        `${name1}, do you want to fight?`
                    )
                    .setFooter({ text: 'Loser gives up their card' });

                if (card2.imageUrl) confirmEmbed.setThumbnail(card2.imageUrl);

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`${duelId}_fight`).setLabel('Fight! ⚔️').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`${duelId}_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                );

                return i.update({ content: '', embeds: [confirmEmbed], components: [confirmRow] });
            }

            // ——— CONFIRM PHASE ———
            if (phase === 'confirm') {
                if (i.user.id !== id1) return i.reply({ content: '❌ Only the challenger can confirm.', ephemeral: true });

                if (i.customId === `${duelId}_cancel`) {
                    cleanup();
                    collector.stop('cancelled');
                    return i.update({
                        content: '', components: [],
                        embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(`**${name1}** cancelled the duel. No cards lost.`)],
                    });
                }

                if (i.customId === `${duelId}_fight`) {
                    // Final ownership checks
                    if (!dm.userHasCard(id1, cardId) || !dm.userHasCard(id2, card2.id)) {
                        cleanup();
                        collector.stop('card_gone');
                        return i.update({
                            content: '', components: [],
                            embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription('❌ Duel cancelled — a card is no longer available.')],
                        });
                    }

                    // ——— START FIGHT ———
                    phase = 'fight';
                    round = 1;
                    rolls = {};
                    resolving = false;

                    // Lock both cards
                    dm.lockCard(id1, card1.id);
                    dm.lockCard(id2, card2.id);

                    const embed = fightEmbed(round, card1, card2, name1, name2, hp1, hp2,
                        'Both players, hit **Roll 🎲**!');
                    await i.update({ content: '', embeds: [embed], components: rollRow(duelId) });
                    startRoundTimer();
                    return;
                }
            }

            // ——— FIGHT PHASE ———
            if (phase === 'fight') {
                if (i.customId !== `${duelId}_roll`) return;
                if (resolving) return i.reply({ content: '⏳ Round resolving...', ephemeral: true });
                if (i.user.id !== id1 && i.user.id !== id2) return i.reply({ content: '❌ This duel isn\'t for you.', ephemeral: true });
                if (rolls[i.user.id]) return i.reply({ content: '✅ You already rolled! Waiting for the other player.', ephemeral: true });

                // Roll
                const d = dice();
                const rarity = i.user.id === id1 ? card1.rarity : card2.rarity;
                rolls[i.user.id] = d + (RARITY_BONUS[rarity] || 0);

                // Still waiting for the other player?
                if (!rolls[id1] || !rolls[id2]) {
                    const who = i.user.id === id1 ? name1 : name2;
                    const waiting = i.user.id === id1 ? name2 : name1;
                    const embed = fightEmbed(round, card1, card2, name1, name2, hp1, hp2,
                        `✅ **${who}** rolled!\n⏳ Waiting for **${waiting}**...`);
                    return i.update({ embeds: [embed], components: rollRow(duelId) });
                }

                // ——— RESOLVE ROUND ———
                resolving = true;
                clearTimeout(roundTimer);

                const t1 = rolls[id1];
                const t2 = rolls[id2];

                let resultLine;
                if (t1 > t2) {
                    hp2 = Math.max(0, hp2 - 1);
                    resultLine = `🎲 ${name1}: **${t1}** vs ${name2}: **${t2}**\n${pick(HIT_LINES)} **${card2.name}** takes a hit!`;
                } else if (t2 > t1) {
                    hp1 = Math.max(0, hp1 - 1);
                    resultLine = `🎲 ${name1}: **${t1}** vs ${name2}: **${t2}**\n${pick(HIT_LINES)} **${card1.name}** takes a hit!`;
                } else {
                    resultLine = `🎲 ${name1}: **${t1}** vs ${name2}: **${t2}**\n${pick(CLASH_LINES)}`;
                }

                const roundEmbed = fightEmbed(round, card1, card2, name1, name2, hp1, hp2, resultLine);
                await i.update({ embeds: [roundEmbed], components: [] });

                // ——— K.O. check ———
                if (hp1 <= 0 || hp2 <= 0) {
                    setTimeout(async () => {
                        const winnerId = hp1 > 0 ? id1 : id2;
                        const winnerName = hp1 > 0 ? name1 : name2;
                        const loserId = hp1 > 0 ? id2 : id1;
                        const loserName = hp1 > 0 ? name2 : name1;
                        const stolen = hp1 > 0 ? card2 : card1;
                        const stolenE = config.rarityEmojis[stolen.rarity] || '⚪';

                        dm.transferCard(loserId, winnerId, winnerName, stolen.id);

                        cleanup();

                        const e2 = config.rarityEmojis[card2.rarity] || '⚪';
                        const winnerCard = hp1 > 0 ? card1 : card2;
                        const winnerE = config.rarityEmojis[winnerCard.rarity] || '⚪';
                        const stolenRarity = stolen.rarity.charAt(0).toUpperCase() + stolen.rarity.slice(1);

                        const finalEmbed = new EmbedBuilder()
                            .setTitle(`🏆 ${winnerName} wins!`)
                            .setColor(0xfee75c)
                            .setDescription(
                                `${pick(KO_LINES)}\n\n` +
                                `${winnerE} **${winnerCard.name}** defeated ${stolenE} **${stolen.name}** in ${round} rounds\n\n` +
                                `───────────────\n\n` +
                                `**${winnerName}** took ${stolenE} **${stolen.name}** (${stolenRarity}) from **${loserName}**`
                            )
                            .setTimestamp();

                        if (stolen.imageUrl) finalEmbed.setImage(stolen.imageUrl);

                        collector.stop('finished');
                        await reply.edit({ embeds: [finalEmbed], components: [] }).catch(() => { });
                    }, 2000);
                    return;
                }

                // ——— Next round ———
                setTimeout(async () => {
                    round++;
                    rolls = {};
                    resolving = false;
                    const nextEmbed = fightEmbed(round, card1, card2, name1, name2, hp1, hp2,
                        'Both players, hit **Roll 🎲**!');
                    await reply.edit({ embeds: [nextEmbed], components: rollRow(duelId) }).catch(() => { });
                    startRoundTimer();
                }, 2000);
            }
        });

        collector.on('end', async (_, reason) => {
            cleanup();
            if (reason === 'time') {
                await reply.edit({
                    content: '', components: [],
                    embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription('⏰ Duel expired — no response. No cards lost.')],
                }).catch(() => { });
            }
        });
    },
};
