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
const MESSAGE_EDIT_TIMEOUT_MS = 6000;

const timers = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} quá ${ms}ms`)), ms))
    ]);
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

// Sửa tin nhắn có giới hạn thời gian chờ — treo/lỗi mạng thì bỏ qua (chỉ ghi log), KHÔNG chặn phần trả tiền phía sau.
async function editMessageWithFrame(message, frame, filename, embedDescription, components = []) {
    try {
        const attachment = new AttachmentBuilder(frame, { name: filename });
        const embed = createEmbed({ color: 'primary', description: embedDescription }).setImage(`attachment://${filename}`);
        await withTimeout(
            message.edit({ embeds: [embed], files: [attachment], components }),
            MESSAGE_EDIT_TIMEOUT_MS,
            'message.edit'
        );
    } catch (error) {
        logger.error('[CASINO_TABLE] editMessageWithFrame failed/timeout — bỏ qua, không chặn tiếp theo', { error: error.message });
    }
}

export async function placeBet(client, guildId, channelId, user, side, amount) {
    const result = await withEconomyLock(guildId, `table:${channelId}`, async () => {
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
            avatarURL: user.displayAvatarURL({ extension: 'png', size: 64 }),
            side,
            amount,
            taxRate,
        };
        await setTableRaw(client, channelId, table);

        return { ok: true, table };
    });

    // Vẽ lại ảnh ngay khi có người mới cược — không đợi mốc thời gian cố định nữa.
    if (result.ok) {
        refreshWaitingFrame(client, channelId).catch(err => logger.error('[CASINO_TABLE] refresh on join error', err));
    }

    return result;
}

function scheduleTimers(client, table) {
    const channelId = table.channelId;
    if (timers.has(channelId)) {
        const t = timers.get(channelId);
        clearTimeout(t.close);
        clearTimeout(t.resolve);
    }

    const closeDelay = Math.max(0, table.closesAt - Date.now());
    const resolveDelay = Math.max(0, table.resolvesAt - Date.now());

    const closeTimer = setTimeout(
        () => closeBetting(client, channelId).catch(err => logger.error('[CASINO_TABLE] close error', err)),
        closeDelay
    );
    const resolveTimer = setTimeout(
        () => resolveTable(client, channelId).catch(err => logger.error('[CASINO_TABLE] resolve error', err)),
        resolveDelay
    );

    timers.set(channelId, { close: closeTimer, resolve: resolveTimer });
}

async function refreshWaitingFrame(client, channelId) {
    const table = await getTableRaw(client, channelId);
    if (!table || table.status !== 'open') return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(table.messageId).catch(() => null);
    if (!message) return;

    const jackpotAmount = await getJackpot(client, table.guildId, 'taixiu');
    const closesAtUnix = Math.floor(table.closesAt / 1000);
    const frame = await renderTaiXiuFrame({
        phase: 'waiting',
        jackpotAmount,
        participants: Object.values(table.participants),
    });
    await editMessageWithFrame(
        message, frame, 'taixiu.png',
        `⏳ Đóng cược <t:${closesAtUnix}:R>`,
        message.components
    );
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
    });

    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`taixiu_bet:tai:${channelId}`).setLabel('TÀI').setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId(`taixiu_bet:xiu:${channelId}`).setLabel('XỈU').setStyle(ButtonStyle.Primary).setDisabled(true),
    );
    await editMessageWithFrame(message, frame, 'taixiu.png', '🔒 Đã đóng cược', [disabledRow]);
}

export async function resolveTable(client, channelId) {
    const table = await getTableRaw(client, channelId);
    if (!table) return;

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
        if (message) await editMessageWithFrame(message, frame, 'taixiu.png', '🎲 Đang lắc bát...');
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
        if (message) await editMessageWithFrame(message, frame, 'taixiu.png', '🥣 Đang mở bát...');
        await sleep(DIE_REVEAL_DELAY_MS);
    }

    // ===== Trả tiền — KHÔNG bọc timeout, luôn phải chạy xong dù chậm =====
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
        resultsList.push({ userId, username: p.username, avatarURL: p.avatarURL, side: p.side, amount: p.amount, won, netWinnings });
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
    // ===== Hết phần trả tiền =====

    const finalFrame = await renderTaiXiuFrame({
        phase: 'result',
        revealedValues: result.dice,
        jackpotAmount,
        resultInfo: { total: result.total, outcome: result.outcome },
        participants: resultsList,
    });
    if (message) await editMessageWithFrame(message, finalFrame, 'taixiu.png', '✅ Đã trả kết quả');

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
    if (existing) {
        return existing;
    }

    const now = Date.now();
    const closesAt = now + OPEN_DURATION_MS;
    const resolvesAt = now + TOTAL_DURATION_MS;
    const closesAtUnix = Math.floor(closesAt / 1000);

    const jackpotAmount = await getJackpot(client, guildId, 'taixiu');
    const frame = await renderTaiXiuFrame({
        phase: 'waiting',
        jackpotAmount,
        participants: [],
    });

    const attachment = new AttachmentBuilder(frame, { name: 'taixiu.png' });
    const embed = createEmbed({ color: 'primary', description: `⏳ Đóng cược <t:${closesAtUnix}:R>` }).setImage('attachment://taixiu.png');
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
            if (!table) continue;
            const channelId = table.channelId;
            const entries = Object.entries(table.participants || {});

            if (table.status === 'closed') {
                logger.warn(`[CASINO_TABLE] Bàn đã đóng cược dở dang, tự động mở bát: ${key}`);
                await resolveTable(client, channelId);
                continue;
            }

            for (const [userId, p] of entries) {
                try {
                    await addMoney(client, table.guildId, userId, p.amount, 'taixiu_table_refund');
                } catch (error) {
                    logger.error(`[CASINO_TABLE] Hoàn tiền thất bại cho ${userId}`, error);
                }
            }

            const lines = entries.length > 0
                ? entries.map(([userId, p]) => `<@${userId}> (${p.username}) — hoàn ${p.amount.toLocaleString()} Bcoin`).join('\n')
                : '(không có người tham gia)';
            const content = `♻️ **Bàn Tài Xỉu bị gián đoạn lúc đang mở cược** (kênh <#${channelId}>)\nĐã tự động hoàn tiền cho:\n${lines}`;

            for (const ownerId of owners) {
                try {
                    const user = await client.users.fetch(ownerId);
                    await user.send(content);
                } catch (error) {
                    logger.error('[CASINO_TABLE] Không gửi được DM hồi phục cho owner', error);
                }
            }

            await deleteTableRaw(client, channelId);
            logger.warn(`[CASINO_TABLE] Đã hoàn tiền và dọn bàn dở dang: ${key}`);
        }
    } catch (error) {
        logger.error('[CASINO_TABLE] recoverStaleTables error', error);
    }
}
