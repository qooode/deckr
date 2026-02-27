const {
    SlashCommandBuilder, PermissionFlagsBits,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

// ——— Config ———
const JOIN_DURATION_MS = 2 * 60 * 1000;       // 2 minutes to join
const VOTE_DURATION_MS = 30 * 1000;            // 30 seconds to vote
const MIN_PLAYERS = 2;                          // need at least 2

// Reward tiers
const REWARD_ALL_SHARE = 'rare';       // everyone shares → rare+ for all
const REWARD_STEALERS = 'epic';       // mixed → epic+ for stealers only

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}:${String(sec).padStart(2, '0')}`;
    return `${sec}s`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crate')
        .setDescription('Drop a crate for players to share or steal (Admin only)')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to drop the crate in').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!config.adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
        }

        const cards = dm.getCards();
        if (cards.length === 0) {
            return interaction.reply({ content: '❌ No cards in the pool yet!', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        await interaction.reply({ content: `✅ Crate dropped in ${channel}!`, ephemeral: true });

        // ══════════════════════════════════════════
        //  PHASE 1 — JOIN
        // ══════════════════════════════════════════

        const participants = new Map(); // userId → username
        const crateId = `crate_${Date.now()}`;
        const endsAt = Date.now() + JOIN_DURATION_MS;

        function buildJoinEmbed() {
            const remaining = Math.max(0, endsAt - Date.now());
            const names = [...participants.values()];
            const list = names.length > 0
                ? names.map(n => `╰ ${n}`).join('\n')
                : '*No one yet...*';

            return new EmbedBuilder()
                .setDescription(
                    `### 📦 A Crate Appeared!\n` +
                    `Closes in **${formatTime(remaining)}** — join now.\n\n` +
                    `**${names.length}** joined\n${list}\n`
                )
                .setColor(0x2b2d31)
                .setFooter({ text: 'When time is up, you\'ll choose: Share or Steal' });
        }

        const joinRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${crateId}_join`)
                .setLabel('Join')
                .setEmoji('📦')
                .setStyle(ButtonStyle.Secondary),
        );

        let msg = await channel.send({
            embeds: [buildJoinEmbed()],
            components: [joinRow],
        });

        // Live countdown updates
        const countdownInterval = setInterval(async () => {
            const remaining = endsAt - Date.now();
            if (remaining <= 0) {
                clearInterval(countdownInterval);
                return;
            }
            await msg.edit({ embeds: [buildJoinEmbed()] }).catch(() => { });
        }, 10_000); // update every 10s

        const joinCollector = msg.createMessageComponentCollector({
            filter: (i) => i.customId === `${crateId}_join`,
            time: JOIN_DURATION_MS,
        });

        joinCollector.on('collect', async (i) => {
            if (participants.has(i.user.id)) {
                return i.reply({ content: 'You already joined this crate.', ephemeral: true });
            }
            participants.set(i.user.id, i.user.username);
            await i.update({ embeds: [buildJoinEmbed()] });
        });

        joinCollector.on('end', async () => {
            clearInterval(countdownInterval);

            if (participants.size < MIN_PLAYERS) {
                const failEmbed = new EmbedBuilder()
                    .setDescription(
                        `### 📦 Crate Expired\n` +
                        `Needed at least **${MIN_PLAYERS}** players. Only **${participants.size}** joined.`
                    )
                    .setColor(0x2b2d31);

                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(joinRow.components[0]).setDisabled(true),
                );
                await msg.edit({ embeds: [failEmbed], components: [disabledRow] }).catch(() => { });
                return;
            }

            // ══════════════════════════════════════════
            //  PHASE 2 — VOTE (Share or Steal)
            // ══════════════════════════════════════════

            const votes = new Map(); // userId → 'share' | 'steal'
            const playerIds = [...participants.keys()];

            const names = [...participants.values()];
            const votingEmbed = new EmbedBuilder()
                .setDescription(
                    `### 📦 Crate Sealed — Choose!\n` +
                    `**${names.length}** players are deciding...\n\n` +
                    names.map(n => `╰ ${n} — ⏳`).join('\n') + '\n\n' +
                    `🤝 **Everyone shares** → everyone gets a **${cap(REWARD_ALL_SHARE)}+** card\n` +
                    `💰 **You steal** → stealers get an **${cap(REWARD_STEALERS)}+** card, sharers get nothing\n` +
                    `💀 **Everyone steals** → nobody gets anything\n`
                )
                .setColor(0xfee75c)
                .setFooter({ text: `${formatTime(VOTE_DURATION_MS)} to decide` });

            const voteRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${crateId}_share`)
                    .setLabel('Share')
                    .setEmoji('🤝')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`${crateId}_steal`)
                    .setLabel('Steal')
                    .setEmoji('💰')
                    .setStyle(ButtonStyle.Danger),
            );

            // Delete old message, send a fresh one at the bottom of chat
            await msg.delete().catch(() => { });

            // Ping all participants so they get notified, then edit pings away
            const mentions = playerIds.map(id => `<@${id}>`).join(' ');
            msg = await channel.send({
                content: `${mentions} — time to vote!`,
                embeds: [votingEmbed],
                components: [voteRow],
            });

            // Remove pings from content so chat stays clean
            await msg.edit({ content: '' }).catch(() => { });

            const voteCollector = msg.createMessageComponentCollector({
                filter: (i) =>
                    (i.customId === `${crateId}_share` || i.customId === `${crateId}_steal`)
                    && playerIds.includes(i.user.id),
                time: VOTE_DURATION_MS,
            });

            voteCollector.on('collect', async (i) => {
                if (votes.has(i.user.id)) {
                    return i.reply({ content: 'You already made your choice.', ephemeral: true });
                }

                const choice = i.customId === `${crateId}_share` ? 'share' : 'steal';
                votes.set(i.user.id, choice);

                const label = choice === 'share' ? '🤝 Share' : '💰 Steal';
                await i.reply({ content: `You chose **${label}**. Wait for the reveal...`, ephemeral: true });

                // Update embed to show who has locked in (without revealing choice)
                const updatedLines = playerIds.map(id => {
                    const name = participants.get(id);
                    const status = votes.has(id) ? '✅' : '⏳';
                    return `╰ ${name} — ${status}`;
                });

                const updatedEmbed = EmbedBuilder.from(votingEmbed)
                    .setDescription(
                        `### 📦 Crate Sealed — Choose!\n` +
                        `**${names.length}** players are deciding...\n\n` +
                        updatedLines.join('\n') + '\n\n' +
                        `🤝 **Everyone shares** → everyone gets a **${cap(REWARD_ALL_SHARE)}+** card\n` +
                        `💰 **You steal** → stealers get an **${cap(REWARD_STEALERS)}+** card, sharers get nothing\n` +
                        `💀 **Everyone steals** → nobody gets anything\n`
                    );

                await msg.edit({ embeds: [updatedEmbed] }).catch(() => { });

                // If everyone voted, stop early
                if (votes.size >= playerIds.length) {
                    voteCollector.stop('all_voted');
                }
            });

            voteCollector.on('end', async () => {
                // Anyone who didn't vote defaults to "share" (they didn't act, no reward if stolen from)
                for (const id of playerIds) {
                    if (!votes.has(id)) votes.set(id, 'share');
                }

                // ══════════════════════════════════════════
                //  PHASE 3 — REVEAL
                // ══════════════════════════════════════════

                // Suspense pause
                const suspenseEmbed = new EmbedBuilder()
                    .setDescription(`### 📦 Opening the crate...`)
                    .setColor(0x2b2d31);
                await msg.edit({ embeds: [suspenseEmbed], components: [] }).catch(() => { });
                await new Promise(r => setTimeout(r, 2000));

                const sharers = playerIds.filter(id => votes.get(id) === 'share');
                const stealers = playerIds.filter(id => votes.get(id) === 'steal');

                const allShared = stealers.length === 0;
                const allStole = sharers.length === 0;

                // Build the reveal lines
                const revealLines = playerIds.map(id => {
                    const name = participants.get(id);
                    const choice = votes.get(id);
                    if (choice === 'share') return `🤝 ${name} — shared`;
                    return `💰 **${name}** — **stole**`;
                });

                let outcomeTitle, outcomeDesc, outcomeColor;

                if (allShared) {
                    // ——— EVERYONE SHARED ———
                    outcomeTitle = '📦 Trust Rewarded!';
                    outcomeColor = 0x4caf50;

                    const rewards = [];
                    for (const id of playerIds) {
                        const card = dm.getRandomCardMinRarity(REWARD_ALL_SHARE);
                        if (card) {
                            dm.addCardToUser(id, participants.get(id), card.id);
                            const emoji = config.rarityEmojis[card.rarity] || '⚪';
                            rewards.push(`╰ ${participants.get(id)} → ${emoji} **${card.name}** · ${cap(card.rarity)}`);
                        }
                    }

                    outcomeDesc =
                        `Everyone kept their word.\n\n` +
                        revealLines.join('\n') + '\n\n' +
                        `**Rewards**\n` +
                        rewards.join('\n');

                } else if (allStole) {
                    // ——— EVERYONE STOLE ———
                    outcomeTitle = '💀 Total Greed';
                    outcomeColor = 0x2b2d31;

                    outcomeDesc =
                        `Everyone tried to steal. Nobody gets anything.\n\n` +
                        revealLines.join('\n');

                } else {
                    // ——— MIXED ———
                    outcomeTitle = '💰 Betrayal!';
                    outcomeColor = 0xed4245;

                    const rewards = [];
                    for (const id of stealers) {
                        const card = dm.getRandomCardMinRarity(REWARD_STEALERS);
                        if (card) {
                            dm.addCardToUser(id, participants.get(id), card.id);
                            const emoji = config.rarityEmojis[card.rarity] || '⚪';
                            rewards.push(`╰ ${participants.get(id)} → ${emoji} **${card.name}** · ${cap(card.rarity)}`);
                        }
                    }

                    const betrayedNames = sharers.map(id => participants.get(id)).join(', ');

                    outcomeDesc =
                        `${betrayedNames} got nothing.\n\n` +
                        revealLines.join('\n') + '\n\n' +
                        `**Rewards (stealers only)**\n` +
                        rewards.join('\n');
                }

                const revealEmbed = new EmbedBuilder()
                    .setDescription(`### ${outcomeTitle}\n${outcomeDesc}`)
                    .setColor(outcomeColor)
                    .setTimestamp();

                await msg.edit({ embeds: [revealEmbed], components: [] }).catch(() => { });
            });
        });
    },
};
