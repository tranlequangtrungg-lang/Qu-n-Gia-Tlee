import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getActiveTable, openTable } from '../../utils/casinoTable.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    getEconomyData,
    setEconomyData,
    recordBetAndGetTaxRate,
    formatCurrency,
    formatCooldown
} from '../../utils/economy.js';
import { renderTaiXiuFrame, renderXocDiaFrame, renderJackpotCard } from '../../utils/casinoRender.js';
import { getJackpot, addToJackpot, rollJackpotExplosion, getJackpotRakeAmount } from '../../utils/casinoJackpot.js';

const CASINO_BET_COOLDOWN = 3 * 1000;
const MIN_BET = 10;
const MAX_BET = 1000000;

const TAI_XIU_RETURN_MULTIPLIER = 2;
const BAO_RETURN_MULTIPLIER = 4;
const DIE_REVEAL_DELAY_MS = 2000;
const SHAKE_FRAMES = 2;
const SHAKE_DELAY_MS = 600;

const XOCDIA_EXACT_MULTIPLIER = { 0: 8, 1: 3, 2: 2.5, 3: 3, 4: 8 };
const XOCDIA_PARITY_MULTIPLIER = 2;
const XOCDIA_REVEAL_DELAY_MS = 900;

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
    const [a, b, c] = dice;
    const isBao = a === b && b === c;
    const total = a + b + c;
    const outcome = isBao ? 'bao' : (total >= 11 ? 'tai' : 'xiu');
    return { dice, total, outcome };
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

async function sendFrame(interaction, imageBuffer, filename) {
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
    const embed = createEmbed({ color: 'primary' }).setImage(`attachment://${filename}`);
    await InteractionHelper.safeEditReply(interaction, { embeds: [embed], files: [attachment] });
}

// ===================== TÀI XỈU =====================
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

    const { taxRate } = await recordBetAndGetTaxRate(client, guildId, userId, betAmount);

    const rake = getJackpotRakeAmount(betAmount);
    let jackpotAmount = await addToJackpot(client, guildId, 'taixiu', rake);

    const betLabel = { tai: 'Tài', xiu: 'Xỉu', bao: 'Bão' }[betType];

    for (let i = 0; i < SHAKE_FRAMES; i++) {
        const frame = await renderTaiXiuFrame({
            phase: 'shaking',
            revealedValues: [null, null, null],
            statusText: 'Đang lắc bát...',
            jackpotAmount,
            betLabel,
            betAmount,
        });
        await sendFrame(interaction, frame, 'taixiu.png');
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
        await sendFrame(interaction, frame, 'taixiu.png');
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
    await sendFrame(interaction, finalFrame, 'taixiu.png');

    if (jackpotWon > 0) {
        await interaction.followUp({
            content: `🎆🎆🎆 **JACKPOT NỔ!** ${interaction.user} vừa trúng **${formatCurrency(jackpotWon)}** từ quỹ Jackpot Tài Xỉu! 🎆🎆🎆`,
        });
    }

    logger.info('[CASINO] Tai Xiu round played', {
        userId, guildId, betType, betAmount, outcome: result.outcome, won, netPayout, taxRate, jackpotWon
    });
}

// ===================== XÓC ĐĨA =====================
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

    const { taxRate } = await recordBetAndGetTaxRate(client, guildId, userId, betAmount);

    const rake = getJackpotRakeAmount(betAmount);
    let jackpotAmount = await addToJackpot(client, guildId, 'xocdia', rake);

    const isParityBet = betChoice === 'chan' || betChoice === 'le';
    const betLabel = isParityBet
        ? (betChoice === 'chan' ? 'Chẵn' : 'Lẻ')
        : `${betChoice} Đỏ`;

    for (let i = 0; i < SHAKE_FRAMES; i++) {
        const frame = await renderXocDiaFrame({
            phase: 'shaking',
            revealedCoins: [null, null, null, null],
            statusText: 'Đang xóc đĩa...',
            jackpotAmount,
            betLabel,
            betAmount,
        });
        await sendFrame(interaction, frame, 'xocdia.png');
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
    await sendFrame(interaction, partialFrame, 'xocdia.png');
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
    await sendFrame(interaction, finalFrame, 'xocdia.png');

    if (jackpotWon > 0) {
        await interaction.followUp({
            content: `🎆🎆🎆 **JACKPOT NỔ!** ${interaction.user} vừa trúng **${formatCurrency(jackpotWon)}** từ quỹ Jackpot Xóc Đĩa! 🎆🎆🎆`,
        });
    }

    logger.info('[CASINO] Xoc Dia round played', {
        userId, guildId, betChoice, betAmount, redCount: result.redCount, won, netPayout, taxRate, jackpotWon
    });
}

async function handleJackpotLookup(interaction, client) {
    const guildId = interaction.guildId;
    const [taixiuJackpot, xocdiaJackpot] = await Promise.all([
        getJackpot(client, guildId, 'taixiu'),
        getJackpot(client, guildId, 'xocdia'),
    ]);

    const imageBuffer = await renderJackpotCard({ taixiuJackpot, xocdiaJackpot });
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'jackpot.png' });
    const embed = createEmbed({ color: 'primary' }).setImage('attachment://jackpot.png');
    await InteractionHelper.safeEditReply(interaction, { embeds: [embed], files: [attachment] });
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
        )
        .addSubcommand(sub =>
            sub
                .setName('jackpot')
                .setDescription('Xem số dư Jackpot hiện tại')
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
            case 'jackpot':
                await handleJackpotLookup(interaction, client);
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
