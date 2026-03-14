const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;       // 1 minute to join
const MIN_PLAYERS = 3;                     // need at least 3
const MIN_TIMER_S = 4;                    // never below 4s
const MAX_TIMER_S = 9;                    // starting max
const CHAOS_CHANCE = 0.18;                // ~18% chance of chaos event

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}:${String(sec).padStart(2, '0')}`;
    return `${sec}s`;
}

// Random int between min and max (inclusive)
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Shuffle array in-place (Fisher-Yates)
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ——— Flavor text ———

const PASS_FLAVOR = [
    '{from} → {to}',
    '{from} didn\'t even think, just threw it at {to}',
    '{from} said "nah" and sent it to {to}',
    '{from} chose violence — {to} has it now',
    '{from} woke up and chose {to}',
    '{from} really just targeted {to} like that',
    '{from} threw it at {to} with zero hesitation',
    '{from} is NOT holding that — {to}\'s problem now',
];

const NEAR_MISS_FLAVOR = [
    '{name} passed with **{time}** left. Barely alive.',
    '{name} cut it close — **{time}** on the clock.',
    '**{time}** left when {name} passed. That was tight.',
];

const ELIM_FLAVOR = [
    '### 💀 {name} froze\nJust stood there. Couldn\'t be saved.',
    '### 💀 {name} is OUT\nAfk diff honestly.',
    '### 💀 {name} choked\nHad all that time and did nothing.',
    '### 💀 {name} timed out\nWere they even playing?',
    '### 💀 {name} is gone\nNo shot they just let that happen.',
    '### 💀 {name} didn\'t dodge\nIt\'s literally in the name.',
];

const SELF_TRAP_FLAVOR = [
    '### 💀 {name} clicked their own name\nYou cannot make this up.',
    '### 💀 {name} passed it to... themselves\nBro.',
    '### 💀 {name} eliminated themselves\nEveryone else just watched.',
    '### 💀 {name} really just did that\nSelf report of the century.',
];

const MULTI_PASS_FLAVOR = [
    'Card needs to be passed **{count} times** before someone can die',
    'Hot round — **{count} passes** required this time',
    'Keep it moving — **{count} passes** before anyone\'s safe',
];

const CHAOS_EVENTS = [
    { name: 'SPEED RUSH', description: 'Timer cut in half', effect: 'half_timer' },
    { name: 'GHOST PASS', description: 'One button is a decoy', effect: 'decoy' },
    { name: 'HOT ROUND', description: null, effect: 'multi_pass' },  // description set dynamically
    { name: 'LOCKOUT', description: 'Can\'t pass back to who gave it to you', effect: 'no_passback' },
];

// ——— Build pass buttons ———
function buildPassButtons(dodgeId, holderId, alivePlayers, participants, opts = {}) {
    const { hasDecoy, blockedId } = opts;

    const allButtons = alivePlayers
        .filter(id => id !== blockedId) // remove blocked passback target
        .map(id => ({
            id,
            isTrap: id === holderId,
        }));

    // Add decoy button
    if (hasDecoy && alivePlayers.length > 2) {
        const validTargets = alivePlayers.filter(id => id !== holderId && id !== blockedId);
        if (validTargets.length > 0) {
            allButtons.push({
                id: 'decoy',
                isTrap: false,
                isDecoy: true,
                fakeName: participants.get(validTargets[Math.floor(Math.random() * validTargets.length)]),
            });
        }
    }

    shuffle(allButtons);

    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;

    for (const btn of allButtons) {
        if (count > 0 && count % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }

        let label, customId;
        if (btn.isDecoy) {
            label = btn.fakeName;
            customId = `${dodgeId}_decoy_${Date.now()}`;
        } else if (btn.isTrap) {
            label = participants.get(btn.id);
            customId = `${dodgeId}_self_${btn.id}`;
        } else {
            label = participants.get(btn.id);
            customId = `${dodgeId}_pass_${btn.id}`;
        }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary),
        );
        count++;
    }

    if (count > 0) rows.push(currentRow);
    return rows.slice(0, 5);
}

// ——— Wait for the holder to pass, self-trap, or time out ———
function waitForPass(msg, holderId, dodgeId, timerMs) {
    return new Promise((resolve) => {
        let resolved = false;
        const startTime = Date.now();

        const collector = msg.createMessageComponentCollector({
            filter: (i) =>
                i.customId.startsWith(`${dodgeId}_pass_`) ||
                i.customId.startsWith(`${dodgeId}_self_`) ||
                i.customId.startsWith(`${dodgeId}_decoy_`),
            time: timerMs,
        });

        collector.on('collect', async (i) => {
            await i.deferUpdate().catch(() => {});

            if (i.user.id !== holderId) {
                await i.followUp({ content: 'Not your turn — wait for the card.', ephemeral: true }).catch(() => {});
                return;
            }

            if (i.customId.startsWith(`${dodgeId}_decoy_`)) {
                await i.followUp({ content: 'Decoy — that did nothing. Pick again, quick.', ephemeral: true }).catch(() => {});
                return;
            }

            if (i.customId.startsWith(`${dodgeId}_self_`)) {
                resolved = true;
                collector.stop('self');
                resolve({ passed: false, selfTrap: true, timeLeft: timerMs - (Date.now() - startTime) });
                return;
            }

            resolved = true;
            const targetId = i.customId.replace(`${dodgeId}_pass_`, '');
            const timeLeft = timerMs - (Date.now() - startTime);
            collector.stop('passed');
            resolve({ passed: true, targetId, timeLeft });
        });

        collector.on('end', () => {
            if (!resolved) {
                resolve({ passed: false, selfTrap: false, timeLeft: 0 });
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

        const participants = new Map();
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
                    `${emoji} ${cap(card.rarity)} card up for grabs\n\n` +
                    `Pass the card or get **knocked out**.\nLast player standing wins it.\n\n` +
                    `Closes in **${formatTime(remaining)}** · Need **${MIN_PLAYERS}+** players\n\n` +
                    `**${names.length}** joined\n${list}`
                )
                .setThumbnail(card.imageUrl)
                .setColor(colorInt)
                .setFooter({ text: 'Join now — once it starts, no way out' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${dodgeId}_join`)
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
            filter: (i) => i.customId === `${dodgeId}_join`,
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
            const targetCount = new Map(); // track how many times each player gets targeted
            alive.forEach(id => targetCount.set(id, 0));

            let roundNum = 0;
            let passCount = 0;
            let lastAction = null;
            let lastPasserId = null; // for no-passback
            let streak = 0;

            // Pick first holder randomly
            let holderId = alive[Math.floor(Math.random() * alive.length)];

            // Delete join message, send fresh game message
            await msg.delete().catch(() => {});

            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 💨 Dodge is starting...` });
            await msg.edit({ content: '### 💨 Dodge is starting...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            const startEmbed = new EmbedBuilder()
                .setDescription(
                    `### 💨 The card goes to...\n` +
                    `# ${participants.get(holderId)}\n` +
                    `Pass it quick`
                )
                .setColor(0xfee75c);
            await msg.edit({ content: '', embeds: [startEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                roundNum++;

                // Timer: random within a shrinking window
                const maxT = Math.max(MIN_TIMER_S, MAX_TIMER_S - Math.floor(roundNum / 2));
                const minT = MIN_TIMER_S;
                let timerS = randInt(minT, maxT);

                // Chaos event check
                let chaosEvent = null;
                let hasDecoy = false;
                let multiPassCount = 0;
                let noPassback = false;

                if (roundNum > 1 && Math.random() < CHAOS_CHANCE) {
                    chaosEvent = CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)];

                    if (chaosEvent.effect === 'half_timer') {
                        timerS = Math.max(MIN_TIMER_S, Math.ceil(timerS / 2));
                    } else if (chaosEvent.effect === 'decoy') {
                        hasDecoy = true;
                    } else if (chaosEvent.effect === 'multi_pass') {
                        multiPassCount = randInt(2, Math.min(3, alive.length - 1));
                        const mpFlavor = MULTI_PASS_FLAVOR[Math.floor(Math.random() * MULTI_PASS_FLAVOR.length)];
                        chaosEvent.description = mpFlavor.replace('{count}', multiPassCount);
                    } else if (chaosEvent.effect === 'no_passback') {
                        noPassback = true;
                    }
                }

                // Multi-pass: card bounces through multiple players before the "live" round
                if (multiPassCount > 0) {
                    const chaosText = `> ⚠ **${chaosEvent.name}** — ${chaosEvent.description}\n`;
                    const mpEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 💨 Dodge — ${card.name}\n` +
                            chaosText +
                            `\nStarting with **${participants.get(holderId)}**`
                        )
                        .setColor(0xfee75c)
                        .setThumbnail(card.imageUrl);
                    await msg.edit({ embeds: [mpEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 1200));

                    for (let mp = 0; mp < multiPassCount && alive.length > 1; mp++) {
                        const mpTimer = Math.max(MIN_TIMER_S, timerS + 1); // slightly more generous in multi-pass
                        const mpMs = mpTimer * 1000;
                        const mpDeadline = Math.floor((Date.now() + mpMs) / 1000);

                        const mpGameEmbed = new EmbedBuilder()
                            .setDescription(
                                `### 💨 Dodge — ${card.name}\n` +
                                chaosText +
                                `**${participants.get(holderId)}**, pass it! (${mp + 1}/${multiPassCount})\n` +
                                `⏱ <t:${mpDeadline}:R>`
                            )
                            .setColor(0xfee75c)
                            .setThumbnail(card.imageUrl)
                            .setFooter({ text: `Hot round — pass ${mp + 1} of ${multiPassCount}` });

                        const mpRows = buildPassButtons(dodgeId, holderId, alive, participants, {
                            hasDecoy: false,
                            blockedId: lastPasserId,
                        });
                        await msg.edit({ embeds: [mpGameEmbed], components: mpRows }).catch(() => {});

                        const mpResult = await waitForPass(msg, holderId, dodgeId, mpMs);

                        if (mpResult.passed) {
                            lastPasserId = holderId;
                            targetCount.set(mpResult.targetId, (targetCount.get(mpResult.targetId) || 0) + 1);
                            holderId = mpResult.targetId;
                            passCount++;
                        } else {
                            // Died during multi-pass
                            const elimName = participants.get(holderId);
                            alive.splice(alive.indexOf(holderId), 1);
                            eliminated.push(holderId);
                            lastAction = null;
                            lastPasserId = null;
                            streak = 0;

                            if (alive.length <= 1) break;

                            const elimFlavors = mpResult.selfTrap ? SELF_TRAP_FLAVOR : ELIM_FLAVOR;
                            const elimText = elimFlavors[Math.floor(Math.random() * elimFlavors.length)]
                                .replace('{name}', elimName);

                            holderId = alive[Math.floor(Math.random() * alive.length)];

                            const elimEmbed = new EmbedBuilder()
                                .setDescription(
                                    elimText + `\n**${alive.length}** remain\n\n` +
                                    `### Card goes to **${participants.get(holderId)}**`
                                )
                                .setColor(mpResult.selfTrap ? 0x2b2d31 : 0xed4245);
                            await msg.edit({ embeds: [elimEmbed], components: [] }).catch(() => {});
                            await new Promise(r => setTimeout(r, 2000));
                            break; // exit multi-pass, continue to next round
                        }
                    }

                    if (alive.length <= 1) break;
                    // After multi-pass completes without death, continue to normal round
                    chaosEvent = null; // don't show chaos banner again
                }

                if (alive.length <= 1) break;

                const timerMs = timerS * 1000;
                const deadline = Math.floor((Date.now() + timerMs) / 1000);

                // Determine blocked player (no-passback)
                const blockedId = (noPassback || alive.length > 2) ? lastPasserId : null;

                // Build alive list
                const aliveList = alive.map(id => {
                    const hits = targetCount.get(id) || 0;
                    const targetTag = hits >= 3 ? ` (targeted ${hits}x)` : '';
                    if (id === holderId) return `▸ **${participants.get(id)}** ← HAS IT${targetTag}`;
                    return `╰ ${participants.get(id)}${targetTag}`;
                }).join('\n');

                const elimList = eliminated.length > 0
                    ? eliminated.map(id => `~~${participants.get(id)}~~`).join(', ')
                    : null;

                // Last action recap
                let actionText = '';
                if (lastAction) {
                    const flavor = PASS_FLAVOR[Math.floor(Math.random() * PASS_FLAVOR.length)];
                    actionText = flavor
                        .replace('{from}', participants.get(lastAction.from))
                        .replace('{to}', participants.get(lastAction.to)) + '\n';

                    // Near miss callout
                    if (lastAction.nearMiss) {
                        const nmFlavor = NEAR_MISS_FLAVOR[Math.floor(Math.random() * NEAR_MISS_FLAVOR.length)];
                        actionText += nmFlavor
                            .replace('{name}', participants.get(lastAction.from))
                            .replace('{time}', lastAction.nearMissTime) + '\n';
                    }
                    actionText += '\n';
                }

                // Streak
                let streakText = '';
                if (streak >= 3) {
                    streakText = `\n**${streak} passes** in a row — someone's going down soon\n`;
                }

                // Chaos banner
                let chaosText = '';
                if (chaosEvent) {
                    chaosText = `\n> ⚠ **${chaosEvent.name}** — ${chaosEvent.description}\n`;
                }

                // Passback warning
                let passbackText = '';
                if (blockedId && participants.has(blockedId) && alive.includes(blockedId)) {
                    passbackText = `\n*Can't pass back to ${participants.get(blockedId)}*\n`;
                }

                const gameEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 💨 Dodge — ${card.name}\n` +
                        chaosText +
                        actionText +
                        `**${participants.get(holderId)}**, pass the card!\n` +
                        `⏱ <t:${deadline}:R>\n` +
                        passbackText +
                        streakText +
                        `\n**Alive (${alive.length})**\n${aliveList}` +
                        (elimList ? `\n\nOut: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(timerS <= 4 ? 0xed4245 : 0xfee75c)
                    .setFooter({ text: `Round ${roundNum} · ${timerS}s` });

                const rows = buildPassButtons(dodgeId, holderId, alive, participants, {
                    hasDecoy,
                    blockedId,
                });
                await msg.edit({ embeds: [gameEmbed], components: rows }).catch(() => {});

                const result = await waitForPass(msg, holderId, dodgeId, timerMs);

                if (result.passed) {
                    const nearMiss = result.timeLeft < 1500; // less than 1.5s left
                    const nearMissTime = nearMiss ? `${(result.timeLeft / 1000).toFixed(1)}s` : null;

                    lastAction = {
                        from: holderId,
                        to: result.targetId,
                        nearMiss,
                        nearMissTime,
                    };
                    lastPasserId = holderId;
                    targetCount.set(result.targetId, (targetCount.get(result.targetId) || 0) + 1);
                    holderId = result.targetId;
                    passCount++;
                    streak++;
                } else {
                    const elimName = participants.get(holderId);
                    alive.splice(alive.indexOf(holderId), 1);
                    eliminated.push(holderId);
                    lastAction = null;
                    lastPasserId = null;
                    streak = 0;

                    if (alive.length <= 1) break;

                    const elimFlavors = result.selfTrap ? SELF_TRAP_FLAVOR : ELIM_FLAVOR;
                    const elimText = elimFlavors[Math.floor(Math.random() * elimFlavors.length)]
                        .replace('{name}', elimName);

                    holderId = alive[Math.floor(Math.random() * alive.length)];
                    passCount++;

                    const elimEmbed = new EmbedBuilder()
                        .setDescription(
                            elimText + `\n**${alive.length}** remain\n\n` +
                            `### Card goes to **${participants.get(holderId)}**`
                        )
                        .setColor(result.selfTrap ? 0x2b2d31 : 0xed4245);

                    await msg.edit({ embeds: [elimEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            // ══════════════════════════════════════════
            //  PHASE 3 — VICTORY
            // ══════════════════════════════════════════

            const winnerId = alive[0];
            const winnerName = participants.get(winnerId);
            dm.addCardToUser(winnerId, winnerName, card.id);

            const suspenseEmbed = new EmbedBuilder()
                .setDescription(`### Last one standing...`)
                .setColor(0x2b2d31);
            await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            // Find most targeted player
            const mostTargeted = [...targetCount.entries()]
                .filter(([id]) => participants.has(id))
                .sort((a, b) => b[1] - a[1])[0];
            const targetedLine = mostTargeted && mostTargeted[1] >= 3
                ? `\nMost targeted: **${participants.get(mostTargeted[0])}** (${mostTargeted[1]}x)\n`
                : '';

            const elimOrder = eliminated.map((id, i) => {
                const place = eliminated.length - i + 1;
                return `${place}. ~~${participants.get(id)}~~`;
            });

            const victoryEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏆 ${winnerName} wins the Dodge\n\n` +
                    `Claimed ${emoji} **${card.name}** · ${cap(card.rarity)}\n\n` +
                    `**Final standings**\n` +
                    `1. **${winnerName}**\n` +
                    elimOrder.reverse().join('\n') +
                    targetedLine +
                    `\n_${roundNum} rounds · ${passCount} passes · ${eliminated.length} eliminated_`
                )
                .setImage(card.imageUrl)
                .setColor(0x4caf50)
                .setTimestamp();

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
