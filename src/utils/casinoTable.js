import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from './embeds.js';
import { logger } from './logger.js';
import { InteractionHelper } from './interactionHelper.js';
import {
    getEconomyData,
    setEconomyData,
    addMoney,
    recordBetAndGetTaxRate,
    formatCurrency,
    withEconomyLock,
} from './economy.js';
import { getJackpot, addToJackpot, rollJackpotExplosion, getJackpotRakeAmount } from './casinoJackpot.js';
import { renderTaiXiuFrame } from './casinoRender.js';
import { getBotOwners } from '../config/bot.js';

export const MIN_BET = 10;
export const MAX_BET = 1000000;

const OPEN_DURATION_MS = 27 * 1000;
const TOTAL_DURATION_MS = 30 * 1000;
const SHAKE_FRAMES = 2;
const SHAKE_DELAY_MS = 600;
const DIE_REVEAL_DELAY_MS = 2000;
const TAI_XIU_RETURN_MULTIPLIER = 2;

const timers = new Map(); // channelId -> { mid, close, resolve }

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function rollOne() {
    return Math.floor(Math.random() * 6) + 1;
}

function evaluateTaiXiu() {
    const dice = [rollOne(), rollOne(), rollOne()];
    const total = dice[0] + dice[1] + dice[2];
    const outcome = total >= 11 ? 'tai' : 'xiu';
    return { dice, total, outcome };
}

function getTableKey(channelId) {
    return `casino_table:${channelId}`;
}

async function getTableRaw(client, channelId) {
    try {
        if (!client.db || typeof client.db.get !== 'function') return null;
        return await client.db.get(getTableKey(channelId), null);
    } catch (error) {
        logger.error('[CASINO_TABLE] getTableRaw error', error);
        return null;
    }
}

async function setTableRaw(client, channelId, table) {
    try {
        await client.db.set(getTableKey(channelId), table);
    } catch (error) {
        logger.error('[CASINO_TABLE] setTableRaw error', error);
    }
}

async function deleteTableRaw(client, channelId) {
    try {
        if (client.db && typeof client.db.delete === 'function') {
            await client.db.delete(getTableKey(channelId));
        }
    } catch (error) {
        logger.error('[CASINO_TABLE] deleteTableRaw error', error);
    }
}

export async function getActiveTable(client, channelId) {
    return await getTableRaw(client, channelId);
}

async function editMessageWithFrame(message, frame, filename, components = []) {
    try {
        const attachment = new AttachmentBuilder(frame, { name: filename });
        const embed = createEmbed({ color: 'primary' }).setImage(`attachment://${filename}`);
        await message.edit({ embeds: [embed], files: [attachment], components });
    } catch (error) {
        logger.error('[CASINO_TABLE] editMessageWithFrame failed', error);
    }
}

export async function placeBet(client, guildId, channelId, user, side, amount) {
    return await withEconomyLock(guildId, `table:${channelId}`, async () => {
        const table = await getTableRaw(client, channelId);
        if (!table || table.status !== 'open' || Date.now() >= table.closesAt) {
            return { ok: false, message: 'Bàn đã đóng cược, chờ ván sau nhé!' };
        }
        if (table.participants[user.id]) {
            return { ok: false, message: 'Bạn đã đặt cược trong ván này rồi!' };
        }

        const userData = await getEconomyData(client, guildId, user.id);
        if ((userData.wallet || 0) < amount) {
            return {
                ok: false,
                message: `Bạn chỉ có ${formatCurrency(userData.wallet || 0)}, không đủ để cược ${formatCurrency(amount)}.`
            };
        }

        let taxRate = 0;
        try {
            const betLimitResult = await recordBetAndGetTaxRate(client, guildId, user.id, amount);
            taxRate = betLimitResult.taxRate;
        } catch (error) {
            return { ok: false, message: error.userMessage || 'Không thể xử lý cược, thử lại sau.' };
        }

        const fresh = await getEconomyData(client, guildId, user.id);
        fresh.wallet = Math.max(0, (fresh.wallet || 0) - amount);
        await setEconomyData(client, guildId, user.id, fresh);

        const rake = getJackpotRakeAmount(amount);
        await addToJackpot(client, guildId, 'taixiu', rake);

        table.participants[user.id] = {
            username: user.username,
            side,
            amount,
            taxRate,
        };
        await setTableRaw(client, channelId, table);

        return { ok: true };
    });
}

function scheduleTimers(client, table) {
    const channelId = table.channelId;
    if (timers.has(channelId)) {
        const t = timers.get(channelId);
        clearTimeout(t.mid);
        clearTimeout(t.close);
        clearTimeout(t.resolve);
    }

    const midDelay = Math.max(0, table.openedAt + Math.floor(OPEN_DURATION_MS / 2) - Date.now());
    const closeDelay = Math.max(0, table.closesAt - Date.now());
    const resolveDelay = Math.max(0, table.resolvesAt - Date.now());

    const midTimer = setTimeout(
        () => refreshWaitingFrame(client, channelId).catch(err => logger.error('[CASINO_TABLE] mid refresh error', err)),
        midDelay
    );
    const closeTimer = setTimeout(
        () => closeBetting(client, channelId).catch(err => logger.error('[CASINO_TABLE] close error', err)),
        closeDelay
    );
    const resolveTimer = setTimeout(
        () => resolveTable(client, channelId).catch(err => logger.error('[CASINO_TABLE] resolve error', err)),
        resolveDelay
    );

    timers.set(channelId, { mid: midTimer, close: closeTimer, resolve: resolveTimer });
}

async function refreshWaitingFrame(client, channelId) {
    const table = await getTableRaw(client, channelId);
    if (!table || table.status !== 'open') return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(table.messageId).catch(() => null);
    if (!message) return;

    const secondsLeft = Math.max(0, Math.ceil((table.closesAt - Date.now()) / 1000));
    const jackpotAmount = await getJackpot(client, table.guildId, 'taixiu');
    const frame = await renderTaiXiuFrame({
        phase: 'waiting',
        jackpotAmount,
        participants: Object.values(table.participants),
        secondsLeft,
    });
    await editMessageWithFrame(message, frame, 'taixiu.png', message.components);
}

async function closeBetting(client, channelId) {
    const table = await getTableRaw(client, channelId);
    if (!table) return;
    table.status = 'closed';
    await setTableRaw(client, channelId, table);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(table.messageId).catch(() => null);
    if (!message) return;

    const jackpotAmount = await getJackpot(client, table.guildId, 'taixiu');
    const frame = await renderTaiXiuFrame({
        phase: 'waiting',
        statusText: 'Đã đóng cược! Chuẩn bị mở bát...',
        jackpotAmount,
        participants: Object.values(table.participants),
        secondsLeft: 0,
    });

    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`taixiu_bet:tai:${channelId}`).setLabel('TÀI').setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId(`taixiu_bet:xiu:${channelId}`).setLabel('XỈU').setStyle(ButtonStyle.Primary).setDisabled(true),
    );
    await editMessageWithFrame(message, frame, 'taixiu.png', [disabledRow]);
}

export async function resolveTable(client, channelId) {
    const table = await getTableRaw(client, channelId);
    if (!table || table.status === 'resolved') return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        await deleteTableRaw(client, channelId);
        return;
    }
    const message = await channel.messages.fetch(table.messageId).catch(() => null);

    const participantEntries = Object.entries(table.participants || {});

    for (let i = 0; i < SHAKE_FRAMES; i++) {
        const frame = await renderTaiXiuFrame({
            phase: 'shaking',
            revealedValues: [null, null, null],
            statusText: 'Đang lắc bát...',
            jackpotAmount: await getJackpot(client, table.guildId, 'taixiu'),
            participants: participantEntries.map(([, p]) => p),
        });
        if (message) await editMessageWithFrame(message, frame, 'taixiu.png');
        await sleep(SHAKE_DELAY_MS);
    }

    const result = evaluateTaiXiu();
    const revealOrder = shuffle([0, 1, 2]);
    const revealedValues = [null, null, null];
    for (const dieIndex of revealOrder) {
        revealedValues[dieIndex] = result.dice[dieIndex];
        const frame = await renderTaiXiuFrame({
            phase: 'revealing',
            revealedValues: [...revealedValues],
            statusText: 'Đang mở bát...',
            jackpotAmount: await getJackpot(client, table.guildId, 'taixiu'),
            participants: participantEntries.map(([, p]) => p),
        });
        if (message) await editMessageWithFrame(message, frame, 'taixiu.png');
        await sleep(DIE_REVEAL_DELAY_MS);
    }

    let jackpotAmount = await getJackpot(client, table.guildId, 'taixiu');
    const winners = [];
    const resultsList = [];

    for (const [userId, p] of participantEntries) {
        const won = p.side === result.outcome;
        const grossPayout = won ? p.amount * TAI_XIU_RETURN_MULTIPLIER : 0;
        const grossProfit = won ? grossPayout - p.amount : 0;
        const taxAmount = won ? Math.floor(grossProfit * (p.taxRate || 0)) : 0;
        const netPayout = won ? grossPayout - taxAmount : 0;
        const netWinnings = won ? netPayout - p.amount : -p.amount;

        if (netPayout > 0) {
            await addMoney(client, table.guildId, userId, netPayout, 'taixiu_table_win');
        }
        if (taxAmount > 0) {
            jackpotAmount = await addToJackpot(client, table.guildId, 'taixiu', taxAmount);
        }

        if (won) winners.push({ userId, ...p });
        resultsList.push({ userId, username: p.username, side: p.side, amount: p.amount, won, netWinnings });
    }

    const explosion = await rollJackpotExplosion(client, table.guildId, 'taixiu');
    const jackpotSplits = [];
    if (explosion.hit && winners.length > 0) {
        const totalWinningBet = winners.reduce((sum, w) => sum + w.amount, 0);
        for (const w of winners) {
            const share = totalWinningBet > 0 ? Math.floor(explosion.amount * (w.amount / totalWinningBet)) : 0;
            if (share > 0) {
                await addMoney(client, table.guildId, w.userId, share, 'taixiu_jackpot_split');
                jackpotSplits.push({ userId: w.userId, share });
            }
        }
        jackpotAmount = 0;
    }

    const finalFrame = await renderTaiXiuFrame({
        phase: 'result',
        revealedValues: result.dice,
        jackpotAmount,
        resultInfo: { total: result.total, outcome: result.outcome },
        participants: resultsList,
    });
    if (message) await editMessageWithFrame(message, finalFrame, 'taixiu.png');

    if (jackpotSplits.length > 0) {
        const lines = jackpotSplits.map(s => `<@${s.userId}> nhận **${s.share.toLocaleString()} Bcoin**`).join('\n');
        await channel.send({ content: `🎆🎆🎆 **JACKPOT NỔ!** Chia cho người thắng cược:\n${lines} 🎆🎆🎆` }).catch(() => {});
    }

    logger.info('[CASINO_TABLE] Round resolved', {
        channelId, outcome: result.outcome, participantCount: participantEntries.length, jackpotHit: explosion.hit
    });

    await deleteTableRaw(client, channelId);
    timers.delete(channelId);

    if (participantEntries.length > 0) {
        await openTable(client, channel);
    }
}

export async function openTable(client, channel, interaction = null) {
    const channelId = channel.id;
    const guildId = channel.guildId;

    const existing = await getTableRaw(client, channelId);
    if (existing && existing.status !== 'resolved') {
        return existing;
    }

    const now = Date.now();
    const closesAt = now + OPEN_DURATION_MS;
    const resolvesAt = now + TOTAL_DURATION_MS;

    const jackpotAmount = await getJackpot(client, guildId, 'taixiu');
    const frame = await renderTaiXiuFrame({
        phase: 'waiting',
        jackpotAmount,
        participants: [],
        secondsLeft: Math.ceil(OPEN_DURATION_MS / 1000),
    });

    const attachment = new AttachmentBuilder(frame, { name: 'taixiu.png' });
    const embed = createEmbed({ color: 'primary' }).setImage('attachment://taixiu.png');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`taixiu_bet:tai:${channelId}`).setLabel('TÀI').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`taixiu_bet:xiu:${channelId}`).setLabel('XỈU').setStyle(ButtonStyle.Primary),
    );

    let message;
    if (interaction) {
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], files: [attachment], components: [row] });
        message = await interaction.fetchReply();
    } else {
        message = await channel.send({ embeds: [embed], files: [attachment], components: [row] });
    }

    const table = {
        gameType: 'taixiu',
        guildId,
        channelId,
        messageId: message.id,
        status: 'open',
        openedAt: now,
        closesAt,
        resolvesAt,
        participants: {},
    };
    await setTableRaw(client, channelId, table);
    scheduleTimers(client, table);
    return table;
}

export async function recoverStaleTables(client) {
    try {
        if (!client.db || typeof client.db.list !== 'function') return;
        const keys = await client.db.list('casino_table:');
        if (!Array.isArray(keys) || keys.length === 0) return;

        const owners = getBotOwners();

        for (const key of keys) {
            const table = await client.db.get(key, null);
            if (!table || table.status === 'resolved') continue;

            const entries = Object.entries(table.participants || {});
            const lines = entries.length > 0
                ? entries.map(([userId, p]) => `<@${userId}> (${p.username}) — ${p.side === 'tai' ? 'Tài' : 'Xỉu'} — ${p.amount.toLocaleString()} Bcoin`).join('\n')
                : '(không có người tham gia)';

            const content = `⚠️ **Bàn Tài Xỉu bị gián đoạn do bot khởi động lại** (kênh <#${table.channelId}>)\nCần hoàn tiền thủ công cho:\n${lines}`;

            for (const ownerId of owners) {
                try {
                    const user = await client.users.fetch(ownerId);
                    await user.send(content);
                } catch (error) {
                    logger.error('[CASINO_TABLE] Không gửi được DM hồi phục cho owner', error);
                }
            }

            await client.db.delete(key).catch(() => {});
            logger.warn(`[CASINO_TABLE] Đã dọn bàn dở dang: ${key}`);
        }
    } catch (error) {
        logger.error('[CASINO_TABLE] recoverStaleTables error', error);
    }
}
