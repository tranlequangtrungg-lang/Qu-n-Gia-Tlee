// FILE MỚI → src/commands/Economy/tx.js
//
// Thay cho subcommand `/casino taixiu` cũ. Logic trò chơi giữ y hệt bản gốc
// (tỉ lệ trả thưởng, thuế, jackpot...), chỉ đổi cách HIỂN THỊ:
// - interaction chỉ dùng để defer (ẩn) rồi xoá đi ngay sau khi hợp lệ.
// - Toàn bộ hoạt ảnh (lắc bát -> mở bát -> kết quả) gửi bằng 1 tin nhắn
//   persona duy nhất trong kênh (đứng tên tính cách đang được gán cho hành
//   động "taixiu_ketqua" qua /tleeoi, hoặc tên gốc nếu chưa gán).
// - Nếu vì lý do gì đó khung kết quả cuối không hiện lên được, người chơi
//   vẫn được báo riêng (ephemeral) để không bị "mất tích" kết quả.

import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    getEconomyData,
    setEconomyData,
    recordBetAndGetTaxRate,
    formatCurrency,
    formatCooldown,
} from '../../utils/economy.js';
import { renderTaiXiuFrame } from '../../utils/casinoRender.js';
import { getJackpot, addToJackpot, rollJackpotExplosion, getJackpotRakeAmount } from '../../utils/casinoJackpot.js';
import { sendPersonaFrame, editPersonaFrame } from '../../utils/personaWebhook.js';

const PERSONA_ACTION_KEY = 'taixiu_ketqua';

const CASINO_BET_COOLDOWN = 3 * 1000;
const MIN_BET = 10;
const MAX_BET = 1000000;
const TAI_XIU_RETURN_MULTIPLIER = 2;
const BAO_RETURN_MULTIPLIER = 4;
const DIE_REVEAL_DELAY_MS = 2000;
const SHAKE_FRAMES = 2;
const SHAKE_DELAY_MS = 600;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const [a, b, c] = dice;
    const isBao = a === b && b === c;
    const total = a + b + c;
    const outcome = isBao ? 'bao' : (total >= 11 ? 'tai' : 'xiu');
    return { dice, total, outcome };
}

async function checkCasinoCooldown(userData, userId, guildId) {
    const now = Date.now();
    const lastBet = userData.lastCasinoBet || 0;
    if (now < lastBet + CASINO_BET_COOLDOWN) {
        const remaining = lastBet + CASINO_BET_COOLDOWN - now;
        throw createError(
            'Casino cooldown active',
            ErrorTypes.RATE_LIMIT,
            `Bạn thao tác quá nhanh, thử lại sau **${formatCooldown(remaining)}**.`,
            { userId, guildId, cooldownType: 'casino_bet' }
        );
    }
    return now;
}

function buildFramePayload(imageBuffer, filename) {
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
    const embed = createEmbed({ color: 'primary' }).setImage(`attachment://${filename}`);
    return { embeds: [embed], files: [attachment] };
}

export default {
    data: new SlashCommandBuilder()
        .setName('tx')
        .setDescription('Đặt cược Tài Xỉu (3 xúc xắc)')
        .addStringOption((option) =>
            option
                .setName('loai')
                .setDescription('Chọn cửa cược')
                .setRequired(true)
                .addChoices(
                    { name: 'Tài (11-17)', value: 'tai' },
                    { name: 'Xỉu (4-10)', value: 'xiu' },
                    { name: 'Bão (3 xúc xắc cùng mặt)', value: 'bao' },
                )
        )
        .addIntegerOption((option) =>
            option
                .setName('sotien')
                .setDescription('Số Bcoin muốn cược')
                .setRequired(true)
                .setMinValue(MIN_BET)
                .setMaxValue(MAX_BET)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const betType = interaction.options.getString('loai');
        const betAmount = interaction.options.getInteger('sotien');

        const userData = await getEconomyData(client, guildId, userId);
        const now = await checkCasinoCooldown(userData, userId, guildId);

        if ((userData.wallet || 0) < betAmount) {
            throw createError(
                'Insufficient funds',
                ErrorTypes.VALIDATION,
                `Bạn chỉ có **${formatCurrency(userData.wallet || 0)}**, không đủ để cược **${formatCurrency(betAmount)}**.`,
                { userId, guildId, betAmount }
            );
        }

        const { taxRate } = await recordBetAndGetTaxRate(client, guildId, userId, betAmount);

        const rake = getJackpotRakeAmount(betAmount);
        let jackpotAmount = await addToJackpot(client, guildId, 'taixiu', rake);

        const betLabel = { tai: 'Tài', xiu: 'Xỉu', bao: 'Bão' }[betType];

        // Đã kiểm tra hợp lệ xong -> ẩn tin nhắn "đang xử lý" tạm thời, mọi
        // thứ từ đây trở đi hiện bằng tin nhắn persona trong kênh.
        await InteractionHelper.safeDeleteReply(interaction);

        let handle = null;

        for (let i = 0; i < SHAKE_FRAMES; i++) {
            const frame = await renderTaiXiuFrame({
                phase: 'shaking',
                revealedValues: [null, null, null],
                statusText: 'Đang lắc bát...',
                jackpotAmount,
                betLabel,
                betAmount,
            });
            const payload = buildFramePayload(frame, 'taixiu.png');
            if (!handle) {
                handle = await sendPersonaFrame(client, interaction.channel, guildId, PERSONA_ACTION_KEY, payload);
            } else {
                await editPersonaFrame(handle, payload);
            }
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
                jackpotAmount,
                betLabel,
                betAmount,
            });
            await editPersonaFrame(handle, buildFramePayload(frame, 'taixiu.png'));
            await sleep(DIE_REVEAL_DELAY_MS);
        }

        const won = result.outcome === betType;
        const multiplier = betType === 'bao' ? BAO_RETURN_MULTIPLIER : TAI_XIU_RETURN_MULTIPLIER;
        const grossPayout = won ? betAmount * multiplier : 0;
        const grossProfit = won ? grossPayout - betAmount : 0;
        const taxAmount = won ? Math.floor(grossProfit * taxRate) : 0;
        const netPayout = won ? grossPayout - taxAmount : 0;
        const netWinnings = won ? netPayout - betAmount : 0;

        if (taxAmount > 0) {
            jackpotAmount = await addToJackpot(client, guildId, 'taixiu', taxAmount);
        }

        const explosion = await rollJackpotExplosion(client, guildId, 'taixiu');
        let jackpotWon = 0;
        if (explosion.hit) {
            jackpotWon = explosion.amount;
            jackpotAmount = 0;
        }

        const freshData = await getEconomyData(client, guildId, userId);
        freshData.wallet = Math.max(0, (freshData.wallet || 0) - betAmount + netPayout + jackpotWon);
        freshData.lastCasinoBet = now;
        await setEconomyData(client, guildId, userId, freshData);

        const finalFrame = await renderTaiXiuFrame({
            phase: 'result',
            revealedValues: result.dice,
            jackpotAmount,
            betLabel,
            betAmount,
            resultInfo: { total: result.total, outcome: result.outcome, won, netWinnings },
            balanceText: `Số dư hiện tại: ${freshData.wallet.toLocaleString()} Bcoin`,
        });
        const finalOk = await editPersonaFrame(handle, buildFramePayload(finalFrame, 'taixiu.png'));

        // Lưới an toàn: nếu vì lý do gì đó hoạt ảnh kết quả không hiện lên
        // được, vẫn báo riêng (chỉ người chơi thấy) để không ai "mất tích"
        // kết quả cược của mình.
        if (!finalOk) {
            const resultText = won
                ? `🎉 Bạn thắng **${betLabel}**! Kết quả: **${result.dice.join(' - ')}** (tổng ${result.total}). Nhận về **${formatCurrency(netWinnings)}** lời.`
                : `😢 Bạn thua **${betLabel}**. Kết quả: **${result.dice.join(' - ')}** (tổng ${result.total}).`;
            await interaction.followUp({
                flags: MessageFlags.Ephemeral,
                content: `⚠️ Hình ảnh kết quả gặp trục trặc khi hiển thị, nhưng ván chơi đã được tính:\n${resultText}\nSố dư hiện tại: **${freshData.wallet.toLocaleString()} Bcoin**`,
            }).catch(() => {});
        }

        if (jackpotWon > 0) {
            await interaction.channel.send({
                content: `🎆🎆🎆 **JACKPOT NỔ!** ${interaction.user} vừa trúng **${formatCurrency(jackpotWon)}** từ quỹ Jackpot Tài Xỉu! 🎆🎆🎆`,
            }).catch((error) => logger.warn('[CASINO] Không gửi được thông báo jackpot:', error.message));
        }

        logger.info('[CASINO] Tai Xiu round played', {
            userId, guildId, betType, betAmount, outcome: result.outcome, won, netPayout, taxRate, jackpotWon,
        });
    }, { command: 'tx' }),
};
