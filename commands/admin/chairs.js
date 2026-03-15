const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;       // 1 minute to join
const MIN_PLAYERS = 3;                     // need at least 3
const SEAT_TIMEOUT_MS = 10 * 1000;         // 10s to grab a seat
const MIN_MUSIC_S = 3;                     // shortest music
const MAX_MUSIC_S = 8;                     // longest music

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}:${String(sec).padStart(2, '0')}`;
    return `${sec}s`;
}

// ——— Flavor text ———

const MUSIC_FLAVOR = [
    '🎵 The music is playing...',
    '🎶 Music\'s on... stay ready...',
    '🎵 Don\'t blink...',
    '🎶 Keep your eyes on the screen...',
    '🎵 It could stop any second...',
    '🎶 Any moment now...',
    '🎵 Still going...',
    '🎶 Waiting...',
    '🎵 Are you even ready?',
    '🎶 Stay on your toes...',
];

const MUSIC_STOP_FLAVOR = [
    '## 🔇 MUSIC STOPPED — GRAB A SEAT',
    '## 🔇 NOW — SIT DOWN',
    '## 🔇 GO GO GO',
    '## 🔇 THE MUSIC STOPPED',
    '## 🔇 QUICK — FIND A CHAIR',
];

const ELIM_FLAVOR = [
    '### 💀 {name} is standing\nNo chair. No mercy.',
    '### 💀 {name} didn\'t make it\nToo slow.',
    '### 💀 {name} got left out\nShould\'ve clicked faster.',
    '### 💀 {name} is OUT\nEveryone else sat down.',
    '### 💀 {name} froze\nThe chairs were right there.',
    '### 💀 {name} choked\nHad all the time in the world.',
];

const AFK_ELIM_FLAVOR = [
    '### 💀 {name} didn\'t even try\nFree seat wasted.',
    '### 💀 {name} was AFK\nEasiest round for everyone else.',
    '### 💀 {name} must\'ve left\nChair\'s still warm.',
];

const CLOSE_CALL_FLAVOR = [
    '{name} grabbed the **last seat**. Barely.',
    '{name} squeezed in at the last possible second.',
    '{name} JUST made it — one tick later and they\'re out.',
    'That was TIGHT — {name} got the final chair.',
];

const FINAL_SHOWDOWN = [
    '### ⚡ Final Round\nOne chair. Two players. Pure speed.',
    '### ⚡ The Showdown\nWhoever sits first wins it all.',
    '### ⚡ Last Round\nOne seat left. Don\'t blink.',
];

const SEAT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
                     'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];

// ——— Build seat buttons ———
function buildSeatButtons(gameId, seatCount) {
    const labels = shuffle([...SEAT_LABELS].slice(0, Math.max(seatCount, 1)));
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;

    for (let i = 0; i < seatCount; i++) {
        if (count > 0 && count % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${gameId}_seat_${i}`)
                .setLabel(`Seat ${labels[i]}`)
                .setEmoji('🪑')
                .setStyle(ButtonStyle.Success),
        );
        count++;
    }

    if (count > 0) rows.push(currentRow);
    return rows.slice(0, 5); // Discord max 5 rows
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chairs')
        .setDescription('Musical Chairs — grab a seat or get eliminated! Last one standing wins. (Admin)')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to play in').setRequired(true))
        .addStringOption(opt =>
            opt.setName('card').setDescription('Card to drop (leave empty for random)').setRequired(false).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const cards = dm.getCards();
        const results = [{ name: '🎲 Random Card', value: 'random' }];
        const filtered = cards
            .filter(c => c.name.toLowerCase().includes(focused) || c.id.includes(focused))
            .slice(0, 24);
        results.push(...filtered.map(c => ({
            name: `${c.name} (${c.rarity})`,
            value: c.id,
        })));
        await interaction.respond(results.slice(0, 25));
    },

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized.', ephemeral: true });
        }

        const cards = dm.getCards();
        if (cards.length === 0) {
            return interaction.reply({ content: '❌ No cards in the pool!', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const cardChoice = interaction.options.getString('card') || 'random';

        let card;
        if (cardChoice === 'random') {
            card = dm.getRandomCard();
        } else {
            card = dm.findCardById(cardChoice);
        }

        if (!card) {
            return interaction.reply({ content: '❌ Card not found!', ephemeral: true });
        }

        const emoji = config.rarityEmojis[card.rarity] || '⚪';
        const color = config.rarityColors[card.rarity] || '#9e9e9e';
        const colorInt = parseInt(color.replace('#', ''), 16);

        await interaction.reply({ content: `✅ Musical Chairs dropped in ${channel}!`, ephemeral: true });

        // ══════════════════════════════════════════
        //  PHASE 1 — JOIN
        // ══════════════════════════════════════════

        const participants = new Map();
        const gameId = `chairs_${Date.now()}`;
        const endsAt = Date.now() + JOIN_DURATION_MS;

        function buildJoinEmbed() {
            const remaining = Math.max(0, endsAt - Date.now());
            const names = [...participants.values()];
            const list = names.length > 0
                ? names.map(n => `╰ ${n}`).join('\n')
                : '*No one yet...*';

            return new EmbedBuilder()
                .setDescription(
                    `### 🪑 Musical Chairs — ${card.name}\n` +
                    `${emoji} ${cap(card.rarity)} card up for grabs\n\n` +
                    `Music plays, then stops.\nGrab a seat — there's always **one less** than needed.\nLeft standing? You're **out**.\n\n` +
                    `Closes in **${formatTime(remaining)}** · Need **${MIN_PLAYERS}+** players\n\n` +
                    `**${names.length}** joined\n${list}`
                )
                .setThumbnail(card.imageUrl)
                .setColor(colorInt)
                .setFooter({ text: 'Join now — it\'s all about reaction speed' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${gameId}_join`)
                .setLabel('Join')
                .setStyle(ButtonStyle.Secondary),
        );

        let msg = await channel.send({
            embeds: [buildJoinEmbed()],
            components: [joinRow],
        });

        const countdownInterval = setInterval(async () => {
            if (endsAt - Date.now() <= 0) {
                clearInterval(countdownInterval);
                return;
            }
            await msg.edit({ embeds: [buildJoinEmbed()] }).catch(() => {});
        }, 15_000);

        const joinCollector = msg.createMessageComponentCollector({
            filter: (i) => i.customId === `${gameId}_join`,
            time: JOIN_DURATION_MS,
        });

        joinCollector.on('collect', async (i) => {
            if (participants.has(i.user.id)) {
                await i.reply({ content: 'You already joined.', ephemeral: true });
                return;
            }
            participants.set(i.user.id, i.user.globalName || i.user.username);
            await i.update({ embeds: [buildJoinEmbed()] });
        });

        joinCollector.on('end', async () => {
            clearInterval(countdownInterval);

            if (participants.size < MIN_PLAYERS) {
                const failEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🪑 Musical Chairs Cancelled\n` +
                        `Needed **${MIN_PLAYERS}** players, only **${participants.size}** joined.`
                    )
                    .setColor(0x2b2d31);

                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(joinRow.components[0]).setDisabled(true),
                );
                await msg.edit({ embeds: [failEmbed], components: [disabledRow] }).catch(() => {});
                return;
            }

            // ══════════════════════════════════════════
            //  PHASE 2 — THE GAME
            // ══════════════════════════════════════════

            const alive = [...participants.keys()];
            const eliminated = [];
            let roundNum = 0;

            // Delete join message, send fresh game message
            await msg.delete().catch(() => {});

            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 🪑 Musical Chairs is starting...` });
            await msg.edit({ content: '### 🪑 Musical Chairs is starting...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                roundNum++;
                const seatCount = alive.length - 1;
                const isFinal = alive.length === 2;

                // Music duration — shrinks over rounds
                const maxT = Math.max(MIN_MUSIC_S, MAX_MUSIC_S - Math.floor(roundNum * 0.7));
                const minT = Math.min(MIN_MUSIC_S, maxT);
                const musicMs = randInt(minT, maxT) * 1000;

                // Build alive list
                const aliveList = alive.map(id => `╰ ${participants.get(id)}`).join('\n');
                const elimList = eliminated.length > 0
                    ? eliminated.map(id => `~~${participants.get(id)}~~`).join(', ')
                    : null;

                // Final showdown header
                let headerText = '';
                if (isFinal) {
                    headerText = FINAL_SHOWDOWN[Math.floor(Math.random() * FINAL_SHOWDOWN.length)] + '\n\n';
                }

                // ——— Music phase ———
                const musicFlavor1 = MUSIC_FLAVOR[Math.floor(Math.random() * MUSIC_FLAVOR.length)];

                const musicEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🪑 Musical Chairs — ${card.name}\n` +
                        headerText +
                        `${musicFlavor1}\n\n` +
                        `**${seatCount}** seat${seatCount > 1 ? 's' : ''} for **${alive.length}** players\n\n` +
                        `**Alive (${alive.length})**\n${aliveList}` +
                        (elimList ? `\n\nOut: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(isFinal ? 0xed4245 : 0xfee75c)
                    .setFooter({ text: `Round ${roundNum} · Music is playing...` });

                await msg.edit({ content: '', embeds: [musicEmbed], components: [] }).catch(() => {});

                // Wait with a suspense update partway through
                if (musicMs > 4000) {
                    const firstWait = randInt(1500, Math.floor(musicMs * 0.5));
                    await new Promise(r => setTimeout(r, firstWait));

                    // Suspense update — change the flavor text
                    const musicFlavor2 = MUSIC_FLAVOR[Math.floor(Math.random() * MUSIC_FLAVOR.length)];
                    const suspenseEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 🪑 Musical Chairs — ${card.name}\n` +
                            headerText +
                            `${musicFlavor2}\n\n` +
                            `**${seatCount}** seat${seatCount > 1 ? 's' : ''} for **${alive.length}** players\n\n` +
                            `**Alive (${alive.length})**\n${aliveList}` +
                            (elimList ? `\n\nOut: ${elimList}` : '')
                        )
                        .setThumbnail(card.imageUrl)
                        .setColor(isFinal ? 0xed4245 : 0xfee75c)
                        .setFooter({ text: `Round ${roundNum} · Music is playing...` });

                    await msg.edit({ embeds: [suspenseEmbed] }).catch(() => {});
                    await new Promise(r => setTimeout(r, musicMs - firstWait));
                } else {
                    await new Promise(r => setTimeout(r, musicMs));
                }

                // ——— MUSIC STOPS — show seats ———
                const seated = new Map(); // playerId -> seat label
                const seatOrder = [];     // order of who sat

                const stopFlavor = MUSIC_STOP_FLAVOR[Math.floor(Math.random() * MUSIC_STOP_FLAVOR.length)];
                const seatRows = buildSeatButtons(gameId, seatCount);

                const stopEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🪑 Musical Chairs — ${card.name}\n` +
                        `${stopFlavor}\n\n` +
                        `**${seatCount}** seat${seatCount > 1 ? 's' : ''} — **${alive.length}** players — someone\'s out`
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(0xed4245)
                    .setFooter({ text: `Round ${roundNum} · GRAB A SEAT` });

                await msg.edit({ embeds: [stopEmbed], components: seatRows }).catch(() => {});

                // ——— Collect seat claims ———
                await new Promise((resolve) => {
                    const collector = msg.createMessageComponentCollector({
                        filter: (i) => i.customId.startsWith(`${gameId}_seat_`),
                        time: SEAT_TIMEOUT_MS,
                    });

                    collector.on('collect', async (i) => {
                        if (!alive.includes(i.user.id)) {
                            await i.reply({ content: 'You\'re not in this game.', ephemeral: true }).catch(() => {});
                            return;
                        }

                        if (seated.has(i.user.id)) {
                            await i.reply({ content: 'You already have a seat! 🪑', ephemeral: true }).catch(() => {});
                            return;
                        }

                        if (seated.size >= seatCount) {
                            await i.reply({ content: '❌ Too slow — all seats are taken.', ephemeral: true }).catch(() => {});
                            collector.stop('full');
                            return;
                        }

                        const seatIndex = parseInt(i.customId.replace(`${gameId}_seat_`, ''));
                        seated.set(i.user.id, SEAT_LABELS[seatIndex] || '?');
                        seatOrder.push(i.user.id);

                        const seatsLeft = seatCount - seated.size;
                        if (seatsLeft === 0) {
                            await i.reply({ content: '🪑 Got the **last seat!**', ephemeral: true }).catch(() => {});
                            collector.stop('full');
                        } else {
                            await i.reply({ content: `🪑 Seated! **${seatsLeft}** seat${seatsLeft > 1 ? 's' : ''} left.`, ephemeral: true }).catch(() => {});
                        }
                    });

                    collector.on('end', () => resolve());
                });

                // ——— Determine who's out ———
                const standingPlayers = alive.filter(id => !seated.has(id));

                if (standingPlayers.length === 0) {
                    // Everyone sat somehow (shouldn't happen, but safety)
                    continue;
                }

                // Remove standing players
                for (const id of standingPlayers) {
                    alive.splice(alive.indexOf(id), 1);
                    eliminated.push(id);
                }

                // Build result embed
                const isAfk = seatOrder.length < seatCount; // not all seats were taken = someone AFK'd
                const elimName = standingPlayers.map(id => `**${participants.get(id)}**`).join(', ');

                let elimText;
                if (standingPlayers.length === 1) {
                    const flavors = isAfk ? AFK_ELIM_FLAVOR : ELIM_FLAVOR;
                    elimText = flavors[Math.floor(Math.random() * flavors.length)]
                        .replace('{name}', participants.get(standingPlayers[0]));
                } else {
                    // Multiple players eliminated (mass AFK)
                    elimText = `### 💀 ${elimName} didn't make it\nMultiple players left standing.`;
                }

                // Close call callout — last person to sit
                let closeCallText = '';
                if (seatOrder.length >= seatCount && seatOrder.length >= 2) {
                    const lastSeated = seatOrder[seatOrder.length - 1];
                    const ccFlavor = CLOSE_CALL_FLAVOR[Math.floor(Math.random() * CLOSE_CALL_FLAVOR.length)]
                        .replace('{name}', participants.get(lastSeated));
                    closeCallText = `\n${ccFlavor}\n`;
                }

                // Show who sat where
                const seatedList = seatOrder.map((id, i) => {
                    const label = seated.get(id);
                    const position = i === seatOrder.length - 1 ? ' ← last seat' : '';
                    return `🪑 ${participants.get(id)}${position}`;
                }).join('\n');

                const resultEmbed = new EmbedBuilder()
                    .setDescription(
                        elimText + '\n' +
                        closeCallText +
                        `\n**Seated**\n${seatedList}\n\n` +
                        `**${alive.length}** remain`
                    )
                    .setColor(0xed4245);

                await msg.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
                await new Promise(r => setTimeout(r, 2500));

                if (alive.length <= 1) break;
            }

            // ══════════════════════════════════════════
            //  PHASE 3 — VICTORY
            // ══════════════════════════════════════════

            if (alive.length === 0) {
                const noWinnerEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🪑 Musical Chairs — No Winner\n` +
                        `Everyone got eliminated. The card goes unclaimed.`
                    )
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [noWinnerEmbed], components: [] }).catch(() => {});
                return;
            }

            const winnerId = alive[0];
            const winnerName = participants.get(winnerId);
            dm.addCardToUser(winnerId, winnerName, card.id);

            const suspenseEmbed = new EmbedBuilder()
                .setDescription(`### Last one seated...`)
                .setColor(0x2b2d31);
            await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            const elimOrder = eliminated.map((id, i) => {
                const place = eliminated.length - i + 1;
                return `${place}. ~~${participants.get(id)}~~`;
            });

            const victoryEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏆 ${winnerName} wins Musical Chairs\n\n` +
                    `Claimed ${emoji} **${card.name}** · ${cap(card.rarity)}\n\n` +
                    `**Final standings**\n` +
                    `1. **${winnerName}**\n` +
                    elimOrder.reverse().join('\n') +
                    `\n_${roundNum} rounds · ${participants.size} players · ${eliminated.length} eliminated_`
                )
                .setImage(card.imageUrl)
                .setColor(0x4caf50)
                .setTimestamp();

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
