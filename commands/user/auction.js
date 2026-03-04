const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
} = require('discord.js');
const dm = require('../../utils/dataManager');
const { config } = require('../../utils/config');

const DURATION_MS = dm.AUCTION_DEFAULTS.defaultDurationMs;     // 2 min
const BID_INCREMENT = dm.AUCTION_DEFAULTS.bidIncrement;        // +10 coins min
const SNIPE_WINDOW_MS = 30_000;   // anti-snipe: extend if bid in last 30 s
const SNIPE_EXTEND_MS = 30_000;   // how much to extend by
const TIMER_TICK_MS = 15_000;     // refresh countdown every 15 s

const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

// ── helpers ──

function timeLeft(endsAt) {
    const ms = endsAt - Date.now();
    if (ms <= 0) return '**Ended**';
    const s = Math.ceil(ms / 1000);
    if (s >= 60) return `**${Math.floor(s / 60)}m ${s % 60}s**`;
    return `**${s}s**`;
}

function auctionEmbed(card, seller, state) {
    const emoji = config.rarityEmojis[card.rarity] || '⚪';
    const rarity = card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1);

    const bidLine = state.highBidder
        ? `💰 Current bid: **${state.highBid.toLocaleString()}** coins — <@${state.highBidder}>`
        : `💰 Starting bid: **${state.startPrice.toLocaleString()}** coins`;

    const buyoutLine = state.buyout
        ? `\n🏷️ Buy Now: **${state.buyout.toLocaleString()}** coins`
        : '';

    const nextBid = state.highBidder
        ? state.highBid + BID_INCREMENT
        : state.startPrice;

    const embed = new EmbedBuilder()
        .setTitle('🔨 Auction')
        .setColor(0xe67e22)
        .setDescription(
            `${emoji} **${card.name}** · ${rarity}\n` +
            `Seller: **${seller}**\n\n` +
            `${bidLine}${buyoutLine}\n` +
            `Next minimum bid: **${nextBid.toLocaleString()}** coins\n\n` +
            `⏱️ Ends in: ${timeLeft(state.endsAt)}`
        )
        .setFooter({ text: `${state.totalBids} bid${state.totalBids === 1 ? '' : 's'}` })
        .setTimestamp();

    if (card.imageUrl) embed.setImage(card.imageUrl);
    return embed;
}

function auctionButtons(auctionId, state) {
    const nextBid = state.highBidder
        ? state.highBid + BID_INCREMENT
        : state.startPrice;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${auctionId}_bid`)
            .setLabel(`Bid ${nextBid.toLocaleString()}`)
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary),
    );

    if (state.buyout) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${auctionId}_buyout`)
                .setLabel(`Buy Now ${state.buyout.toLocaleString()}`)
                .setEmoji('🏷️')
                .setStyle(ButtonStyle.Success),
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${auctionId}_cancel`)
            .setLabel('Cancel')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Secondary),
    );

    return [row];
}

// ── module ──

module.exports = {
    data: new SlashCommandBuilder()
        .setName('auction')
        .setDescription('Auction a card — other players bid with coins!')
        .addStringOption(opt =>
            opt.setName('card')
                .setDescription('Card to auction')
                .setRequired(true)
                .setAutocomplete(true))
        .addIntegerOption(opt =>
            opt.setName('startprice')
                .setDescription('Starting price in coins (default: card sell value)')
                .setMinValue(1)
                .setMaxValue(50000))
        .addIntegerOption(opt =>
            opt.setName('buyout')
                .setDescription('Buy-now price (optional)')
                .setMinValue(1)
                .setMaxValue(100000)),

    // ── autocomplete ──

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const inv = dm.getUserInventory(interaction.user.id);
        const allCards = dm.getCards();
        const ownedEntries = inv.filter(e => e.quantity > 0);
        const results = allCards
            .filter(c => ownedEntries.some(e => e.cardId === c.id) && c.name.toLowerCase().includes(focused))
            .sort((a, b) => {
                const ai = RARITY_ORDER.indexOf(a.rarity);
                const bi = RARITY_ORDER.indexOf(b.rarity);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            })
            .slice(0, 25);

        await interaction.respond(results.map(c => {
            const qty = ownedEntries.find(e => e.cardId === c.id)?.quantity ?? 1;
            const emoji = config.rarityEmojis[c.rarity] || '⚪';
            const price = dm.SELL_PRICES[c.rarity] ?? 0;
            return {
                name: `${emoji} ${c.name} (${c.rarity}) x${qty} — ${price} coins`,
                value: c.id,
            };
        }));
    },

    // ── execute ──

    async execute(interaction) {
        const cardId = interaction.options.getString('card');
        const card = dm.findCardById(cardId);

        if (!card) return interaction.reply({ content: '❌ Card not found.', ephemeral: true });
        if (!dm.userHasCard(interaction.user.id, cardId))
            return interaction.reply({ content: `❌ You don't own **${card.name}**.`, ephemeral: true });
        if (dm.isCardLocked(interaction.user.id, cardId))
            return interaction.reply({ content: `❌ **${card.name}** is staked in a duel or another auction!`, ephemeral: true });

        const sellValue = dm.SELL_PRICES[card.rarity] ?? 10;
        const startPrice = interaction.options.getInteger('startprice') ?? sellValue;
        const buyout = interaction.options.getInteger('buyout') ?? null;

        if (buyout !== null && buyout <= startPrice) {
            return interaction.reply({
                content: `❌ Buyout (**${buyout}**) must be higher than the starting price (**${startPrice}**).`,
                ephemeral: true,
            });
        }

        // Lock the card so it can't be sold/dueled/traded while listed
        dm.lockCard(interaction.user.id, cardId);

        const auctionId = dm.generateAuctionId();
        const sellerId = interaction.user.id;
        const sellerName = interaction.user.username;

        const state = {
            id: auctionId,
            cardId,
            sellerId,
            sellerName,
            startPrice,
            buyout,
            highBid: 0,
            highBidder: null,
            highBidderName: null,
            totalBids: 0,
            endsAt: Date.now() + DURATION_MS,
        };

        const embed = auctionEmbed(card, sellerName, state);
        const reply = await interaction.reply({
            embeds: [embed],
            components: auctionButtons(auctionId, state),
            fetchReply: true,
        });

        // Store in active map
        dm.activeAuctions.set(auctionId, state);

        // ── Timer: update countdown ──
        const tickInterval = setInterval(async () => {
            const s = dm.activeAuctions.get(auctionId);
            if (!s) { clearInterval(tickInterval); return; }
            if (Date.now() >= s.endsAt) return; // endAuction will handle
            try {
                await reply.edit({
                    embeds: [auctionEmbed(card, sellerName, s)],
                    components: auctionButtons(auctionId, s),
                });
            } catch { /* message deleted */ }
        }, TIMER_TICK_MS);

        // ── Timer: end auction ──
        function scheduleEnd() {
            const s = dm.activeAuctions.get(auctionId);
            if (!s) return;
            const delay = Math.max(0, s.endsAt - Date.now());
            return setTimeout(() => endAuction(), delay);
        }
        let endTimeout = scheduleEnd();

        async function endAuction() {
            clearInterval(tickInterval);
            const s = dm.activeAuctions.get(auctionId);
            if (!s) return; // already ended
            dm.activeAuctions.delete(auctionId);

            if (s.highBidder) {
                // Winner pays, seller receives
                // Coins were already escrowed (deducted on bid)
                dm.addCoins(sellerId, sellerName, s.highBid);
                dm.transferCard(sellerId, s.highBidder, s.highBidderName, cardId);
                dm.unlockCard(sellerId, cardId);

                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const winEmbed = new EmbedBuilder()
                    .setTitle('🔨 Auction Sold!')
                    .setColor(0x4caf50)
                    .setDescription(
                        `${emoji} **${card.name}** sold to **${s.highBidderName}**!\n\n` +
                        `💰 Final price: **${s.highBid.toLocaleString()}** coins\n` +
                        `📦 **${sellerName}** receives **${s.highBid.toLocaleString()}** coins`
                    )
                    .setFooter({ text: `${s.totalBids} bid${s.totalBids === 1 ? '' : 's'}` })
                    .setTimestamp();
                if (card.imageUrl) winEmbed.setImage(card.imageUrl);

                await reply.edit({ embeds: [winEmbed], components: [] }).catch(() => { });
            } else {
                // No bids — card returns to seller
                dm.unlockCard(sellerId, cardId);

                const noSaleEmbed = new EmbedBuilder()
                    .setTitle('🔨 Auction Ended')
                    .setColor(0x2b2d31)
                    .setDescription(
                        `No bids. **${card.name}** has been returned to **${sellerName}**.`
                    )
                    .setTimestamp();
                await reply.edit({ embeds: [noSaleEmbed], components: [] }).catch(() => { });
            }
        }

        // ── Component collector ──
        const collector = reply.createMessageComponentCollector({
            time: dm.AUCTION_DEFAULTS.maxDurationMs + SNIPE_EXTEND_MS * 5 + 10_000,
        });

        collector.on('collect', async (i) => {
            const s = dm.activeAuctions.get(auctionId);
            if (!s) {
                return i.reply({ content: '🔨 This auction has ended.', ephemeral: true });
            }

            // ── Cancel ──
            if (i.customId === `${auctionId}_cancel`) {
                if (i.user.id !== sellerId) {
                    return i.reply({ content: '❌ Only the seller can cancel.', ephemeral: true });
                }
                if (s.highBidder) {
                    return i.reply({ content: '❌ You can\'t cancel — there are active bids!', ephemeral: true });
                }

                // No bids, safe to cancel
                clearTimeout(endTimeout);
                clearInterval(tickInterval);
                dm.activeAuctions.delete(auctionId);
                dm.unlockCard(sellerId, cardId);
                collector.stop('cancelled');

                const cancelEmbed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setDescription(`🔨 Auction cancelled. **${card.name}** returned to **${sellerName}**.`);
                return i.update({ embeds: [cancelEmbed], components: [] });
            }

            // ── Bid ──
            if (i.customId === `${auctionId}_bid`) {
                if (i.user.id === sellerId) {
                    return i.reply({ content: '❌ You can\'t bid on your own auction!', ephemeral: true });
                }

                const nextBid = s.highBidder ? s.highBid + BID_INCREMENT : s.startPrice;
                const balance = dm.getBalance(i.user.id);

                if (balance < nextBid) {
                    return i.reply({
                        content: `❌ You need **${nextBid.toLocaleString()}** coins but only have **${balance.toLocaleString()}**!`,
                        ephemeral: true,
                    });
                }

                // Refund previous bidder
                if (s.highBidder) {
                    dm.addCoins(s.highBidder, s.highBidderName, s.highBid);
                }

                // Escrow new bid
                dm.removeCoins(i.user.id, nextBid);

                const previousBidder = s.highBidder;
                s.highBid = nextBid;
                s.highBidder = i.user.id;
                s.highBidderName = i.user.username;
                s.totalBids += 1;

                // Anti-snipe: extend if bid in last 30 seconds
                const remaining = s.endsAt - Date.now();
                if (remaining < SNIPE_WINDOW_MS) {
                    s.endsAt += SNIPE_EXTEND_MS;
                    clearTimeout(endTimeout);
                    endTimeout = scheduleEnd();
                }

                await i.update({
                    embeds: [auctionEmbed(card, sellerName, s)],
                    components: auctionButtons(auctionId, s),
                });

                // Notify the outbid player (if different)
                if (previousBidder && previousBidder !== i.user.id) {
                    await i.followUp({
                        content: `⚠️ <@${previousBidder}> you've been outbid! Your **${(nextBid - BID_INCREMENT).toLocaleString()}** coins have been refunded.`,
                        ephemeral: false,
                    }).catch(() => { });
                }
                return;
            }

            // ── Buyout ──
            if (i.customId === `${auctionId}_buyout`) {
                if (i.user.id === sellerId) {
                    return i.reply({ content: '❌ You can\'t buy your own card!', ephemeral: true });
                }
                if (!s.buyout) {
                    return i.reply({ content: '❌ No buyout set.', ephemeral: true });
                }

                const balance = dm.getBalance(i.user.id);
                if (balance < s.buyout) {
                    return i.reply({
                        content: `❌ You need **${s.buyout.toLocaleString()}** coins but only have **${balance.toLocaleString()}**!`,
                        ephemeral: true,
                    });
                }

                // Refund previous bidder
                if (s.highBidder) {
                    dm.addCoins(s.highBidder, s.highBidderName, s.highBid);
                }

                // Process buyout
                dm.removeCoins(i.user.id, s.buyout);
                dm.addCoins(sellerId, sellerName, s.buyout);
                dm.transferCard(sellerId, i.user.id, i.user.username, cardId);
                dm.unlockCard(sellerId, cardId);

                clearTimeout(endTimeout);
                clearInterval(tickInterval);
                dm.activeAuctions.delete(auctionId);
                collector.stop('buyout');

                const emoji = config.rarityEmojis[card.rarity] || '⚪';
                const buyoutEmbed = new EmbedBuilder()
                    .setTitle('🔨 Sold — Buy Now!')
                    .setColor(0x4caf50)
                    .setDescription(
                        `${emoji} **${card.name}** bought by **${i.user.username}**!\n\n` +
                        `🏷️ Buy Now price: **${s.buyout.toLocaleString()}** coins\n` +
                        `📦 **${sellerName}** receives **${s.buyout.toLocaleString()}** coins`
                    )
                    .setFooter({ text: `${s.totalBids} bid${s.totalBids === 1 ? '' : 's'} before buyout` })
                    .setTimestamp();
                if (card.imageUrl) buyoutEmbed.setImage(card.imageUrl);

                return i.update({ embeds: [buyoutEmbed], components: [] });
            }
        });

        collector.on('end', async (_, reason) => {
            clearInterval(tickInterval);
            if (reason === 'time') {
                // Safety net: if timer expired without endAuction running
                const s = dm.activeAuctions.get(auctionId);
                if (s) {
                    dm.activeAuctions.delete(auctionId);
                    if (s.highBidder) {
                        dm.addCoins(sellerId, sellerName, s.highBid);
                        dm.transferCard(sellerId, s.highBidder, s.highBidderName, cardId);
                    }
                    dm.unlockCard(sellerId, cardId);
                    await reply.edit({
                        embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription('🔨 Auction expired.')],
                        components: [],
                    }).catch(() => { });
                }
            }
        });
    },
};
