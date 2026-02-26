const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const PATHS = {
  cards: path.join(DATA_DIR, 'cards.json'),
  inventory: path.join(DATA_DIR, 'inventory.json'),
  cooldowns: path.join(DATA_DIR, 'cooldowns.json'),
  trades: path.join(DATA_DIR, 'trades.json'),
};

// ---------- Generic Read/Write ----------

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Cards ----------

function getCards() {
  return readJSON(PATHS.cards)?.cards ?? [];
}

function saveCards(cards) {
  writeJSON(PATHS.cards, { cards });
}

function addCard(card) {
  const cards = getCards();
  cards.push(card);
  saveCards(cards);
}

function deleteCard(cardId) {
  let cards = getCards();
  cards = cards.filter(c => c.id !== cardId);
  saveCards(cards);
}

function findCardById(cardId) {
  return getCards().find(c => c.id === cardId) ?? null;
}

function findCardByName(name) {
  return getCards().find(c => c.name.toLowerCase() === name.toLowerCase()) ?? null;
}

function generateCardId() {
  const cards = getCards();
  let maxNum = 0;
  for (const c of cards) {
    const match = c.id.match(/^card_(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
  }
  return `card_${String(maxNum + 1).padStart(4, '0')}`;
}

// ---------- Inventory ----------

function getInventory() {
  return readJSON(PATHS.inventory)?.users ?? {};
}

function saveInventory(users) {
  writeJSON(PATHS.inventory, { users });
}

function getUserInventory(userId) {
  const users = getInventory();
  return users[userId]?.cards ?? [];
}

function addCardToUser(userId, username, cardId) {
  const users = getInventory();
  if (!users[userId]) {
    users[userId] = { username, cards: [] };
  }
  users[userId].username = username; // keep username up to date
  const existing = users[userId].cards.find(c => c.cardId === cardId);
  if (existing) {
    existing.quantity += 1;
    existing.lastClaimedAt = new Date().toISOString();
  } else {
    users[userId].cards.push({
      cardId,
      quantity: 1,
      firstClaimedAt: new Date().toISOString(),
      lastClaimedAt: new Date().toISOString(),
    });
  }
  saveInventory(users);
}

function removeCardFromUser(userId, cardId) {
  const users = getInventory();
  if (!users[userId]) return false;
  const entry = users[userId].cards.find(c => c.cardId === cardId);
  if (!entry || entry.quantity <= 0) return false;
  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    users[userId].cards = users[userId].cards.filter(c => c.cardId !== cardId);
  }
  saveInventory(users);
  return true;
}

function userHasCard(userId, cardId) {
  const cards = getUserInventory(userId);
  const entry = cards.find(c => c.cardId === cardId);
  return entry && entry.quantity > 0;
}

// Safe atomic transfer: add to winner FIRST, then remove from loser.
// If the bot crashes between the two writes, the card is duplicated (recoverable)
// rather than deleted (unrecoverable).
function transferCard(fromUserId, toUserId, toUsername, cardId) {
  addCardToUser(toUserId, toUsername, cardId);
  removeCardFromUser(fromUserId, cardId);
}

// ---------- Card Locking (in-memory, prevents double-staking) ----------

const lockedCards = new Map(); // userId -> Set of cardIds

function lockCard(userId, cardId) {
  if (!lockedCards.has(userId)) lockedCards.set(userId, new Set());
  lockedCards.get(userId).add(cardId);
}

function unlockCard(userId, cardId) {
  const set = lockedCards.get(userId);
  if (set) {
    set.delete(cardId);
    if (set.size === 0) lockedCards.delete(userId);
  }
}

function isCardLocked(userId, cardId) {
  return lockedCards.has(userId) && lockedCards.get(userId).has(cardId);
}

// ---------- Active Duels (one duel per person) ----------

const activeDuelists = new Set();

function isInDuel(userId) { return activeDuelists.has(userId); }
function setInDuel(userId) { activeDuelists.add(userId); }
function clearDuel(userId) { activeDuelists.delete(userId); }

// ---------- Cooldowns ----------

function getCooldowns() {
  return readJSON(PATHS.cooldowns)?.claims ?? {};
}

function saveCooldowns(claims) {
  writeJSON(PATHS.cooldowns, { claims });
}

function canClaim(userId, cooldownMinutes) {
  const claims = getCooldowns();
  const lastClaim = claims[userId];
  if (!lastClaim) return { allowed: true, remainingMs: 0 };
  const elapsed = Date.now() - new Date(lastClaim).getTime();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  if (elapsed >= cooldownMs) return { allowed: true, remainingMs: 0 };
  return { allowed: false, remainingMs: cooldownMs - elapsed };
}

function recordClaim(userId) {
  const claims = getCooldowns();
  claims[userId] = new Date().toISOString();
  saveCooldowns(claims);
}

// ---------- Trades ----------

function getTrades() {
  return readJSON(PATHS.trades)?.pending ?? [];
}

function saveTrades(pending) {
  writeJSON(PATHS.trades, { pending });
}

function addTrade(trade) {
  const trades = getTrades();
  trades.push(trade);
  saveTrades(trades);
  return trade;
}

function findTradeById(tradeId) {
  return getTrades().find(t => t.id === tradeId) ?? null;
}

function removeTrade(tradeId) {
  let trades = getTrades();
  trades = trades.filter(t => t.id !== tradeId);
  saveTrades(trades);
}

function generateTradeId() {
  return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Leaderboard ----------

function getLeaderboard() {
  const users = getInventory();
  const cards = getCards();
  const { config } = require('./config');

  const rarityScores = {
    common: 1,
    uncommon: 2,
    rare: 5,
    epic: 10,
    legendary: 25,
  };

  const leaderboard = [];

  for (const [userId, userData] of Object.entries(users)) {
    let totalCards = 0;
    let uniqueCards = 0;
    let rarityScore = 0;

    for (const entry of userData.cards) {
      if (entry.quantity <= 0) continue;
      totalCards += entry.quantity;
      uniqueCards += 1;
      const card = cards.find(c => c.id === entry.cardId);
      if (card) {
        rarityScore += (rarityScores[card.rarity] ?? 1) * entry.quantity;
      }
    }

    if (totalCards > 0) {
      leaderboard.push({
        userId,
        username: userData.username,
        totalCards,
        uniqueCards,
        rarityScore,
      });
    }
  }

  leaderboard.sort((a, b) => b.rarityScore - a.rarityScore || b.totalCards - a.totalCards);
  return leaderboard;
}

// ---------- Weighted Random Card ----------

function getRandomCard() {
  const cards = getCards();
  if (cards.length === 0) return null;
  const { config } = require('./config');
  const weights = config.rarityWeights;

  const weighted = cards.map(card => ({
    card,
    weight: weights[card.rarity] ?? 1,
  }));

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const { card, weight } of weighted) {
    roll -= weight;
    if (roll <= 0) return card;
  }
  return weighted[weighted.length - 1].card;
}

function getRandomCards(count) {
  const cards = getCards();
  if (cards.length === 0) return [];
  const { config } = require('./config');
  const weights = config.rarityWeights;

  const results = [];
  const usedIds = new Set();

  for (let i = 0; i < count; i++) {
    // Prefer unique cards, but allow duplicates if pool is too small
    let pool = cards.filter(c => !usedIds.has(c.id));
    if (pool.length === 0) pool = cards;

    const weighted = pool.map(card => ({
      card,
      weight: weights[card.rarity] ?? 1,
    }));

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const { card, weight } of weighted) {
      roll -= weight;
      if (roll <= 0) {
        results.push(card);
        usedIds.add(card.id);
        break;
      }
    }

    // Fallback
    if (results.length <= i) {
      const fallback = weighted[weighted.length - 1].card;
      results.push(fallback);
      usedIds.add(fallback.id);
    }
  }

  return results;
}

// ---------- Export / Import ----------

function exportAll() {
  return {
    cards: readJSON(PATHS.cards),
    inventory: readJSON(PATHS.inventory),
    cooldowns: readJSON(PATHS.cooldowns),
    trades: readJSON(PATHS.trades),
  };
}

function importAll(data) {
  // Backup first
  const timestamp = Date.now();
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  for (const key of Object.keys(PATHS)) {
    const src = PATHS[key];
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, `${key}_${timestamp}.json`));
    }
  }

  // Import
  if (data.cards) writeJSON(PATHS.cards, data.cards);
  if (data.inventory) writeJSON(PATHS.inventory, data.inventory);
  if (data.cooldowns) writeJSON(PATHS.cooldowns, data.cooldowns);
  if (data.trades) writeJSON(PATHS.trades, data.trades);
}

module.exports = {
  getCards, saveCards, addCard, deleteCard, findCardById, findCardByName, generateCardId,
  getInventory, saveInventory, getUserInventory, addCardToUser, removeCardFromUser, userHasCard,
  transferCard, lockCard, unlockCard, isCardLocked,
  isInDuel, setInDuel, clearDuel,
  canClaim, recordClaim,
  getTrades, addTrade, findTradeById, removeTrade, generateTradeId,
  getLeaderboard, getRandomCard, getRandomCards,
  exportAll, importAll,
  PATHS,
};
