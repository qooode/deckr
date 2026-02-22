#!/bin/sh
set -e

echo ""
echo "╔══════════════════════════════════╗"
echo "║     🃏 DECKR — Starting...       ║"
echo "╚══════════════════════════════════╝"
echo ""

# Initialize data files if they don't exist (first run or empty volume)
for file in cards.json inventory.json cooldowns.json trades.json; do
  if [ ! -f "/app/data/$file" ]; then
    echo "📄 Initializing /app/data/$file"
    cp "/app/data-defaults/$file" "/app/data/$file"
  fi
done

echo "🔄 Deploying slash commands..."
node deploy-commands.js

echo "🚀 Starting Deckr bot..."
exec node bot.js
