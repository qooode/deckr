const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;       // 1 minute to join
const MIN_PLAYERS = 3;                     // need at least 3
const INITIAL_TIMER_S = 8;                // first pass: 8 seconds
const TIMER_DECREMENT_S = 1;              // shrink 1s per pass
const MIN_TIMER_S = 3;                    // never below 3s

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}:${String(sec).padStart(2, '0')}`;
    return `${sec}s`;
}

// ——— Build pass buttons (up to 25 players supported) ———
function buildPassButtons(dodgeId, holderId, alivePlayers, participants) {
    const targets = alivePlayers.filter(id => id !== holderId);
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;

    for (const id of targets) {
        if (count > 0 && count % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${dodgeId}_pass_${id}`)
                .setLabel(participants.get(id))
                .setEmoji('💨')
                .setStyle(ButtonStyle.Secondary),
        );
        count++;
    }

    if (count > 0) rows.push(currentRow);
    return rows.slice(0, 5); // Discord max 5 rows
}

// ——— Wait for the holder to pass or time out ———
function waitForPass(msg, holderId, dodgeId, timerMs) {
    return new Promise((resolve) => {
        let resolved = false;

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.customId.startsWith(`${dodgeId}_pass_`),
            time: timerMs,
        });

        collector.on('collect', async (i) => {
            // Only the holder can pass
            if (i.user.id !== holderId) {
                await i.reply({ content: '💨 Not your turn — wait for the card!', ephemeral: true });
                return;
            }

            resolved = true;
            const targetId = i.customId.replace(`${dodgeId}_pass_`, '');
            collector.stop('passed');
            await i.deferUpdate();
            resolve({ passed: true, targetId });
        });

        collector.on('end', () => {
            if (!resolved) {
                resolve({ passed: false });
            }
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dodge')
        .setDescription('Drop a card — players dodge to survive! Last one standing wins. (Admin)')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to drop in').setRequired(true))
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

        await interaction.reply({ content: `✅ Dodge dropped in ${channel}!`, ephemeral: true });

        // ══════════════════════════════════════════
        //  PHASE 1 — JOIN
        // ══════════════════════════════════════════

        const participants = new Map(); // userId → display name
        const dodgeId = `dodge_${Date.now()}`;
        const endsAt = Date.now() + JOIN_DURATION_MS;

        function buildJoinEmbed() {
            const remaining = Math.max(0, endsAt - Date.now());
            const names = [...participants.values()];
            const list = names.length > 0
                ? names.map(n => `╰ ${n}`).join('\n')
                : '*No one yet...*';

            return new EmbedBuilder()
                .setDescription(
                    `### 💨 Dodge — ${card.name}\n` +
                    `${emoji} ${cap(card.rarity)} card up for grabs!\n\n` +
                    `Pass the card or get **knocked out**.\nLast player standing wins it.\n\n` +
                    `Closes in **${formatTime(remaining)}** · Need **${MIN_PLAYERS}+** players\n\n` +
                    `**${names.length}** joined\n${list}`
                )
                .setThumbnail(card.imageUrl)
                .setColor(colorInt)
                .setFooter({ text: 'Join now — once it starts, there\'s no escape!' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${dodgeId}_join`)
                .setLabel('Join')
                .setEmoji('💨')
                .setStyle(ButtonStyle.Secondary),
        );

        let msg = await channel.send({
            embeds: [buildJoinEmbed()],
            components: [joinRow],
        });

        // Live countdown
        const countdownInterval = setInterval(async () => {
            if (endsAt - Date.now() <= 0) {
                clearInterval(countdownInterval);
                return;
            }
            await msg.edit({ embeds: [buildJoinEmbed()] }).catch(() => {});
        }, 10_000);

        const joinCollector = msg.createMessageComponentCollector({
            filter: (i) => i.customId === `${dodgeId}_join`,
            time: JOIN_DURATION_MS,
        });

        joinCollector.on('collect', async (i) => {
            if (participants.has(i.user.id)) {
                return i.reply({ content: 'You already joined!', ephemeral: true });
            }
            participants.set(i.user.id, i.user.globalName || i.user.username);
            await i.update({ embeds: [buildJoinEmbed()] });
        });

        joinCollector.on('end', async () => {
            clearInterval(countdownInterval);

            if (participants.size < MIN_PLAYERS) {
                const failEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 💨 Dodge Cancelled\n` +
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
            let passCount = 0;
            let lastAction = null; // { from, to } for flavor text

            // Pick first holder randomly
            let holderId = alive[Math.floor(Math.random() * alive.length)];

            // Delete join message, send fresh game message
            await msg.delete().catch(() => {});

            // Dramatic start — ping everyone
            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 💨 Dodge is starting...` });
            await msg.edit({ content: '### 💨 Dodge is starting...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            // Announce first holder
            const startEmbed = new EmbedBuilder()
                .setDescription(
                    `### 💨 The card goes to...\n` +
                    `# ${participants.get(holderId)}!\n` +
                    `Pass it quick!`
                )
                .setColor(0xfee75c);
            await msg.edit({ content: '', embeds: [startEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                const timerS = Math.max(MIN_TIMER_S, INITIAL_TIMER_S - passCount * TIMER_DECREMENT_S);
                const timerMs = timerS * 1000;
                const deadline = Math.floor((Date.now() + timerMs) / 1000);

                // Build alive list with holder highlighted
                const aliveList = alive.map(id => {
                    if (id === holderId) return `💨 **${participants.get(id)}** ← HAS IT`;
                    return `╰ ${participants.get(id)}`;
                }).join('\n');

                const elimList = eliminated.length > 0
                    ? eliminated.map(id => `~~${participants.get(id)}~~`).join(', ')
                    : null;

                // Flavor text from last action
                let actionText = '';
                if (lastAction) {
                    actionText = `${participants.get(lastAction.from)} → ${participants.get(lastAction.to)}\n\n`;
                }

                const gameEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 💨 Dodge — ${card.name}\n` +
                        actionText +
                        `**${participants.get(holderId)}**, pass the card NOW!\n` +
                        `⏱️ <t:${deadline}:R>\n\n` +
                        `**Alive (${alive.length})**\n${aliveList}` +
                        (elimList ? `\n\n💀 Out: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(0xfee75c)
                    .setFooter({ text: `Pass #${passCount + 1} · ${timerS}s to dodge` });

                const rows = buildPassButtons(dodgeId, holderId, alive, participants);
                await msg.edit({ embeds: [gameEmbed], components: rows }).catch(() => {});

                // Wait for pass or timeout
                const result = await waitForPass(msg, holderId, dodgeId, timerMs);

                if (result.passed) {
                    // ——— SUCCESSFUL PASS ———
                    lastAction = { from: holderId, to: result.targetId };
                    holderId = result.targetId;
                    passCount++;
                } else {
                    // ——— TIME'S UP — ELIMINATION ———
                    const elimName = participants.get(holderId);
                    alive.splice(alive.indexOf(holderId), 1);
                    eliminated.push(holderId);
                    lastAction = null;

                    if (alive.length <= 1) break;

                    // Show elimination with suspense
                    const elimEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 💥 ${elimName} couldn't dodge!\n` +
                            `Knocked out! **${alive.length}** players remain...`
                        )
                        .setColor(0xed4245);

                    await msg.edit({ embeds: [elimEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2500));

                    // Random new holder
                    holderId = alive[Math.floor(Math.random() * alive.length)];
                    passCount++;

                    // Announce next holder
                    const nextEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 💨 Card goes to...\n` +
                            `# ${participants.get(holderId)}!`
                        )
                        .setColor(0xfee75c);
                    await msg.edit({ embeds: [nextEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            // ══════════════════════════════════════════
            //  PHASE 3 — VICTORY
            // ══════════════════════════════════════════

            const winnerId = alive[0];
            const winnerName = participants.get(winnerId);
            dm.addCardToUser(winnerId, winnerName, card.id);

            // Suspense
            const suspenseEmbed = new EmbedBuilder()
                .setDescription(`### 💨 And the last one standing is...`)
                .setColor(0x2b2d31);
            await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2500));

            // Elimination order for the recap
            const elimOrder = eliminated.map((id, i) => {
                const place = eliminated.length - i + 1;
                return `${place}. ~~${participants.get(id)}~~`;
            });

            const victoryEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏆 ${winnerName} wins the Dodge!\n\n` +
                    `Claimed ${emoji} **${card.name}** · ${cap(card.rarity)}\n\n` +
                    `**Final standings**\n` +
                    `🥇 **${winnerName}**\n` +
                    elimOrder.reverse().join('\n')
                )
                .setImage(card.imageUrl)
                .setColor(0x4caf50)
                .setTimestamp();

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
