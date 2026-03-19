const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;
const MIN_PLAYERS = 3;
const TURN_TIMEOUT_MS = 20_000;       // 20s per turn — generous
const CHAOS_CHANCE = 0.20;

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
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

// ═══════════════════════════════════════════
//  SYRINGE LABELS (shuffled each rack)
// ═══════════════════════════════════════════

const SYRINGE_NAMES = [
    '"Trust Me"', '"Totally Safe"', '"Experimental"', '"Expired 2019"',
    '"Smells Funny"', '"Glowing Blue"', '"Batch #V-47"', '"FDA Pending"',
    '"You\'ll Be Fine"', '"Do NOT Shake"', '"Unlabeled"', '"The Good Stuff"',
    '"Boss Said Send It"', '"Not Tested On Animals"', '"Plan B"',
    '"From The Back Of The Fridge"', '"Intern Made This"', '"Label Fell Off"',
    '"Ask Legal First"', '"NDA Required"',
];

// ═══════════════════════════════════════════
//  SURVIVAL POWERS (funny/absurd side effects)
// ═══════════════════════════════════════════

const SURVIVAL_POWERS = [
    'can now hear WiFi signals. It\'s mostly screaming.',
    'has teeth that are slightly magnetic. Keys keep sticking to their face.',
    'can taste emotions. Fear tastes like pennies.',
    'turns plaid when nervous.',
    'can speak to pigeons. They\'re all incredibly rude.',
    'has carbonated blood now. They fizz when you poke them.',
    'can see 2 seconds into the past. Completely useless.',
    'has one eye that sees through walls. The other one just vibes.',
    'sweats pure cinnamon oil. Smells great, burns everything.',
    'can photosynthesize, but only on Tuesdays.',
    'is now allergic to their own thoughts.',
    'has fingernails that grow at 10x speed. Already needs a trim.',
    'can turn invisible, but only when nobody is looking.',
    'has a shadow that runs on a 3-second delay.',
    'grew a fully functional third ear. It\'s on their elbow.',
    'bleeds glitter now. HR has questions.',
    'can smell the future. Tomorrow smells like burnt toast.',
    'has bones that are now rubber. Standing is a suggestion.',
    'can communicate with kitchen appliances. The toaster has concerns.',
    'now emits a faint humming noise at all times. Nobody can identify the song.',
    'has taste buds on their fingertips. Every handshake is a journey.',
    'became slightly transparent. Not invisible. Just unsettling.',
    'grew gills on their neck. They work but the turtleneck budget just tripled.',
    'has déjà vu every 4 seconds. This is going to get old.',
    'can run at 200mph but only backwards.',
    'is now always slightly damp. Always. Even indoors.',
    'can talk to plants. They\'re all extremely passive-aggressive.',
    'developed echolocation. Keeps bumping into glass doors anyway.',
    'has a heartbeat you can hear from 10 feet away. Stealth is no longer an option.',
    'can float, but only 2 inches off the ground. Just enough to be weird.',
    'their voice randomly autotunes. Sounds incredible. Can\'t control it.',
    'generates static electricity. Shocks everyone they touch. No friends.',
    'can predict the weather, but only weather that already happened.',
    'their reflection blinks separately from them.',
    'now thinks in Comic Sans.',
];

// ═══════════════════════════════════════════
//  DEATH SCENES — absurdist, dark, Discord-safe
//  (no graphic gore — suggest, don't describe)
// ═══════════════════════════════════════════

const DEATH_SCENES = [
    // Absurdist
    '{name} simply stopped existing. Vought PR says they "transitioned to a non-corporate role."',
    '{name} was yeeted into the stratosphere. Weather reports confirm a new cloud shaped like a person.',
    '{name} turned into a fine mist. Vought classified it as "aggressive evaporation."',
    '{name} got folded like an origami crane. A very screamy origami crane.',
    '{name} blinked out of reality. Their Discord status still says online though.',
    '{name} was recalled by the manufacturer. Warranty expired.',
    '{name} buffered like a YouTube video on hotel WiFi. And then the loading screen became permanent.',
    '{name} was divided by zero. Math has consequences.',
    '{name} achieved immortality for 0.001 seconds. Then achieved the opposite.',
    '{name} ragdolled. Like a video game glitch but in real life.',

    // Corporate satire
    '{name} experienced "rapid unscheduled disassembly." — Vought Incident Report #4,281',
    'Vought would like to clarify that {name} is NOT dead. They are "permanently indisposed."',
    '{name}\'s departure was "mutual." — Vought HR',
    '{name} violated their NDA by dying. Vought is suing their next of kin.',
    'Vought thanks {name} for their "voluntary contribution to science." Thoughts and prayers.',
    '{name} has been "optimized." Their desk has already been reassigned.',
    'Per Vought policy, {name}\'s death will be reviewed in Q3. Until then, they are "on leave."',
    '"We are deeply saddened by {name}\'s departure and wish them well in their future non-living endeavors." — Vought PR',
    '{name} signed the liability waiver. In retrospect, they should have read it.',
    'Vought stock went up 2% after {name}\'s elimination. The market is heartless.',

    // Homelander references
    '{name} made eye contact with Homelander. That was their first mistake. Smiling was their second.',
    'Homelander gave {name} a thumbs up. Then the thumbs up got... aggressive.',
    '"I can do whatever I want." Homelander was referring to {name}\'s continued existence. Past tense.',
    'Homelander told {name} they were his favorite. That\'s never a good sign.',
    '{name} asked Homelander if he was okay. He was not. Neither is {name} now.',

    // Absurd transformations
    '{name} turned into a lawn chair. A very haunted lawn chair. It screams when you sit on it.',
    '{name}\'s atoms decided to pursue individual careers. Couldn\'t agree on a group project.',
    '{name} became a concept. Not a person. Just... a vague idea of one.',
    '{name}\'s reflection climbed out, said "my turn," and walked away. It has their phone.',
    '{name} was replaced by a very convincing potted plant. Nobody noticed for 3 rounds.',
    '{name} clipped through the floor like a Bethesda NPC. Gone.',
    '{name} got autocorrected out of existence.',
    '{name} was uninstalled.',
    '{name} received a firmware update. It was not compatible.',
    '{name} got sent to the shadow realm. No, literally. Vought has one.',
];

// ——— Timeout deaths ———
const TIMEOUT_DEATHS = [
    '{name} couldn\'t choose. So Vought chose for them. Vought chose badly.',
    '{name} froze. Homelander leaned in and whispered "disappointing." Lights out.',
    '{name} took too long. Vought billed their family for the wasted syringe.',
    '{name} hesitated. In Vought\'s lab, hesitation is listed as cause of death.',
    '{name} went AFK in a Vought lab. Bold strategy. Did not work.',
    'Homelander got bored waiting for {name}. You don\'t want Homelander bored.',
];

// ——— Chaos events ———
const CHAOS_EVENTS = [
    {
        name: '👁️ HOMELANDER IS WATCHING',
        description: 'He looks bored. Timer cut to **10 seconds**.',
        effect: 'short_timer',
    },
    {
        name: '🥛 MILK BREAK',
        description: 'Homelander found the milk fridge. Timer extended to **30 seconds**.',
        effect: 'long_timer',
    },
    {
        name: '☠️ EXTRA DOSE',
        description: 'Vought added another bad syringe to the rack.',
        effect: 'extra_lethal',
    },
    {
        name: '🧬 STABILIZED BATCH',
        description: 'A lethal syringe was swapped out. Slightly safer... probably.',
        effect: 'remove_lethal',
    },
    {
        name: '⚡ STARLIGHT SHORTED THE LIGHTS',
        description: 'All labels are hidden. Good luck.',
        effect: 'blind',
    },
    {
        name: '🤫 THE DEEP SAID SOMETHING HELPFUL',
        description: 'For once. One safe syringe was removed from the rack.',
        effect: 'remove_safe',
    },
];

// ——— Inject suspense text ———
const INJECT_FLAVOR = [
    '💉 The Vought tech loads the next rack...',
    '💉 A lab intern wheels in a fresh tray of syringes...',
    '💉 "This batch is from the Tuesday lab. The *weird* Tuesday lab." — Vought Tech',
    '💉 The syringes are humming. That\'s new.',
    '💉 A-Train dropped off the new rack. He seemed nervous.',
    '💉 "I\'m sure it\'s fine." — intern who is standing very far away',
    '💉 The labels are handwritten. One of them says "oops."',
];

// ——— Rack reloaded flavor ———
const RELOAD_FLAVOR = [
    'Rack reloaded.',
    'Fresh syringes. Fresh terror.',
    'New rack. Same existential dread.',
    'Vought restocked. How thoughtful.',
    'The intern brought a new tray. Their hands are shaking.',
];

// ═══════════════════════════════════════════
//  RACK TIERS — escalating danger
//  Each time someone dies, next tier loads
// ═══════════════════════════════════════════

const RACK_TIERS = [
    { total: 6, lethal: 1 },   // 17% initial → guaranteed by syringe 6
    { total: 6, lethal: 1 },   // same odds, fresh rack
    { total: 6, lethal: 2 },   // 33% initial
    { total: 5, lethal: 2 },   // 40% initial
    { total: 5, lethal: 2 },   // 40% initial
    { total: 4, lethal: 2 },   // 50% initial — endgame
];

// ═══════════════════════════════════════════
//  Build a rack (array of syringes, shuffled)
// ═══════════════════════════════════════════

function buildRack(total, lethalCount) {
    const names = shuffle([...SYRINGE_NAMES]).slice(0, total);
    const rack = names.map((name, i) => ({
        label: name,
        lethal: i < lethalCount,
    }));
    shuffle(rack); // randomize which positions are lethal
    return rack;
}

// ═══════════════════════════════════════════
//  Build syringe buttons from rack
// ═══════════════════════════════════════════

function buildSyringeButtons(gameId, rack, blind = false) {
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;

    for (let i = 0; i < rack.length; i++) {
        if (count > 0 && count % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${gameId}_syringe_${i}`)
                .setLabel(blind ? '???' : rack[i].label)
                .setEmoji(blind ? '❓' : '💉')
                .setStyle(ButtonStyle.Secondary),
        );
        count++;
    }

    if (count > 0) rows.push(currentRow);
    return rows.slice(0, 5);
}

// ═══════════════════════════════════════════
//  Wait for ONE player to pick a syringe
// ═══════════════════════════════════════════

function waitForPick(msg, gameId, playerId, timerMs) {
    return new Promise((resolve) => {
        let resolved = false;

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.customId.startsWith(`${gameId}_syringe_`),
            time: timerMs,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== playerId) {
                await i.reply({
                    content: 'Not your turn. Just watch. And pray for them.',
                    ephemeral: true,
                }).catch(() => {});
                return;
            }

            resolved = true;
            const index = parseInt(i.customId.replace(`${gameId}_syringe_`, ''));
            await i.deferUpdate().catch(() => {});
            collector.stop('picked');
            resolve({ picked: true, index });
        });

        collector.on('end', () => {
            if (!resolved) resolve({ picked: false });
        });
    });
}

// ═══════════════════════════════════════════
//  MODULE
// ═══════════════════════════════════════════

module.exports = {
    data: new SlashCommandBuilder()
        .setName('compound')
        .setDescription('Compound V Roulette — pick a syringe and pray. Last one standing wins. (Admin)')
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

        await interaction.reply({ content: `✅ Compound V Roulette dropped in ${channel}!`, ephemeral: true });

        // ══════════════════════════════════════════
        //  PHASE 1 — RECRUITMENT
        // ══════════════════════════════════════════

        const participants = new Map();
        const gameId = `compound_${Date.now()}`;
        const endsAt = Date.now() + JOIN_DURATION_MS;

        function buildJoinEmbed() {
            const remaining = Math.max(0, endsAt - Date.now());
            const names = [...participants.values()];
            const list = names.length > 0
                ? names.map(n => `╰ 🧪 ${n}`).join('\n')
                : '*No test subjects yet...*';

            return new EmbedBuilder()
                .setDescription(
                    `### 🧬 COMPOUND V ROULETTE — ${card.name}\n` +
                    `${emoji} ${cap(card.rarity)} card to the last one standing\n\n` +
                    `**How it works:**\n` +
                    `╰ Players take turns picking a syringe from the rack\n` +
                    `╰ Most are Compound V — you survive (with side effects)\n` +
                    `╰ Some are **Compound X** — you don\'t survive\n` +
                    `╰ Last person alive wins the card\n\n` +
                    `Closes in **${formatTime(remaining)}** · Need **${MIN_PLAYERS}+** subjects\n\n` +
                    `**${names.length}** signed up\n${list}`
                )
                .setThumbnail(card.imageUrl)
                .setColor(0x1a1a2e)
                .setFooter({ text: '"Vought International — Because heroes need sponsors."' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${gameId}_join`)
                .setLabel('Volunteer as Tribute')
                .setEmoji('💉')
                .setStyle(ButtonStyle.Danger),
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
                await i.reply({ content: 'You already signed up, Subject. No take-backs.', ephemeral: true });
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
                        `### 🧬 Trial Cancelled\n` +
                        `Needed **${MIN_PLAYERS}** volunteers. Only **${participants.size}** showed up.\n` +
                        `Homelander is "disappointed." You don\'t want Homelander disappointed.`
                    )
                    .setColor(0x2b2d31);

                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(joinRow.components[0]).setDisabled(true),
                );
                await msg.edit({ embeds: [failEmbed], components: [disabledRow] }).catch(() => {});
                return;
            }

            // ══════════════════════════════════════════
            //  PHASE 2 — THE ROULETTE
            // ══════════════════════════════════════════

            const alive = shuffle([...participants.keys()]);
            const eliminated = [];
            const usedPowers = new Set();
            let turnIndex = 0;      // who's up in rotation
            let rackNum = 0;        // which difficulty tier
            let turnTotal = 0;      // total turns played

            // Build first rack
            const tier = RACK_TIERS[Math.min(rackNum, RACK_TIERS.length - 1)];
            let rack = buildRack(tier.total, tier.lethal);
            let currentLethal = tier.lethal;

            // Delete join message, ping everyone
            await msg.delete().catch(() => {});

            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 🧬 The Vought trials are starting...` });
            await msg.edit({ content: '### 🧬 The Vought trials are starting...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            // Intro
            const introEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏢 Welcome to Vought Tower, Floor B7\n\n` +
                    `**${participants.size}** test subjects. One survivor gets the card.\n\n` +
                    `A rack of syringes sits on the table.\n` +
                    `Most contain **Compound V** — you\'ll survive with... side effects.\n` +
                    `But some contain **Compound X** — and that\'s a problem.\n\n` +
                    `Pick a syringe when it\'s your turn.\n` +
                    `Or don\'t. Vought doesn\'t care either way.\n\n` +
                    `**Turn order:**\n` +
                    alive.map((id, i) => `${i + 1}. ${participants.get(id)}`).join('\n')
                )
                .setColor(0x1a1a2e)
                .setFooter({ text: 'Vought Legal reminds you: you signed the waiver.' });
            await msg.edit({ content: '', embeds: [introEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 4000));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                turnTotal++;
                const currentId = alive[turnIndex % alive.length];
                const currentName = participants.get(currentId);
                let timerMs = TURN_TIMEOUT_MS;
                let blind = false;

                // Chaos event check (not on first turn)
                let chaosEvent = null;
                if (turnTotal > 1 && Math.random() < CHAOS_CHANCE) {
                    chaosEvent = pick(CHAOS_EVENTS);

                    switch (chaosEvent.effect) {
                        case 'short_timer':
                            timerMs = 10_000;
                            break;
                        case 'long_timer':
                            timerMs = 30_000;
                            break;
                        case 'extra_lethal':
                            if (rack.length > currentLethal + 1) {
                                // convert a safe syringe to lethal
                                const safeIdx = rack.findIndex(s => !s.lethal);
                                if (safeIdx !== -1) {
                                    rack[safeIdx].lethal = true;
                                    currentLethal++;
                                }
                            } else {
                                chaosEvent = null; // skip if can't add more
                            }
                            break;
                        case 'remove_lethal':
                            if (currentLethal > 1) {
                                const lethalIdx = rack.findIndex(s => s.lethal);
                                if (lethalIdx !== -1) {
                                    rack[lethalIdx].lethal = false;
                                    currentLethal--;
                                }
                            } else {
                                chaosEvent = null;
                            }
                            break;
                        case 'blind':
                            blind = true;
                            break;
                        case 'remove_safe':
                            if (rack.length > currentLethal + 1) {
                                const safeIdx = rack.findIndex(s => !s.lethal);
                                if (safeIdx !== -1) {
                                    rack.splice(safeIdx, 1);
                                }
                            } else {
                                chaosEvent = null;
                            }
                            break;
                    }
                }

                // Deadline
                const deadline = Math.floor((Date.now() + timerMs) / 1000);

                // Build alive/elim lists
                const orderList = alive.map((id, i) => {
                    const pointer = id === currentId ? '▸ ' : '╰ ';
                    const tag = id === currentId ? ' **← PICKING**' : '';
                    return `${pointer}${participants.get(id)}${tag}`;
                }).join('\n');

                const elimList = eliminated.length > 0
                    ? eliminated.map(id => `~~${participants.get(id)}~~`).join(', ')
                    : null;

                // Rack display (syringes remaining — hide which are lethal)
                const safeCount = rack.filter(s => !s.lethal).length;
                const rackVisual = `${'💉'.repeat(safeCount)}${'💀'.repeat(currentLethal)}  *(${rack.length} syringes — ${currentLethal} lethal)*`;

                // Chaos text
                let chaosText = '';
                if (chaosEvent) {
                    chaosText = `\n> ⚠️ **${chaosEvent.name}** — ${chaosEvent.description}\n`;
                }

                // Build the turn embed
                const turnEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🧬 Compound V Roulette — ${card.name}\n` +
                        chaosText +
                        `\n# 🎯 ${currentName}'s turn\n\n` +
                        `Pick a syringe. **${currentLethal}** of them are Compound X.\n` +
                        `⏱ <t:${deadline}:R>\n\n` +
                        `**The Rack:**\n${rackVisual}\n\n` +
                        `**Alive (${alive.length})**\n${orderList}` +
                        (elimList ? `\n\n💀 Dead: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(0x1a1a2e)
                    .setFooter({ text: `Turn ${turnTotal} · Rack ${rackNum + 1} · ${timerMs / 1000}s to choose` });

                const buttons = buildSyringeButtons(gameId, rack, blind);
                await msg.edit({ embeds: [turnEmbed], components: buttons }).catch(() => {});

                // ——— Wait for pick ———
                const result = await waitForPick(msg, gameId, currentId, timerMs);

                if (!result.picked) {
                    // ——— TIMEOUT — auto-death ———
                    alive.splice(alive.indexOf(currentId), 1);
                    eliminated.push(currentId);

                    const deathText = pick(TIMEOUT_DEATHS).replace(/\{name\}/g, `**${currentName}**`);

                    const timeoutEmbed = new EmbedBuilder()
                        .setDescription(
                            `${deathText}\n\n` +
                            `**${alive.length}** test subject${alive.length !== 1 ? 's' : ''} remain`
                        )
                        .setColor(0x2b2d31);
                    await msg.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 3000));

                    // Don't reload rack on timeout — just continue
                    if (alive.length <= 1) break;

                    // Fix turn index
                    if (turnIndex >= alive.length) turnIndex = 0;
                    continue;
                }

                // ——— PLAYER PICKED A SYRINGE ———
                const chosen = rack[result.index];

                if (!chosen.lethal) {
                    // ═══ SURVIVED ═══
                    // Remove chosen syringe from rack
                    rack.splice(result.index, 1);

                    // Pick a unique survival power
                    let power;
                    const availablePowers = SURVIVAL_POWERS.filter(p => !usedPowers.has(p));
                    if (availablePowers.length === 0) {
                        usedPowers.clear();
                        power = pick(SURVIVAL_POWERS);
                    } else {
                        power = pick(availablePowers);
                    }
                    usedPowers.add(power);

                    const safeLeft = rack.filter(s => !s.lethal).length;
                    const lethalLeft = rack.filter(s => s.lethal).length;

                    const surviveEmbed = new EmbedBuilder()
                        .setDescription(
                            `### ✅ ${currentName} injects... **Compound V!**\n\n` +
                            `Side effect: **${currentName}** ${power}\n\n` +
                            `**The Rack:** ${'💉'.repeat(safeLeft)}${'💀'.repeat(lethalLeft)}` +
                            `  *(${rack.length} left — ${lethalLeft} lethal)*\n\n` +
                            `**${alive.length}** remain`
                        )
                        .setColor(0x2d7d46);
                    await msg.edit({ embeds: [surviveEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2500));

                    // Advance turn
                    turnIndex = (turnIndex + 1) % alive.length;

                    // If rack is empty of safe syringes (only lethal left), reload next tier
                    if (rack.filter(s => !s.lethal).length === 0 && rack.length > 0) {
                        // Everyone dodged the lethal ones somehow — reload
                        rackNum++;
                        const newTier = RACK_TIERS[Math.min(rackNum, RACK_TIERS.length - 1)];
                        rack = buildRack(newTier.total, newTier.lethal);
                        currentLethal = newTier.lethal;

                        const reloadEmbed = new EmbedBuilder()
                            .setDescription(
                                `### 💉 ${pick(RELOAD_FLAVOR)}\n\n` +
                                `${'💉'.repeat(newTier.total - newTier.lethal)}${'💀'.repeat(newTier.lethal)}` +
                                `  *(${newTier.total} syringes — ${newTier.lethal} lethal)*`
                            )
                            .setColor(0x1a1a2e);
                        await msg.edit({ embeds: [reloadEmbed], components: [] }).catch(() => {});
                        await new Promise(r => setTimeout(r, 2000));
                    }

                } else {
                    // ═══ COMPOUND X — DEATH ═══
                    alive.splice(alive.indexOf(currentId), 1);
                    eliminated.push(currentId);

                    const deathText = pick(DEATH_SCENES).replace(/\{name\}/g, `**${currentName}**`);

                    const deathEmbed = new EmbedBuilder()
                        .setDescription(
                            `### ☠️ ${currentName} injects... **COMPOUND X.**\n\n` +
                            `${deathText}\n\n` +
                            `**${alive.length}** test subject${alive.length !== 1 ? 's' : ''} remain`
                        )
                        .setColor(0x8b0000);
                    await msg.edit({ embeds: [deathEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 3500));

                    if (alive.length <= 1) break;

                    // Fix turn index
                    if (turnIndex >= alive.length) turnIndex = 0;

                    // ——— Reload rack with next difficulty tier ———
                    rackNum++;
                    const newTier = RACK_TIERS[Math.min(rackNum, RACK_TIERS.length - 1)];
                    rack = buildRack(newTier.total, newTier.lethal);
                    currentLethal = newTier.lethal;

                    const reloadEmbed = new EmbedBuilder()
                        .setDescription(
                            `### 💉 ${pick(RELOAD_FLAVOR)}\n` +
                            `${pick(INJECT_FLAVOR)}\n\n` +
                            `${'💉'.repeat(newTier.total - newTier.lethal)}${'💀'.repeat(newTier.lethal)}` +
                            `  *(${newTier.total} syringes — ${newTier.lethal} lethal)*`
                        )
                        .setColor(0x1a1a2e);
                    await msg.edit({ embeds: [reloadEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2500));
                }
            }

            // ══════════════════════════════════════════
            //  PHASE 3 — SOLE SURVIVOR
            // ══════════════════════════════════════════

            if (alive.length === 0) {
                const noWinnerEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🧬 Trial Complete — No Survivors\n\n` +
                        `Every test subject is gone.\n` +
                        `The card goes unclaimed.\n\n` +
                        `*Homelander shrugs. "Disappointing."*\n` +
                        `*Vought stock is unaffected.*`
                    )
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [noWinnerEmbed], components: [] }).catch(() => {});
                return;
            }

            const winnerId = alive[0];
            const winnerName = participants.get(winnerId);
            dm.addCardToUser(winnerId, winnerName, card.id);

            // Suspense
            const suspenseEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🧬 The compound stabilizes...\n\n` +
                    `One subject remains.\n` +
                    `The lab is quiet. The interns are hiding.`
                )
                .setColor(0x2b2d31);
            await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 2500));

            // Victory
            const elimOrder = eliminated.map((id, i) => {
                const place = eliminated.length - i + 1;
                return `${place}. ~~${participants.get(id)}~~ 💀`;
            });

            const victoryEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏆 ${winnerName} survived the Compound V Trials\n\n` +
                    `Claimed ${emoji} **${card.name}** · ${cap(card.rarity)}\n\n` +
                    `*"I can do whatever I want."*\n\n` +
                    `**Final Report**\n` +
                    `1. **${winnerName}** 🧬 — Sole Survivor\n` +
                    elimOrder.reverse().join('\n') +
                    `\n\n_${turnTotal} turns · ${eliminated.length} casualties · ${participants.size} subjects_`
                )
                .setImage(card.imageUrl)
                .setColor(0x1a1a2e)
                .setTimestamp()
                .setFooter({ text: 'Vought International™ — "You\'re Earth\'s Mightiest Heroes."' });

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
