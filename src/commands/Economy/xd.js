// FILE MỚI → src/commands/Economy/xd.js
//
// Thay cho subcommand `/casino xocdia` cũ. Logic trò chơi giữ y hệt bản
// gốc, chỉ đổi cách hiển thị giống hệt /tx (xem ghi chú đầu file tx.js).

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
import { renderXocDiaFrame } from '../../utils/casinoRender.js';
import { getJackpot, addToJackpot, rollJackpotExplosion, getJackpotRakeAmount } from '../../utils/casinoJackpot.js';
import { sendPersonaFrame, editPersonaFrame } from '../../utils/personaWebhook.js';

const PERSONA_ACTION_KEY = 'xocdia_ketqua';

const CASINO_BET_COOLDOWN = 3 * 1000;
const MIN_BET = 10;
const MAX_BET = 1000000;
const SHAKE_FRAMES = 2;
const SHAKE_DELAY_MS = 600;
const XOCDIA_EXACT_MULTIPLIER = { 0: 8, 1: 3, 2: 2.5, 3: 3, 4: 8 };
const XOCDIA_PARITY_MULTIPLIER = 2;
const XOCDIA_REVEAL_DELAY_MS = 900;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function rollXocDia() {
    let redCount = 0;
    const coinsIsRed = [];
    for (let i = 0; i < 4; i++) {
        const isRed = Math.random() < 0.5;
        coinsIsRed.push(isRed);
        if (isRed) redCount++;
    }
    return { coinsIsRed, redCount };
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
        .setName('xd')
        .setDescription('Đặt cược Xóc Đĩa (4 đồng xu)')
        .addStringOption((option) =>
            option
                .setName('cuoc')
                .setDescription('Chọn cửa cược')
                .setRequired(true)
                .addChoices(
                    { name: 'Chẵn', value: 'chan' },
                    { name: 'Lẻ', value: 'le' },
                    { name: '0 Đỏ (x8)', value: '0' },
                    { name: '1 Đỏ (x3)', value: '1' },
                    { name: '2 Đỏ (x2.5)', value: '2' },
                    { name: '3 Đỏ (x3)', value: '3' },
                    { name: '4 Đỏ (x8)', value: '4' },
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
        const betChoice = interaction.options.getString('cuoc');
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
        let jackpotAmount = await addToJackpot(client, guildId, 'xocdia', rake);

        const isParityBet = betChoice === 'chan' || betChoice === 'le';
        const betLabel = isParityBet
            ? (betChoice === 'chan' ? 'Chẵn' : 'Lẻ')
            : `${betChoice} Đỏ`;

        // Đã kiểm tra hợp lệ xong -> ẩn tin nhắn "đang xử lý" tạm thời, mọi
        // thứ từ đây trở đi hiện bằng tin nhắn persona trong kênh.
        await InteractionHelper.safeDeleteReply(interaction);

        let handle = null;

        for (let i = 0; i < SHAKE_FRAMES; i++) {
            const frame = await renderXocDiaFrame({
                phase: 'shaking',
                revealedCoins: [null, null, null, null],
                statusText: 'Đang xóc đĩa...',
                jackpotAmount,
                betLabel,
                betAmount,
            });
            const payload = buildFramePayload(frame, 'xocdia.png');
            if (!handle) {
                handle = await sendPersonaFrame(client, interaction.channel, guildId, PERSONA_ACTION_KEY, payload);
            } else {
                await editPersonaFrame(handle, payload);
            }
            await sleep(SHAKE_DELAY_MS);
        }

        const result = rollXocDia();

        const partialReveal = [result.coinsIsRed[0], result.coinsIsRed[1], null, null];
        const partialFrame = await renderXocDiaFrame({
            phase: 'revealing',
            revealedCoins: partialReveal,
            statusText: 'Đang mở đĩa...',
            jackpotAmount,
            betLabel,
            betAmount,
        });
        await editPersonaFrame(handle, buildFramePayload(partialFrame, 'xocdia.png'));
        await sleep(XOCDIA_REVEAL_DELAY_MS);

        let won = false;
        let multiplier = 0;

        if (isParityBet) {
            const actualParity = result.redCount % 2 === 0 ? 'chan' : 'le';
            won = betChoice === actualParity;
            multiplier = XOCDIA_PARITY_MULTIPLIER;
        } else {
            const guessedCount = parseInt(betChoice, 10);
            won = guessedCount === result.redCount;
            multiplier = XOCDIA_EXACT_MULTIPLIER[result.redCount] ?? 2;
        }

        const grossPayout = won ? Math.floor(betAmount * multiplier) : 0;
        const grossProfit = won ? grossPayout - betAmount : 0;
        const taxAmount = won ? Math.floor(grossProfit * taxRate) : 0;
        const netPayout = won ? grossPayout - taxAmount : 0;
        const netWinnings = won ? netPayout - betAmount : 0;

        if (taxAmount > 0) {
            jackpotAmount = await addToJackpot(client, guildId, 'xocdia', taxAmount);
        }

        const explosion = await rollJackpotExplosion(client, guildId, 'xocdia');
        let jackpotWon = 0;
        if (explosion.hit) {
            jackpotWon = explosion.amount;
            jackpotAmount = 0;
        }

        const freshData = await getEconomyData(client, guildId, userId);
        freshData.wallet = Math.max(0, (freshData.wallet || 0) - betAmount + netPayout + jackpotWon);
        freshData.lastCasinoBet = now;
        await setEconomyData(client, guildId, userId, freshData);

        const finalFrame = await renderXocDiaFrame({
            phase: 'result',
            revealedCoins: result.coinsIsRed,
            jackpotAmount,
            betLabel,
            betAmount,
            resultInfo: { redCount: result.redCount, won, netWinnings },
            balanceText: `Số dư hiện tại: ${freshData.wallet.toLocaleString()} Bcoin`,
        });
        const finalOk = await editPersonaFrame(handle, buildFramePayload(finalFrame, 'xocdia.png'));

        if (!finalOk) {
            const resultText = won
                ? `🎉 Bạn thắng **${betLabel}**! Ra **${result.redCount} đỏ**. Nhận về **${formatCurrency(netWinnings)}** lời.`
                : `😢 Bạn thua **${betLabel}**. Ra **${result.redCount} đỏ**.`;
            await interaction.followUp({
                flags: MessageFlags.Ephemeral,
                content: `⚠️ Hình ảnh kết quả gặp trục trặc khi hiển thị, nhưng ván chơi đã được tính:\n${resultText}\nSố dư hiện tại: **${freshData.wallet.toLocaleString()} Bcoin**`,
            }).catch(() => {});
        }

        if (jackpotWon > 0) {
            await interaction.channel.send({
                content: `🎆🎆🎆 **JACKPOT NỔ!** ${interaction.user} vừa trúng **${formatCurrency(jackpotWon)}** từ quỹ Jackpot Xóc Đĩa! 🎆🎆🎆`,
            }).catch((error) => logger.warn('[CASINO] Không gửi được thông báo jackpot:', error.message));
        }

        logger.info('[CASINO] Xoc Dia round played', {
            userId, guildId, betChoice, betAmount, redCount: result.redCount, won, netPayout, taxRate, jackpotWon,
        });
    }, { command: 'xd' }),
};
