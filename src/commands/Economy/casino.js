import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
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

const CASINO_BET_COOLDOWN = 3 * 1000;
const MIN_BET = 10;
const MAX_BET = 1000000;

const TAI_XIU_RETURN_MULTIPLIER = 2;
const BAO_RETURN_MULTIPLIER = 4;

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const COIN_FACES = ['🔴', '⚪'];
const ANIMATION_FRAMES = 4;
const ANIMATION_DELAY_MS = 500;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

const XOCDIA_EXACT_MULTIPLIER = { 0: 8, 1: 3, 2: 2.5, 3: 3, 4: 8 };
const XOCDIA_PARITY_MULTIPLIER = 2;

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

async function playRollingAnimation(interaction, { title, frameCount, betLabel, betAmount }) {
    for (let i = 0; i < ANIMATION_FRAMES; i++) {
        const randomFaces = Array.from({ length: frameCount }, () =>
            DICE_FACES[Math.floor(Math.random() * DICE_FACES.length)]
        ).join(' ');

        const embed = infoEmbed(
            title,
            `${randomFaces}\n\n${betLabel} • Cược ${formatCurrency(betAmount)}\n_Đang lắc..._`
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        await sleep(ANIMATION_DELAY_MS);
    }
}

async function handleTaiXiu(interaction, client) {
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

    await checkAndConsumeBetLimit(client, guildId, userId, betAmount);

    const betLabel = { tai: 'Tài', xiu: 'Xỉu', bao: 'Bão' }[betType];

    await playRollingAnimation(interaction, {
        title: '🎲 Tài Xỉu',
        frameCount: 3,
        betLabel,
        betAmount
    });

    const result = evaluateTaiXiu();
    const won = result.outcome === betType;
    const multiplier = betType === 'bao' ? BAO_RETURN_MULTIPLIER : TAI_XIU_RETURN_MULTIPLIER;
    const payout = won ? betAmount * multiplier : 0;

    const freshData = await getEconomyData(client, guildId, userId);
    freshData.wallet = Math.max(0, (freshData.wallet || 0) - betAmount + payout);
    freshData.lastCasinoBet = now;
    await setEconomyData(client, guildId, userId, freshData);

    const diceDisplay = result.dice.map(v => DICE_FACES[v - 1]).join(' ');
    const resultLabel = { tai: 'TÀI', xiu: 'XỈU', bao: 'BÃO' }[result.outcome];

    const embed = (won
        ? successEmbed('🎉 Bạn thắng!', `${diceDisplay}\nTổng: **${result.total}** → **${resultLabel}**\n\n${betLabel} • Cược ${formatCurrency(betAmount)} • Thắng +${formatCurrency(payout - betAmount)}`)
        : errorEmbed('😢 Bạn thua!', `${diceDisplay}\nTổng: **${result.total}** → **${resultLabel}**\n\n${betLabel} • Cược ${formatCurrency(betAmount)} • Thua -${formatCurrency(betAmount)}`)
    ).setFooter({ text: `Số dư hiện tại: ${formatCurrency(freshData.wallet)}` });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

    logger.info('[CASINO] Tai Xiu round played', {
        userId, guildId, betType, betAmount, outcome: result.outcome, won, payout
    });
}

async function handleXocDia(interaction, client) {
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

    await checkAndConsumeBetLimit(client, guildId, userId, betAmount);

    const isParityBet = betChoice === 'chan' || betChoice === 'le';
    const betLabel = isParityBet
        ? (betChoice === 'chan' ? 'Chẵn' : 'Lẻ')
        : `${betChoice} Đỏ`;

    for (let i = 0; i < ANIMATION_FRAMES; i++) {
        const randomFaces = Array.from({ length: 4 }, () =>
            COIN_FACES[Math.floor(Math.random() * COIN_FACES.length)]
        ).join(' ');

        const embed = infoEmbed(
            '🪙 Xóc Đĩa',
            `${randomFaces}\n\n${betLabel} • Cược ${formatCurrency(betAmount)}\n_Đang xóc đĩa..._`
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        await sleep(ANIMATION_DELAY_MS);
    }

    const result = rollXocDia();

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

    const payout = won ? Math.floor(betAmount * multiplier) : 0;

    const freshData = await getEconomyData(client, guildId, userId);
    freshData.wallet = Math.max(0, (freshData.wallet || 0) - betAmount + payout);
    freshData.lastCasinoBet = now;
    await setEconomyData(client, guildId, userId, freshData);

    const coinsDisplay = result.coinsIsRed.map(r => (r ? '🔴' : '⚪')).join(' ');
    const parityLabel = result.redCount % 2 === 0 ? 'CHẴN' : 'LẺ';

    const embed = (won
        ? successEmbed('🎉 Bạn thắng!', `${coinsDisplay}\n**${result.redCount} Đỏ** → **${parityLabel}**\n\n${betLabel} • Cược ${formatCurrency(betAmount)} • Thắng +${formatCurrency(payout - betAmount)}`)
        : errorEmbed('😢 Bạn thua!', `${coinsDisplay}\n**${result.redCount} Đỏ** → **${parityLabel}**\n\n${betLabel} • Cược ${formatCurrency(betAmount)} • Thua -${formatCurrency(betAmount)}`)
    ).setFooter({ text: `Số dư hiện tại: ${formatCurrency(freshData.wallet)}` });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

    logger.info('[CASINO] Xoc Dia round played', {
        userId, guildId, betChoice, betAmount, redCount: result.redCount, won, payout
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
        )
        .addSubcommand(sub =>
            sub
                .setName('xocdia')
                .setDescription('Đặt cược Xóc Đĩa (4 đồng xu)')
                .addStringOption(option =>
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
            case 'xocdia':
                await handleXocDia(interaction, client);
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
