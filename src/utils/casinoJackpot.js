import { logger } from './logger.js';
import { withEconomyLock } from './economy.js';

const JACKPOT_EXPLODE_CHANCE = 0.001; // 0.1%
const JACKPOT_RAKE_PERCENT = 0.05; // 5% mỗi vé cược

function getJackpotKey(guildId, game) {
    return `guild:${guildId}:casino_jackpot:${game}`;
}

export async function getJackpot(client, guildId, game) {
    try {
        if (!client.db || typeof client.db.get !== 'function') return 0;
        const key = getJackpotKey(guildId, game);
        const value = await client.db.get(key, 0);
        return typeof value === 'number' && value >= 0 ? value : 0;
    } catch (error) {
        logger.error(`Error getting jackpot for ${game}`, error);
        return 0;
    }
}

async function setJackpot(client, guildId, game, value) {
    try {
        if (!client.db || typeof client.db.set !== 'function') return false;
        const key = getJackpotKey(guildId, game);
        await client.db.set(key, Math.max(0, Math.floor(value)));
        return true;
    } catch (error) {
        logger.error(`Error setting jackpot for ${game}`, error);
        return false;
    }
}

// Cộng tiền vào jackpot (rake từ tiền cược, hoặc thuế giữ lại).
export async function addToJackpot(client, guildId, game, amount) {
    if (!amount || amount <= 0) return await getJackpot(client, guildId, game);
    return await withEconomyLock(guildId, `jackpot:${game}`, async () => {
        const current = await getJackpot(client, guildId, game);
        const next = current + Math.floor(amount);
        await setJackpot(client, guildId, game, next);
        return next;
    });
}

// Quay số nổ jackpot. Trúng thì trả hết quỹ và reset về 0.
export async function rollJackpotExplosion(client, guildId, game) {
    const hit = Math.random() < JACKPOT_EXPLODE_CHANCE;
    if (!hit) return { hit: false, amount: 0 };

    return await withEconomyLock(guildId, `jackpot:${game}`, async () => {
        const pot = await getJackpot(client, guildId, game);
        await setJackpot(client, guildId, game, 0);
        return { hit: true, amount: pot };
    });
}

export function getJackpotRakeAmount(betAmount) {
    return Math.floor(betAmount * JACKPOT_RAKE_PERCENT);
}
