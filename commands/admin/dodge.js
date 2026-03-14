const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;       // 1 minute to join
const MIN_PLAYERS = 3;                     // need at least 3
const INITIAL_TIMER_S = 8;                // first pass: 8s
const TIMER_DECREMENT_S = 1;              // shrink 1s per pass
const MIN_TIMER_S = 2;                    // never below 2s
const CHAOS_CHANCE = 0.15;                // 15% chance of chaos event each round

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}:${String(sec).padStart(2, '0')}`;
    return `${sec}s`;
}

// Shuffle array in-place (Fisher-Yates)
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}



// Random flavor text for passes
const PASS_FLAVOR = [
    '{from} → {to}',
    '{from} passes to {to}',
    '{from} throws it to {to}',
    '{from} slides it to {to}',
    '{from} flicks it at {to}',
];

// Elimination messages
const ELIM_FLAVOR = [
    '### 💀 {name} froze up\nToo slow — out.',
    '### 💀 {name} didn\'t make it\nKnocked out.',
    '### 💀 {name} choked\nEliminated.',
    '### 💀 {name} ran out of time\nGone.',
];

const SELF_TRAP_FLAVOR = [
    '### 💀 {name} clicked their own name\nSelf-elimination.',
    '### 💀 {name} played themselves\nInstant out.',
];

const CHAOS_EVENTS = [
    { name: 'SPEED RUSH', description: 'Timer cut in half', effect: 'half_timer' },
    { name: 'SHUFFLE', description: 'Buttons scrambled', effect: 'shuffle' },
    { name: 'GHOST PASS', description: 'One button is a decoy', effect: 'decoy' },
    { name: 'SNIPER ROUND', description: 'Only 3 seconds', effect: 'sniper' },
];

// ——— Build pass buttons ———
function buildPassButtons(dodgeId, holderId, alivePlayers, participants, hasDecoy) {
    const allButtons = alivePlayers.map(id => ({
        id,
        isTrap: id === holderId,
    }));

    // If decoy chaos event, add a fake button
    if (hasDecoy && alivePlayers.length > 2) {
        allButtons.push({
            id: 'decoy',
            isTrap: false,
            isDecoy: true,
        });
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
            // Decoy: pick a random alive player's name to show (but it does nothing useful)
            const randomAlive = alivePlayers.filter(id => id !== holderId);
            const decoyName = participants.get(randomAlive[Math.floor(Math.random() * randomAlive.length)]);
            label = decoyName;
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
    return rows.slice(0, 5); // Discord max 5 rows
}

// ——— Wait for the holder to pass, self-trap, or time out ———
function waitForPass(msg, holderId, dodgeId, timerMs) {
    return new Promise((resolve) => {
        let resolved = false;

        const collector = msg.createMessageComponentCollector({
            filter: (i) =>
                i.customId.startsWith(`${dodgeId}_pass_`) ||
                i.customId.startsWith(`${dodgeId}_self_`) ||
                i.customId.startsWith(`${dodgeId}_decoy_`),
            time: timerMs,
        });

        collector.on('collect', async (i) => {
            // ALWAYS defer first — this is critical to avoid Discord timeouts
            await i.deferUpdate().catch(() => {});

            // Only the holder can interact
            if (i.user.id !== holderId) {
                await i.followUp({ content: 'Not your turn — wait for the card.', ephemeral: true }).catch(() => {});
                return;
            }

            // Decoy button — does nothing, wastes time
            if (i.customId.startsWith(`${dodgeId}_decoy_`)) {
                await i.followUp({ content: 'Decoy — that did nothing. Pick again, quick.', ephemeral: true }).catch(() => {});
                return;
            }

            // Trap button — clicked their own name!
            if (i.customId.startsWith(`${dodgeId}_self_`)) {
                resolved = true;
                collector.stop('self');
                resolve({ passed: false, selfTrap: true });
                return;
            }

            // Valid pass
            resolved = true;
            const targetId = i.customId.replace(`${dodgeId}_pass_`, '');
            collector.stop('passed');
            resolve({ passed: true, targetId });
        });

        collector.on('end', () => {
            if (!resolved) {
                resolve({ passed: false, selfTrap: false });
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

        // Live countdown — only update every 15s to avoid rate limits
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
            // Defer FIRST to avoid timeout
            if (participants.has(i.user.id)) {
                await i.reply({ content: 'You already joined!', ephemeral: true });
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
            let passCount = 0;
            let lastAction = null;
            let streak = 0; // consecutive passes without elimination

            // Pick first holder randomly
            let holderId = alive[Math.floor(Math.random() * alive.length)];

            // Delete join message, send fresh game message
            await msg.delete().catch(() => {});

            // Dramatic start — ping everyone then clean up
            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 💨 Dodge is starting...` });
            await msg.edit({ content: '### 💨 Dodge is starting...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            // Announce first holder
            const startEmbed = new EmbedBuilder()
                .setDescription(
                    `### 💨 The card goes to...\n` +
                    `# ${participants.get(holderId)}!\n` +
                    `Pass it quick!`
                )
                .setColor(0xfee75c);
            await msg.edit({ content: '', embeds: [startEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                let timerS = Math.max(MIN_TIMER_S, INITIAL_TIMER_S - passCount * TIMER_DECREMENT_S);

                // Chaos event check
                let chaosEvent = null;
                let hasDecoy = false;
                if (passCount > 0 && Math.random() < CHAOS_CHANCE) {
                    chaosEvent = CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)];
                    if (chaosEvent.effect === 'half_timer') {
                        timerS = Math.max(MIN_TIMER_S, Math.ceil(timerS / 2));
                    } else if (chaosEvent.effect === 'sniper') {
                        timerS = 3;
                    } else if (chaosEvent.effect === 'decoy') {
                        hasDecoy = true;
                    }
                    // 'shuffle' just means extra scrambled — handled by normal shuffle
                }

                const timerMs = timerS * 1000;
                const deadline = Math.floor((Date.now() + timerMs) / 1000);


                // Build alive list with holder highlighted
                const aliveList = alive.map(id => {
                    if (id === holderId) return `▸ **${participants.get(id)}** ← HAS IT`;
                    return `╰ ${participants.get(id)}`;
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
                        .replace('{to}', participants.get(lastAction.to)) + '\n\n';
                }

                // Streak counter
                let streakText = '';
                if (streak >= 3) {
                    streakText = `\n**${streak} passes** in a row — someone's going down soon\n`;
                }

                // Chaos banner
                let chaosText = '';
                if (chaosEvent) {
                    chaosText = `\n> ⚠ **${chaosEvent.name}** — ${chaosEvent.description}\n`;
                }

                const gameEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 💨 Dodge — ${card.name}\n` +
                        chaosText +
                        actionText +
                        `**${participants.get(holderId)}**, pass the card!\n` +
                        `⏱ <t:${deadline}:R>\n` +
                        streakText +
                        `\n**Alive (${alive.length})**\n${aliveList}` +
                        (elimList ? `\n\nOut: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(timerS <= 3 ? 0xed4245 : 0xfee75c)
                    .setFooter({ text: `Pass #${passCount + 1} · ${timerS}s` });

                const rows = buildPassButtons(dodgeId, holderId, alive, participants, hasDecoy);
                await msg.edit({ embeds: [gameEmbed], components: rows }).catch(() => {});

                // Wait for pass or timeout
                const result = await waitForPass(msg, holderId, dodgeId, timerMs);

                if (result.passed) {
                    // ——— SUCCESSFUL PASS ———
                    lastAction = { from: holderId, to: result.targetId };
                    holderId = result.targetId;
                    passCount++;
                    streak++;
                } else {
                    // ——— ELIMINATION (timeout or self-trap) ———
                    const elimName = participants.get(holderId);
                    alive.splice(alive.indexOf(holderId), 1);
                    eliminated.push(holderId);
                    lastAction = null;
                    streak = 0;

                    if (alive.length <= 1) break;

                    // Show elimination — combined with next holder announcement to save an edit
                    const elimFlavors = result.selfTrap ? SELF_TRAP_FLAVOR : ELIM_FLAVOR;
                    const elimText = elimFlavors[Math.floor(Math.random() * elimFlavors.length)]
                        .replace('{name}', elimName);

                    // Random new holder
                    holderId = alive[Math.floor(Math.random() * alive.length)];
                    passCount++;

                    // Single combined embed: elimination + next holder
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

            // Suspense
            const suspenseEmbed = new EmbedBuilder()
                .setDescription(`### Last one standing...`)
                .setColor(0x2b2d31);
            await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            // Elimination order for the recap
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
                    `\n\n_${passCount} passes · ${eliminated.length} eliminated_`
                )
                .setImage(card.imageUrl)
                .setColor(0x4caf50)
                .setTimestamp();

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
