import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData, withEconomyLock, recordBetAndGetTaxRate } from '../utils/economy.js';
import EconomyService from './economyService.js';

// ===== Cấu trúc dữ liệu =====
// match:<guildId>:<matchId>  -> { id, teamA, teamB, tournament, flagA, flagB,
//   matchTime, previousResult, status, oddsThang: { a, hoa, b }, oddsTiSo,
//   createdAt, resolvedAt, realScoreA, realScoreB }
// bet:<guildId>:<matchId>:<userId> -> { type: 'thang'|'tiso', pick, amount,
//   tax, placedAt, payout: null|number, resolved: boolean }

function matchKey(guildId, matchId) {
    return `match:${guildId}:${matchId}`;
}

function betKey(guildId, matchId, userId) {
    return `bet:${guildId}:${matchId}:${userId}`;
}

function matchListPrefix(guildId) {
    return `match:${guildId}:`;
}

function betListPrefix(guildId, matchId) {
    return `bet:${guildId}:${matchId}:`;
}

async function listKeys(client, prefix) {
    if (!client.db?.list) return [];
    let keys = await client.db.list(prefix).catch(() => []);
    if (!Array.isArray(keys)) {
        keys = typeof keys === 'object' && keys !== null ? Object.keys(keys) : [];
    }
    return keys.filter((k) => k.startsWith(prefix));
}

export async function createMatch(client, guildId, {
    teamA, teamB, tournament, flagA, flagB, matchTime, previousResult, oddsThang, oddsTiSo,
}) {
    const matchId = Date.now().toString(36);
    const match = {
        id: matchId,
        teamA,
        teamB,
        tournament,
        flagA: flagA || '🏳️',
        flagB: flagB || '🏳️',
        matchTime: matchTime || null,
        previousResult: previousResult || null,
        status: 'open',
        oddsThang, // { a: number, hoa: number, b: number }
        oddsTiSo, // number
        createdAt: Date.now(),
        resolvedAt: null,
        realScoreA: null,
        realScoreB: null,
    };
    await client.db.set(matchKey(guildId, matchId), match);
    return match;
}

export async function getMatch(client, guildId, matchId) {
    return await client.db.get(matchKey(guildId, matchId)).catch(() => null);
}

export async function listOpenMatches(client, guildId) {
    const keys = await listKeys(client, matchListPrefix(guildId));
    const matches = [];
    for (const key of keys) {
        const data = await client.db.get(key).catch(() => null);
        if (data && data.status === 'open') matches.push(data);
    }
    return matches.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Trận đang mở gần nhất — dùng cho /bongda khi không cần chọn giữa nhiều
 * trận. Nếu server có nhiều trận mở cùng lúc, chỉ trận mới tạo gần nhất
 * hiện lên bảng; các trận cũ hơn vẫn có thể cược qua /catcuoc-tran với mã.
 */
export async function getLatestOpenMatch(client, guildId) {
    const matches = await listOpenMatches(client, guildId);
    return matches.length > 0 ? matches[matches.length - 1] : null;
}

export async function getUserBet(client, guildId, matchId, userId) {
    return await client.db.get(betKey(guildId, matchId, userId)).catch(() => null);
}

/**
 * Đặt cược. Trừ Bcoin ngay lập tức (escrow) — nếu thua, tiền không hoàn
 * lại; nếu thắng, tiền gốc + lãi được cộng lại khi chốt trận. Mỗi user chỉ
 * đặt được 1 lần / 1 trận (không sửa/huỷ sau khi đặt) để tránh phức tạp
 * hoàn tiền khi đổi cược.
 */
export async function placeBet(client, guildId, userId, matchId, type, pick, amount) {
    const match = await getMatch(client, guildId, matchId);
    if (!match || match.status !== 'open') {
        return { ok: false, reason: 'match_closed' };
    }

    const existingCheck = await getUserBet(client, guildId, matchId, userId);
    if (existingCheck) {
        return { ok: false, reason: 'already_bet' };
    }

    // Gọi TRƯỚC, ngoài withEconomyLock bên dưới — recordBetAndGetTaxRate tự
    // khoá/nhả economy lock của riêng nó cho cùng user này. Gọi lồng bên
    // trong 1 lớp khoá khác của cùng user sẽ tự khoá chết (deadlock): lớp
    // khoá ngoài chờ lớp trong nhả, lớp trong lại chờ lớp ngoài nhả trước.
    const { taxRate } = await recordBetAndGetTaxRate(client, guildId, userId, amount);
    const tax = Math.floor(amount * taxRate);
    const totalCharge = amount + tax;

    return await withEconomyLock(guildId, userId, async () => {
        // Kiểm tra lại 1 lần nữa trong khoá — phòng trường hợp có request
        // khác chen vào giữa lúc chờ recordBetAndGetTaxRate ở trên.
        const existing = await getUserBet(client, guildId, matchId, userId);
        if (existing) {
            return { ok: false, reason: 'already_bet' };
        }

        const userData = await getEconomyData(client, guildId, userId);
        if ((userData.wallet || 0) < totalCharge) {
            return { ok: false, reason: 'insufficient_funds_with_tax', available: userData.wallet || 0, totalCharge };
        }

        userData.wallet -= totalCharge;
        await setEconomyData(client, guildId, userId, userData);

        const bet = { type, pick, amount, tax, placedAt: Date.now(), payout: null, resolved: false };
        await client.db.set(betKey(guildId, matchId, userId), bet);

        return { ok: true, bet, tax };
    });
}

function determineOutcome(realScoreA, realScoreB) {
    if (realScoreA > realScoreB) return 'a';
    if (realScoreA < realScoreB) return 'b';
    return 'hoa';
}

/**
 * Đóng cược thủ công — admin chủ động gọi trước giờ đá để tránh bị "ăn
 * chặn" khi đã biết diễn biến trận. Khác resolveMatch: không cần tỉ số
 * thật, chỉ chặn cược mới; chốt thưởng vẫn làm riêng sau qua resolveMatch.
 */
export async function closeBetting(client, guildId, matchId) {
    const match = await getMatch(client, guildId, matchId);
    if (!match) return { ok: false, reason: 'not_found' };
    if (match.status !== 'open') return { ok: false, reason: 'not_open' };
    match.status = 'closed';
    await client.db.set(matchKey(guildId, matchId), match);
    return { ok: true, match };
}

/**
 * Chốt trận: nhập tỉ số thật, tính thắng-thua cho từng cược đã đặt, cộng
 * tiền thắng cược qua EconomyService.addMoney (giữ đồng bộ với hệ thống
 * vinh danh — cộng tiền tự động kiểm tra mốc Tài Sản mới như mọi giao dịch
 * khác). An toàn để gọi 1 lần; gọi lại lần 2 sẽ báo trận đã chốt, không xử
 * lý lại (tránh cộng tiền trùng).
 */
export async function resolveMatch(client, guildId, matchId, realScoreA, realScoreB) {
    const match = await getMatch(client, guildId, matchId);
    if (!match) return { ok: false, reason: 'not_found' };
    if (match.status === 'resolved') return { ok: false, reason: 'already_resolved' };

    const outcome = determineOutcome(realScoreA, realScoreB);
    const betKeys = await listKeys(client, betListPrefix(guildId, matchId));

    const results = [];
    for (const key of betKeys) {
        const userId = key.slice(betListPrefix(guildId, matchId).length);
        const bet = await client.db.get(key).catch(() => null);
        if (!bet || bet.resolved) continue;

        let won = false;
        let multiplier = 0;

        if (bet.type === 'thang') {
            won = bet.pick === outcome;
            multiplier = match.oddsThang[outcome] || 0;
        } else if (bet.type === 'tiso') {
            won = bet.pick.a === realScoreA && bet.pick.b === realScoreB;
            multiplier = match.oddsTiSo;
        }

        let payout = 0;
        if (won) {
            payout = Math.floor(bet.amount * multiplier);
            try {
                await EconomyService.addMoney(client, guildId, userId, payout, 'match_betting');
            } catch (error) {
                logger.error(`[MATCH_BET] Không cộng được tiền thắng cho ${userId}:`, error.message);
                payout = 0;
                won = false;
            }
        }

        bet.resolved = true;
        bet.payout = payout;
        await client.db.set(key, bet);

        results.push({ userId, won, payout, type: bet.type, pick: bet.pick, amount: bet.amount });
    }

    match.status = 'resolved';
    match.resolvedAt = Date.now();
    match.realScoreA = realScoreA;
    match.realScoreB = realScoreB;
    await client.db.set(matchKey(guildId, matchId), match);

    return { ok: true, match, outcome, results };
}
