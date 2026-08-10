import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    getEconomyData,
    setEconomyData,
    checkAndConsumeBetLimit,
    formatCurrency,
    formatCooldown
} from '../../utils/economy.js';

const CASINO_BET_COOLDOWN = 3 * 1000; // Riêng biệt với /gamble (lastGamble) để không đụng cooldown.
const TAI_XIU_RETURN_MULTIPLIER = 2;  // Thắng Tài/Xỉu: nhận lại gấp đôi (lãi = 1x).
const BAO_RETURN_MULTIPLIER = 4;      // Thắng Bão: nhận lại gấp 4 (lãi = 3x).
const MIN_BET = 10;
const MAX_BET = 1000000;

function rollOne() {
    return Math.floor(Math.random() * 6) + 1;
}

function evaluateResult() {
    const dice = [rollOne(), rollOne(), rollOne()];
    const [a, b, c] = dice;
    const isBao = a === b && b === c;
    const total = a + b + c;
    const outcome = isBao ? 'bao' : (total >= 11 ? 'tai' : 'xiu');
    return { dice, total, outcome };
}

async function handleTaiXiu(interaction, client) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const betType = interaction.options.getString('loai');
    const betAmount = interaction.options.getInteger('sotien');

    const userData = await getEconomyData(client, guildId, userId);
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

    if ((userData.wallet || 0) < betAmount) {
        throw createError(
            'Insufficient funds',
            ErrorTypes.VALIDATION,
            `Bạn chỉ có **${formatCurrency(userData.wallet || 0)}**, không đủ để cược **${formatCurrency(betAmount)}**.`,
            { userId, guildId, betAmount }
        );
    }

    // Kiểm tra + trừ hạn mức cược ngày TRƯỚC khi trừ tiền thật.
    await checkAndConsumeBetLimit(client, guildId, userId, betAmount);

    const result = evaluateResult();
    const won = result.outcome === betType;
    const multiplier = betType === 'bao' ? BAO_RETURN_MULTIPLIER : TAI_XIU_RETURN_MULTIPLIER;
    const payout = won ? betAmount * multiplier : 0;

    // Đọc lại dữ liệu mới nhất (checkAndConsumeBetLimit đã ghi DB) trước khi cập nhật ví.
    const freshData = await getEconomyData(client, guildId, userId);
    freshData.wallet = Math.max(0, (freshData.wallet || 0) - betAmount + payout);
    freshData.lastCasinoBet = now;
    await setEconomyData(client, guildId, userId, freshData);

    const diceDisplay = result.dice.map(d => `🎲${d}`).join(' ');
    const outcomeLabel = { tai: 'TÀI', xiu: 'XỈU', bao: 'BÃO' }[result.outcome];

    const embed = won
        ? successEmbed('🎉 Bạn thắng!', `${diceDisplay}\nTổng: **${result.total}** → **${outcomeLabel}**\n\nBạn nhận về **${formatCurrency(payout)}** (lãi ${formatCurrency(payout - betAmount)}).`)
        : errorEmbed('😢 Bạn thua!', `${diceDisplay}\nTổng: **${result.total}** → **${outcomeLabel}**\n\nBạn mất **${formatCurrency(betAmount)}**.`);

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

    logger.info('[CASINO] Tai Xiu round played', {
        userId, guildId, betType, betAmount, outcome: result.outcome, won, payout
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('casino')
        .setDescription('Các trò chơi cờ bạc trong casino')
        .addSubcommand(sub =>
            sub
                .setName('taixiu')
                .setDescription('Đặt cược Tài Xỉu (3 xúc xắc)')
                .addStringOption(option =>
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
                .addIntegerOption(option =>
                    option
                        .setName('sotien')
                        .setDescription('Số Bcoin muốn cược')
                        .setRequired(true)
                        .setMinValue(MIN_BET)
                        .setMaxValue(MAX_BET)
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'taixiu':
                await handleTaiXiu(interaction, client);
                break;
            default:
                throw createError(
                    'Unknown casino subcommand',
                    ErrorTypes.VALIDATION,
                    'Trò chơi này chưa được hỗ trợ.',
                    { subcommand }
                );
        }
    }, { command: 'casino' })
};
