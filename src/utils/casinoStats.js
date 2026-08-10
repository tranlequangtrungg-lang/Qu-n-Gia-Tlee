import { logger } from './logger.js';

const HISTORY_LIMIT = 20;

function getHistoryKey(guildId, game) {
    return `casino_history:${guildId}:${game}`;
}

export async function getCasinoHistory(client, guildId, game) {
    try {
        if (!client.db || typeof client.db.get !== 'function') return [];
        const key = getHistoryKey(guildId, game);
        const data = await client.db.get(key, []);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logger.error(`Error getting casino history for ${game}`, error);
        return [];
    }
}

export async function recordCasinoResult(client, guildId, game, entry) {
    try {
        if (!client.db || typeof client.db.set !== 'function') return [];
        const key = getHistoryKey(guildId, game);
        const existing = await getCasinoHistory(client, guildId, game);
        const updated = [...existing, entry].slice(-HISTORY_LIMIT);
        await client.db.set(key, updated);
        return updated;
    } catch (error) {
        logger.error(`Error recording casino history for ${game}`, error);
        return [];
    }
}
