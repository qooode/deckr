const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 60 * 1000;
const MIN_PLAYERS = 3;
const BASE_REACT_MS = 15000;        // base reaction window (15s — gotta read the prompt)
const MIN_REACT_MS = 6000;          // minimum reaction window (6s)
const CHAOS_CHANCE = 0.22;          // ~22% chance of chaos per round

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
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
//  COMPOUND V SIDE EFFECTS — each round picks one
//  - prompt = what the embed says is happening
//  - correct = the ONE button that saves you
//  - wrong = the other buttons (decoys)
//  - deathLines = what happens if you fail (Homelander-energy)
// ═══════════════════════════════════════════

const SIDE_EFFECTS = [
    {
        prompt: '### 💉 Your skin starts turning translucent\nYour organs are visible. Everyone is staring. The compound is destabilizing.',
        correct: { label: 'Stabilize', emoji: '💊' },
        wrong: [
            { label: 'Scratch It Off', emoji: '🩸' },
            { label: 'Flex Through It', emoji: '💪' },
            { label: 'Ignore It', emoji: '😐' },
        ],
        deathLines: [
            '### 💀 {name}\'s organs literally fell out\nThey tried to hold them in. They couldn\'t.',
            '### 💀 {name} popped\nOne minute they were there, next — modern art on the walls.',
            '### 💀 {name} became see-through permanently\nThen the structural integrity failed. Wet crunch.',
        ],
    },
    {
        prompt: '### 💉 Your eyes are glowing red\nThe heat is building behind your retinas. You can feel the blast coming. This is NOT good.',
        correct: { label: 'Close Your Eyes', emoji: '🫣' },
        wrong: [
            { label: 'Stare Into It', emoji: '👀' },
            { label: 'Laser The Ceiling', emoji: '🔴' },
            { label: 'Scream', emoji: '😱' },
        ],
        deathLines: [
            '### 💀 {name}\'s head did the Homelander special\nTwo red beams. Clean through. The back of their skull is gone.',
            '### 💀 {name} lasered themselves in half\nIt wasn\'t even dramatic — just a quiet sizzle, then two pieces.',
            '### 💀 {name}\'s eyes exploded outward\nLike microwaving an egg. Nobody needed to see that.',
        ],
    },
    {
        prompt: '### 💉 You\'re growing. Fast.\nYour bones are stretching. The ceiling is getting closer. You can hear your skeleton cracking.',
        correct: { label: 'Curl Into A Ball', emoji: '🫧' },
        wrong: [
            { label: 'Stand Tall', emoji: '🧍' },
            { label: 'Break Through Roof', emoji: '🏗️' },
            { label: 'Enjoy The View', emoji: '🌆' },
        ],
        deathLines: [
            '### 💀 {name} outgrew the room\nTheir body folded in ways bones shouldn\'t allow. Sounded like bubble wrap.',
            '### 💀 {name} couldn\'t stop growing\nSquashed into the ceiling like a hydraulic press video. Wet.',
            '### 💀 {name}\'s skeleton gave out\nTurns out bones have a size limit. {name} found it.',
        ],
    },
    {
        prompt: '### 💉 Your blood is boiling. Literally.\nSteam is coming out of your pores. Your veins are bulging and glowing orange.',
        correct: { label: 'Ice Bath NOW', emoji: '🧊' },
        wrong: [
            { label: 'Sweat It Out', emoji: '💦' },
            { label: 'Drink Water', emoji: '🚰' },
            { label: 'Man Up', emoji: '😤' },
        ],
        deathLines: [
            '### 💀 {name} boiled from the inside\nLike a kettle that forgot it was a person. The steam was red.',
            '### 💀 {name}\'s veins burst simultaneously\nEvery single one. It looked like a sprinkler system from hell.',
            '### 💀 {name} melted\nNot metaphorically. Literally liquefied. There\'s a puddle where they stood.',
        ],
    },
    {
        prompt: '### 💉 You can hear everyone\'s thoughts\nAll of them. AT ONCE. It\'s getting louder. Your nose is bleeding.',
        correct: { label: 'Focus On Nothing', emoji: '🧘' },
        wrong: [
            { label: 'Listen Harder', emoji: '👂' },
            { label: 'Scream Back', emoji: '🗣️' },
            { label: 'Think Louder', emoji: '🧠' },
        ],
        deathLines: [
            '### 💀 {name}\'s brain short-circuited\nEvery thought in the building hit them at once. Their head just... stopped.',
            '### 💀 {name} heard too much\nBlood from every orifice. Then the seizure. Then silence.',
            '### 💀 {name}\'s skull cracked open from the inside\nTurns out the human brain has a bandwidth limit.',
        ],
    },
    {
        prompt: '### 💉 You just duplicated yourself\nThere\'s two of you now. But the clone is looking at you weird. Really weird.',
        correct: { label: 'Assert Dominance', emoji: '👊' },
        wrong: [
            { label: 'Befriend It', emoji: '🤝' },
            { label: 'Run Away', emoji: '🏃' },
            { label: 'Hug Yourself', emoji: '🫂' },
        ],
        deathLines: [
            '### 💀 {name} was replaced by their clone\nThe clone smiled. Nobody noticed the switch. Original {name} was found in a dumpster.',
            '### 💀 {name} and their clone merged back\nTwo bodies tried to occupy one space. Physics won. {name} lost.',
            '### 💀 The clone ate {name}\nNot a metaphor. It unhinged its jaw like a snake. Wild stuff.',
        ],
    },
    {
        prompt: '### 💉 Your hands turned into blades\nActual metal blades. They\'re sharp. You can\'t control them. You\'re swinging.',
        correct: { label: 'Stay Perfectly Still', emoji: '🧊' },
        wrong: [
            { label: 'Jazz Hands', emoji: '🤗' },
            { label: 'High Five Someone', emoji: '✋' },
            { label: 'Clap', emoji: '👏' },
        ],
        deathLines: [
            '### 💀 {name} clapped\nBlade hands. They cut themselves in half lengthwise.',
            '### 💀 {name} tried to scratch their nose\nInstant lobotomy. DIY.',
            '### 💀 {name} sneezed and flinched\nThe blades did the rest. Three pieces.',
        ],
    },
    {
        prompt: '### 💉 Gravity reversed around you\nYou\'re floating toward the ceiling. Your shoes are still on the ground.',
        correct: { label: 'Grab Something', emoji: '🪢' },
        wrong: [
            { label: 'Enjoy Flying', emoji: '🕊️' },
            { label: 'Flap Your Arms', emoji: '🦅' },
            { label: 'Let Go', emoji: '🫠' },
        ],
        deathLines: [
            '### 💀 {name} hit the ceiling at terminal velocity\nFrom below. Upside down pancake.',
            '### 💀 {name} flew through the roof\nAnd kept going. Satellite footage showed them entering the stratosphere.',
            '### 💀 {name} reversed so hard their organs didn\'t\nBody went up. Internal organs stayed down. Briefly separated.',
        ],
    },
    {
        prompt: '### 💉 Your body is phasing in and out of reality\nParts of you keep disappearing. You can see another dimension through your torso.',
        correct: { label: 'Ground Yourself', emoji: '⚡' },
        wrong: [
            { label: 'Lean Into It', emoji: '🌀' },
            { label: 'Walk Through A Wall', emoji: '🚪' },
            { label: 'Phase Completely', emoji: '👻' },
        ],
        deathLines: [
            '### 💀 {name} phased out permanently\nHalf of them is in this dimension. The other half... isn\'t.',
            '### 💀 {name} got stuck between dimensions\nFrozen mid-phase. Their screaming face is now a permanent art installation.',
            '### 💀 {name} phased inside a wall\nWhen they solidified, they became part of the architecture.',
        ],
    },
    {
        prompt: '### 💉 Your teeth are multiplying\nThey\'re growing in rows, like a shark. Your mouth can\'t close anymore.',
        correct: { label: 'Spit Them Out', emoji: '🦷' },
        wrong: [
            { label: 'Smile Wide', emoji: '😁' },
            { label: 'Bite Something', emoji: '🫦' },
            { label: 'Start Chewing', emoji: '😬' },
        ],
        deathLines: [
            '### 💀 {name}\'s teeth filled their entire skull\nEvery cavity, every sinus. Teeth where brain should be.',
            '### 💀 {name} choked on their own teeth\nHundreds of them, flooding down their throat like a gumball machine.',
            '### 💀 {name}\'s jaw exploded from the pressure\nToo many teeth, not enough face.',
        ],
    },
    {
        prompt: '### 💉 You\'re vibrating at a molecular level\nYou can feel every atom in your body shaking. The floor beneath you is cracking.',
        correct: { label: 'Slow Your Breathing', emoji: '🌬️' },
        wrong: [
            { label: 'Vibrate Faster', emoji: '📳' },
            { label: 'Touch Someone', emoji: '🤚' },
            { label: 'Dance With It', emoji: '💃' },
        ],
        deathLines: [
            '### 💀 {name} vibrated apart\nEvery molecule separated simultaneously. They became a fine mist. Tasted metallic.',
            '### 💀 {name} shook so hard they phased through the floor\nFell through six stories. Each floor took a layer.',
            '### 💀 {name} touched the table\nThe vibration transferred. The table exploded. So did {name}.',
        ],
    },
    {
        prompt: '### 💉 Something is moving under your skin\nIt\'s alive. You can see it crawling from your arm toward your chest.',
        correct: { label: 'Contain It', emoji: '🩹' },
        wrong: [
            { label: 'Let It Out', emoji: '🔪' },
            { label: 'Push It Back', emoji: '👇' },
            { label: 'Name It', emoji: '🏷️' },
        ],
        deathLines: [
            '### 💀 Something burst out of {name}\nLike a Xenomorph but way less cool. It waved goodbye.',
            '### 💀 {name} tried to cut it out\nIt was their skeleton. Their skeleton was trying to leave.',
            '### 💀 {name}\'s entire skin walked away\nJust... left. Stood up and walked off. {name} remained. Briefly.',
        ],
    },
    {
        prompt: '### 💉 You can suddenly see the future\nEvery possible death. All of them are yours. All of them are NOW.',
        correct: { label: 'Accept It', emoji: '🧿' },
        wrong: [
            { label: 'Change The Future', emoji: '⏰' },
            { label: 'Look Away', emoji: '🙈' },
            { label: 'Scream At God', emoji: '⬆️' },
        ],
        deathLines: [
            '### 💀 {name} saw their own death\nAnd then it happened exactly as shown. Self-fulfilling prophecy.',
            '### 💀 {name} tried to dodge fate\nFate doesn\'t miss. {name} walked directly into the death they were running from.',
            '### 💀 {name} saw every death at once\nTheir brain couldn\'t handle the paradox. Instant shutdown.',
        ],
    },
    {
        prompt: '### 💉 Your shadow detached from the ground\nIt\'s standing up. It\'s looking at you. It\'s taller than you.',
        correct: { label: 'Step On It', emoji: '🦶' },
        wrong: [
            { label: 'Talk To It', emoji: '💬' },
            { label: 'Turn Off The Lights', emoji: '🔦' },
            { label: 'Offer It A Deal', emoji: '🤝' },
        ],
        deathLines: [
            '### 💀 {name}\'s shadow replaced them\nIt wore their face now. Nobody noticed. Nobody mourned.',
            '### 💀 {name} was absorbed by their own shadow\nPulled flat like a cartoon. But the screaming was very real.',
            '### 💀 {name} turned off the lights\nWithout light, the shadow was everywhere. {name} was nowhere.',
        ],
    },
];

// ═══════════════════════════════════════════
//  CHAOS EVENTS — The Boys-level unhinged
// ═══════════════════════════════════════════

const CHAOS_EVENTS = [
    {
        name: '👁️ HOMELANDER IS WATCHING',
        description: 'Timer halved. He doesn\'t like slow people.',
        effect: 'half_timer',
    },
    {
        name: '🥛 SOMEONE BROUGHT MILK',
        description: 'Homelander is distracted — extra time this round.',
        effect: 'extra_time',
    },
    {
        name: '🩸 DOUBLE DOSE',
        description: 'Two people get eliminated this round.',
        effect: 'double_elim',
    },
    {
        name: '🔇 BLACK NOIR\'S SHADOW',
        description: 'One button is a decoy. Choose wisely.',
        effect: 'decoy_button',
    },
    {
        name: '🫗 TEMP V',
        description: 'The correct answer changes after 3 seconds.',
        effect: 'switch_answer',
    },
    {
        name: '⚡ STARLIGHT SURGE',
        description: 'Everyone who survives gets a second chance next round.',
        effect: 'shield', // survivors get a free pass on next failure
    },
];

// ——— Injection flavor text ———
const INJECTION_FLAVOR = [
    '### 💉 Vought technicians inject the next dose...',
    '### 💉 The syringe is glowing blue. That can\'t be good.',
    '### 💉 A Vought intern stabs you with something unlabeled.',
    '### 💉 Compound V. Fresh batch. Smells like copper.',
    '### 💉 The needle goes in. You feel everything change.',
    '### 💉 "This batch is... experimental." — Vought Lab Tech',
    '### 💉 The liquid is moving on its own inside the syringe.',
];

// ——— Survival flavor ———
const SURVIVE_FLAVOR = [
    '{name} made the right call. For now.',
    '{name} survives. Barely.',
    '{name} gets to live another round. Lucky.',
    '{name} contained it. This time.',
    'Vought approves of {name}\'s survival instinct.',
    '{name} did NOT die horribly. Impressive.',
    '{name} lives. The compound settles... for now.',
];

// ——— Timeout deaths ———
const TIMEOUT_DEATHS = [
    '### 💀 {name} froze\nThe compound didn\'t wait. Neither did death.',
    '### 💀 {name} just stood there\nThe side effect consumed them while they panicked.',
    '### 💀 {name} was too slow\nVought\'s report will list cause of death as "indecision."',
    '### 💀 {name} timed out\nHomelander would be disappointed. Actually, he\'d probably laugh.',
    '### 💀 {name} couldn\'t choose\nSo the compound chose for them. It chose violence.',
];

// ——— Wrong choice deaths ———
const WRONG_CHOICE_DEATHS = [
    '### 💀 {name} made the wrong call\nConfidently wrong. The worst kind.',
    '### 💀 {name} picked... that?\nThe Vought interns are taking bets on who\'s dumbest.',
];

// ──────────────────────────────────────────
//  Build reaction buttons
// ──────────────────────────────────────────

function buildReactionButtons(gameId, effect, opts = {}) {
    const { hasDecoy, decoyExtra } = opts;

    const allButtons = [
        { ...effect.correct, isCorrect: true },
        ...effect.wrong.map(w => ({ ...w, isCorrect: false })),
    ];

    // Add decoy if chaos event
    if (hasDecoy && decoyExtra) {
        allButtons.push({ ...decoyExtra, isCorrect: false, isDecoy: true });
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

        const id = btn.isDecoy
            ? `${gameId}_decoy_${Date.now()}_${count}`
            : btn.isCorrect
                ? `${gameId}_correct`
                : `${gameId}_wrong_${count}`;

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(id)
                .setLabel(btn.label)
                .setEmoji(btn.emoji)
                .setStyle(btn.isCorrect ? ButtonStyle.Secondary : ButtonStyle.Secondary),
        );
        count++;
    }

    if (count > 0) rows.push(currentRow);
    return rows.slice(0, 5);
}

// ──────────────────────────────────────────
//  Wait for all players to react (or timeout)
// ──────────────────────────────────────────

function waitForReactions(msg, gameId, alivePlayers, timerMs, opts = {}) {
    return new Promise((resolve) => {
        const responses = new Map(); // playerId -> 'correct' | 'wrong' | 'decoy' | 'switched'
        const { switchAfterMs } = opts;
        let switched = false;

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.customId.startsWith(`${gameId}_`),
            time: timerMs,
        });

        // If TEMP V chaos: switch the correct answer after a delay
        let switchTimer = null;
        if (switchAfterMs) {
            switchTimer = setTimeout(() => {
                switched = true;
            }, switchAfterMs);
        }

        collector.on('collect', async (i) => {
            if (!alivePlayers.includes(i.user.id)) {
                await i.reply({ content: 'You\'re not in this trial.', ephemeral: true }).catch(() => {});
                return;
            }

            if (responses.has(i.user.id)) {
                await i.reply({ content: 'You already reacted! No take-backs.', ephemeral: true }).catch(() => {});
                return;
            }

            await i.deferUpdate().catch(() => {});

            if (i.customId.startsWith(`${gameId}_decoy`)) {
                responses.set(i.user.id, 'decoy');
            } else if (i.customId === `${gameId}_correct`) {
                // If switched (TEMP V), correct becomes wrong
                responses.set(i.user.id, switched ? 'switched' : 'correct');
            } else {
                // Wrong button — but if switched, one of the "wrong" ones is now correct? 
                // Nah, keep it simple: wrong is always wrong. Only correct can flip.
                responses.set(i.user.id, 'wrong');
            }

            // If everyone has answered, stop early
            if (responses.size >= alivePlayers.length) {
                collector.stop('all_answered');
            }
        });

        collector.on('end', () => {
            if (switchTimer) clearTimeout(switchTimer);

            // Players who didn't respond = timed out
            for (const id of alivePlayers) {
                if (!responses.has(id)) {
                    responses.set(id, 'timeout');
                }
            }

            resolve(responses);
        });
    });
}

// ══════════════════════════════════════════
//  MODULE EXPORT
// ══════════════════════════════════════════

module.exports = {
    data: new SlashCommandBuilder()
        .setName('compound')
        .setDescription('Compound V Roulette — survive the side effects or die horribly. (Admin)')
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
        //  PHASE 1 — RECRUITMENT (Join)
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
                    `${emoji} ${cap(card.rarity)} card to the survivor\n\n` +
                    `Vought Industries needs **test subjects**.\n` +
                    `You\'ll be injected with Compound V.\n` +
                    `Side effects include: **death**.\n` +
                    `React correctly — or get eliminated in ways that\'ll haunt this server.\n\n` +
                    `Recruitment closes in **${formatTime(remaining)}** · Need **${MIN_PLAYERS}+** subjects\n\n` +
                    `**${names.length}** recruited\n${list}`
                )
                .setThumbnail(card.imageUrl)
                .setColor(0x8b0000)
                .setFooter({ text: '"The best part about being a hero? Nobody can stop you." — Homelander' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${gameId}_join`)
                .setLabel('Volunteer')
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
                await i.reply({ content: 'You\'re already signed up, Subject.', ephemeral: true });
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
                        `Vought needed **${MIN_PLAYERS}** subjects. Only **${participants.size}** volunteered.\n` +
                        `Homelander is displeased.`
                    )
                    .setColor(0x2b2d31);

                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(joinRow.components[0]).setDisabled(true),
                );
                await msg.edit({ embeds: [failEmbed], components: [disabledRow] }).catch(() => {});
                return;
            }

            // ══════════════════════════════════════════
            //  PHASE 2 — THE TRIALS
            // ══════════════════════════════════════════

            const alive = [...participants.keys()];
            const eliminated = [];
            let roundNum = 0;
            const usedEffects = new Set();
            let shielded = new Set(); // from STARLIGHT SURGE

            // Delete join message, ping everyone
            await msg.delete().catch(() => {});

            const mentions = alive.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({ content: `${mentions}\n### 🧬 Compound V trials are beginning...` });
            await msg.edit({ content: '### 🧬 Compound V trials are beginning...' }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            const introEmbed = new EmbedBuilder()
                .setDescription(
                    `### 🏢 Welcome to Vought Tower\n\n` +
                    `**${participants.size}** test subjects. One survivor.\n` +
                    `Each round, you\'ll be injected with Compound V.\n` +
                    `The side effects are... unpredictable.\n\n` +
                    `React correctly, or die in ways that\'ll make Homelander uncomfortable.\n\n` +
                    `*And that\'s saying something.*`
                )
                .setColor(0x8b0000);
            await msg.edit({ content: '', embeds: [introEmbed], components: [] }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));

            // ——— GAME LOOP ———
            while (alive.length > 1) {
                roundNum++;

                // Pick a side effect we haven't used yet (reset if exhausted)
                let availableEffects = SIDE_EFFECTS.filter((_, i) => !usedEffects.has(i));
                if (availableEffects.length === 0) {
                    usedEffects.clear();
                    availableEffects = [...SIDE_EFFECTS];
                }
                const effectIndex = SIDE_EFFECTS.indexOf(pick(availableEffects));
                usedEffects.add(effectIndex);
                const effect = SIDE_EFFECTS[effectIndex];

                // Timer: shrinks per round
                const shrink = Math.floor(roundNum * 250);
                let timerMs = Math.max(MIN_REACT_MS, BASE_REACT_MS - shrink);

                // Chaos event check
                let chaosEvent = null;
                let hasDecoy = false;
                let decoyExtra = null;
                let isDoubleElim = false;
                let switchAfterMs = null;
                let addShield = false;

                if (roundNum > 1 && Math.random() < CHAOS_CHANCE) {
                    chaosEvent = pick(CHAOS_EVENTS);

                    switch (chaosEvent.effect) {
                        case 'half_timer':
                            timerMs = Math.max(MIN_REACT_MS, Math.ceil(timerMs / 2));
                            break;
                        case 'extra_time':
                            timerMs = Math.min(BASE_REACT_MS + 3000, timerMs + 3000);
                            break;
                        case 'double_elim':
                            isDoubleElim = alive.length > 2;
                            break;
                        case 'decoy_button':
                            hasDecoy = true;
                            // Pick a random wrong-looking button as decoy
                            decoyExtra = { label: effect.correct.label, emoji: '❓' };
                            break;
                        case 'switch_answer':
                            switchAfterMs = 3000;
                            break;
                        case 'shield':
                            addShield = true;
                            break;
                    }
                }

                const deadline = Math.floor((Date.now() + timerMs) / 1000);

                // ——— Injection phase ———
                const injectionEmbed = new EmbedBuilder()
                    .setDescription(pick(INJECTION_FLAVOR))
                    .setColor(0x4a0080);
                await msg.edit({ content: '', embeds: [injectionEmbed], components: [] }).catch(() => {});
                await new Promise(r => setTimeout(r, randInt(1500, 2500)));

                // ——— Side effect reveal ———
                const aliveList = alive.map(id => {
                    const shield = shielded.has(id) ? ' 🛡️' : '';
                    return `╰ ${participants.get(id)}${shield}`;
                }).join('\n');

                const elimList = eliminated.length > 0
                    ? eliminated.map(id => `~~${participants.get(id)}~~`).join(', ')
                    : null;

                let chaosText = '';
                if (chaosEvent) {
                    chaosText = `\n> ⚠️ **${chaosEvent.name}** — ${chaosEvent.description}\n`;
                }

                const effectEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🧬 Round ${roundNum} — Compound V Roulette\n` +
                        chaosText +
                        `\n${effect.prompt}\n\n` +
                        `**React NOW** — ⏱ <t:${deadline}:R>\n\n` +
                        `**Alive (${alive.length})**\n${aliveList}` +
                        (elimList ? `\n\nDead: ${elimList}` : '')
                    )
                    .setThumbnail(card.imageUrl)
                    .setColor(timerMs <= 4000 ? 0xff0000 : 0x8b0000)
                    .setFooter({ text: `Trial ${roundNum} · ${(timerMs / 1000).toFixed(0)}s to react` });

                const buttonRows = buildReactionButtons(gameId, effect, { hasDecoy, decoyExtra });
                await msg.edit({ embeds: [effectEmbed], components: buttonRows }).catch(() => {});

                // ——— Wait for reactions ———
                const responses = await waitForReactions(msg, gameId, alive, timerMs, { switchAfterMs });

                // ——— Process results ———
                const survivors = [];
                const deaths = [];

                for (const [playerId, result] of responses) {
                    if (result === 'correct') {
                        survivors.push(playerId);
                    } else if (shielded.has(playerId) && result !== 'correct') {
                        // Shield absorbs one failure
                        survivors.push(playerId);
                        shielded.delete(playerId);
                    } else {
                        deaths.push({ id: playerId, reason: result });
                    }
                }

                // Clear shields after use
                shielded.clear();

                // If everyone would die, save a random one
                if (survivors.length === 0 && deaths.length > 0) {
                    const saved = deaths.splice(randInt(0, deaths.length - 1), 1)[0];
                    survivors.push(saved.id);
                }

                // Double elim: keep max deaths
                // Normal: only kill 1 (or 2 if double elim)
                if (!isDoubleElim && deaths.length > 1) {
                    // Multiple people failed — pick one to actually die
                    shuffle(deaths);
                    const killed = deaths.shift();
                    // Rest survive (they were wrong, but only one dies per round normally)
                    for (const d of deaths) {
                        survivors.push(d.id);
                    }
                    deaths.length = 0;
                    deaths.push(killed);
                } else if (isDoubleElim && deaths.length > 2) {
                    shuffle(deaths);
                    const kept = deaths.splice(0, 2);
                    for (const d of deaths) {
                        survivors.push(d.id);
                    }
                    deaths.length = 0;
                    deaths.push(...kept);
                }

                // If nobody died somehow, skip elimination
                if (deaths.length === 0) {
                    const safeEmbed = new EmbedBuilder()
                        .setDescription(
                            `### ✅ Everyone survived Round ${roundNum}\n\n` +
                            `The compound stabilized. Nobody died.\n` +
                            `*Homelander looks bored.*\n\n` +
                            `**${alive.length}** remain`
                        )
                        .setColor(0x2b2d31);
                    await msg.edit({ embeds: [safeEmbed], components: [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2000));

                    // Add shields if STARLIGHT SURGE
                    if (addShield) {
                        for (const id of alive) shielded.add(id);
                    }
                    continue;
                }

                // ——— ELIMINATION ———
                // Build the death announcement
                for (const death of deaths) {
                    alive.splice(alive.indexOf(death.id), 1);
                    eliminated.push(death.id);
                }

                // Survivor callouts
                const surviveLines = survivors
                    .slice(0, 4)
                    .map(id => pick(SURVIVE_FLAVOR).replace('{name}', participants.get(deaths[0]?.id === id ? deaths[0].id : id).split(' ')[0]).replace('{name}', participants.get(id)))
                    .join('\n');

                // Death announcements
                let deathText = '';
                for (const death of deaths) {
                    const name = participants.get(death.id);
                    if (death.reason === 'timeout') {
                        deathText += pick(TIMEOUT_DEATHS).replace(/\{name\}/g, name) + '\n\n';
                    } else if (death.reason === 'decoy') {
                        deathText += `### 💀 ${name} clicked the decoy\nBlack Noir sends his regards.\n\n`;
                    } else if (death.reason === 'switched') {
                        deathText += `### 💀 ${name} was right... then the answer changed\nTemp V is a hell of a drug. ${name} wasn\'t fast enough.\n\n`;
                    } else {
                        // wrong choice — use the side effect's death lines
                        deathText += pick(effect.deathLines).replace(/\{name\}/g, name) + '\n\n';
                    }
                }

                const deathEmbed = new EmbedBuilder()
                    .setDescription(
                        deathText +
                        `**${alive.length}** test subject${alive.length !== 1 ? 's' : ''} remain`
                    )
                    .setColor(0xff0000);

                await msg.edit({ embeds: [deathEmbed], components: [] }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));

                // Add shields if STARLIGHT SURGE
                if (addShield) {
                    for (const id of alive) shielded.add(id);
                }

                if (alive.length <= 1) break;

                // Brief pause between rounds
                const betweenEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🧪 Preparing next injection...\n\n` +
                        `**${alive.length}** subjects remaining\n` +
                        alive.map(id => `╰ ${participants.get(id)}`).join('\n')
                    )
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [betweenEmbed], components: [] }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));
            }

            // ══════════════════════════════════════════
            //  PHASE 3 — SOLE SURVIVOR
            // ══════════════════════════════════════════

            if (alive.length === 0) {
                const noWinnerEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 🧬 Trial Complete — No Survivors\n\n` +
                        `Every test subject died.\n` +
                        `The card goes unclaimed.\n` +
                        `Homelander shrugs. "Disappointing."\n\n` +
                        `*Vought stock drops 2%.*`
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
                    `One subject remains standing in the wreckage.\n` +
                    `Blood on the walls. Silence in the lab.`
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
                    `"*I can do whatever I want.*"\n\n` +
                    `**Body Count**\n` +
                    `1. **${winnerName}** 🧬 — Sole Survivor\n` +
                    elimOrder.reverse().join('\n') +
                    `\n\n_${roundNum} rounds · ${eliminated.length} deaths · ${participants.size} subjects_`
                )
                .setImage(card.imageUrl)
                .setColor(0x8b0000)
                .setTimestamp()
                .setFooter({ text: 'Vought International™ — "Saving The World, One Dose At A Time"' });

            await msg.edit({ embeds: [victoryEmbed], components: [] }).catch(() => {});
        });
    },
};
