import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, formatCurrency, withEconomyLock } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';

const ROB_COOLDOWN = BotConfig.economy?.cooldowns?.rob ?? 4 * 60 * 60 * 1000;
const BASE_ROB_SUCCESS_CHANCE = BotConfig.economy?.robSuccessRate ?? 0.4;
const ROB_PERCENTAGE = 0.15;
const FINE_PERCENTAGE = 0.1;
const MIN_VICTIM_WALLET = 500;

export default {
    data: new SlashCommandBuilder()
        .setName('rob')
        .setDescription('Attempt to rob another user (very risky)')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to rob')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const robberId = interaction.user.id;
        const victimUser = interaction.options.getUser("user");
        const guildId = interaction.guildId;

        if (robberId === victimUser.id) {
            throw createError(
                "Cannot rob self",
                ErrorTypes.VALIDATION,
                "You cannot rob yourself.",
                { robberId, victimId: victimUser.id }
            );
        }

        if (victimUser.bot) {
            throw createError(
                "Cannot rob bot",
                ErrorTypes.VALIDATION,
                "You cannot rob a bot.",
                { victimId: victimUser.id, isBot: true }
            );
        }

        // Toàn bộ đọc-sửa-ghi của CẢ 2 người nằm trong lock để không thể bị
        // chạy song song với 1 lệnh /rob, /work, /addmoney... khác đang xử lý
        // đúng lúc trên cùng 1 trong 2 người dùng này.
        const result = await withEconomyLock(guildId, [robberId, victimUser.id], async () => {
            const now = Date.now();
            const robberData = await getEconomyData(client, guildId, robberId);
            const victimData = await getEconomyData(client, guildId, victimUser.id);

            if (!robberData || !victimData) {
                throw createError(
                    "Failed to load economy data",
                    ErrorTypes.DATABASE,
                    "Failed to load economy data. Please try again later.",
                    { robberId: !!robberData, victimId: !!victimData, guildId }
                );
            }

            const lastRob = robberData.lastRob || 0;

            if (now < lastRob + ROB_COOLDOWN) {
                const remaining = lastRob + ROB_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

                throw createError(
                    "Robbery cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    `You need to lay low. Wait **${hours}h ${minutes}m** before attempting another robbery.`,
                    { remaining, hours, minutes, cooldownType: 'rob' }
                );
            }

            if ((victimData.wallet || 0) < MIN_VICTIM_WALLET) {
                throw createError(
                    "Victim too poor",
                    ErrorTypes.VALIDATION,
                    `${victimUser.username} is too poor. They need at least ${formatCurrency(MIN_VICTIM_WALLET)} cash to be worth robbing.`,
                    { victimWallet: victimData.wallet, required: MIN_VICTIM_WALLET }
                );
            }

            // FIX: fallback về {} nếu victim chưa từng có inventory (user mới),
            // tránh crash "Cannot read properties of undefined (reading 'personal_safe')"
            const victimInventory = victimData.inventory || {};
            const hasSafe = victimInventory["personal_safe"] || 0;

            if (hasSafe > 0) {
                robberData.lastRob = now;
                await setEconomyData(client, guildId, robberId, robberData);
                return { blocked: true };
            }

            const isSuccessful = Math.random() < BASE_ROB_SUCCESS_CHANCE;
            let outcome;

            if (isSuccessful) {
                const amountStolen = Math.floor((victimData.wallet || 0) * ROB_PERCENTAGE);
                robberData.wallet = (robberData.wallet || 0) + amountStolen;
                victimData.wallet = (victimData.wallet || 0) - amountStolen;
                outcome = { success: true, amountStolen };
            } else {
                const fineAmount = Math.floor((robberData.wallet || 0) * FINE_PERCENTAGE);
                robberData.wallet = Math.max(0, (robberData.wallet || 0) - fineAmount);
                outcome = { success: false, fineAmount };
            }

            robberData.lastRob = now;
            await setEconomyData(client, guildId, robberId, robberData);
            await setEconomyData(client, guildId, victimUser.id, victimData);

            return {
                blocked: false,
                ...outcome,
                robberWallet: robberData.wallet,
                victimWallet: victimData.wallet,
            };
        });

        if (result.blocked) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    warningEmbed(
                        'Robbery Blocked',
                        `${victimUser.username} was prepared! Your attempt failed because they own a **Personal Safe**. You got away clean but didn't gain anything.`
                    )
                ],
            });
        }

        let resultEmbed;
        if (result.success) {
            resultEmbed = successEmbed(
                'Robbery Successful',
                `You successfully stole **${formatCurrency(result.amountStolen)}** from ${victimUser.username}!`
            );
        } else {
            resultEmbed = buildUserErrorEmbed(
                'unknown',
                `You failed the robbery and were caught! You were fined **${formatCurrency(result.fineAmount)}** of your own cash.`,
                { titleOverride: 'Robbery Failed' }
            );
        }

        resultEmbed
            .addFields(
                { name: `Your New Cash (${interaction.user.username})`, value: formatCurrency(result.robberWallet), inline: true },
                { name: `Victim's New Cash (${victimUser.username})`, value: formatCurrency(result.victimWallet), inline: true },
            )
            .setFooter({ text: `Next robbery available in ${Math.ceil(ROB_COOLDOWN / (60 * 60 * 1000))} hours.` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'rob' })
};
