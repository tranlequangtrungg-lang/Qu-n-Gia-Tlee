import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, warningEmbed, infoEmbed, createEmbed } from '../../utils/embeds.js';
import { addMoney, removeMoney, formatCurrency } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isServerAdmin } from '../../utils/permissions.js';
import { requestConfirmation } from '../../utils/confirmPrompt.js';

const LARGE_AMOUNT_THRESHOLD = 200000; // từ mức này trở lên -> yêu cầu bấm Confirm

export default {
    data: new SlashCommandBuilder()
        .setName('addmoney')
        .setDescription('[Admin] Cộng hoặc trừ Bcoin vào ví của một người dùng')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Người dùng cần chỉnh số dư')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Số tiền (âm để trừ, ví dụ -5000)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Lý do (vd: giveaway, hoàn tiền lỗi...)')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        if (!isServerAdmin(interaction)) {
            throw createError(
                'Insufficient permission for /addmoney',
                ErrorTypes.VALIDATION,
                'Bạn cần quyền Administrator hoặc là chủ server để dùng lệnh này.',
                { userId: interaction.user.id, guildId: interaction.guildId }
            );
        }

        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'Không có lý do';
        const guildId = interaction.guildId;

        if (targetUser.bot) {
            throw createError(
                'Cannot addmoney to bot',
                ErrorTypes.VALIDATION,
                'Không thể chỉnh số dư của bot.',
                { targetId: targetUser.id }
            );
        }

        if (amount === 0) {
            throw createError(
                'Zero amount',
                ErrorTypes.VALIDATION,
                'Số tiền phải khác 0.',
                { amount }
            );
        }

        if (Math.abs(amount) >= LARGE_AMOUNT_THRESHOLD) {
            const confirmEmbed = warningEmbed(
                '⚠️ Xác nhận giao dịch lớn',
                `Bạn sắp **${amount > 0 ? 'CỘNG' : 'TRỪ'} ${formatCurrency(Math.abs(amount))}** ` +
                `${amount > 0 ? 'vào' : 'khỏi'} ví của ${targetUser}.\n\nLý do: ${reason}\n\nXác nhận thực hiện?`
            );

            const confirmed = await requestConfirmation(interaction, { embed: confirmEmbed });

            if (!confirmed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('Đã hủy', 'Giao dịch addmoney đã bị hủy.')],
                    components: [],
                });
            }
        }

        const result = amount > 0
            ? await addMoney(client, guildId, targetUser.id, amount, 'wallet')
            : await removeMoney(client, guildId, targetUser.id, Math.abs(amount), 'wallet');

        logger.info('[ADMIN] addmoney executed', {
            adminId: interaction.user.id,
            targetId: targetUser.id,
            guildId,
            amount,
            reason,
            newBalance: result.newBalance,
            timestamp: new Date().toISOString(),
        });

        const resultEmbed = successEmbed(
            amount > 0 ? '✅ Đã cộng tiền' : '✅ Đã trừ tiền',
            `${amount > 0 ? 'Cộng' : 'Trừ'} **${formatCurrency(Math.abs(amount))}** ${amount > 0 ? 'vào' : 'khỏi'} ví của ${targetUser}.`
        ).addFields(
            { name: 'Số dư mới', value: formatCurrency(result.newBalance), inline: true },
            { name: 'Lý do', value: reason, inline: true },
            { name: 'Thực hiện bởi', value: `${interaction.user}`, inline: true },
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed], components: [] });

        // Gửi log vào kênh cấu hình qua /config set-log-channel (nếu đã đặt)
        try {
            const guildConfig = await getGuildConfig(client, guildId);
            if (guildConfig.addMoneyLogChannelId) {
                const logChannel = await client.channels.fetch(guildConfig.addMoneyLogChannelId).catch(() => null);
                if (logChannel) {
                    const logEmbed = createEmbed({
                        title: amount > 0 ? '💰 Addmoney: Cộng tiền' : '💸 Addmoney: Trừ tiền',
                    }).addFields(
                        { name: 'Admin', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                        { name: 'Người nhận', value: `${targetUser} (${targetUser.id})`, inline: true },
                        { name: 'Số tiền', value: `${amount > 0 ? '+' : ''}${formatCurrency(amount)}`, inline: true },
                        { name: 'Số dư mới', value: formatCurrency(result.newBalance), inline: true },
                        { name: 'Lý do', value: reason, inline: false },
                    ).setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch((err) => {
                        logger.error('[ADMIN] Failed to send addmoney log', err);
                    });
                }
            } else {
                logger.warn('[ADMIN] addmoney used but no log channel configured', { guildId });
            }
        } catch (error) {
            logger.error('[ADMIN] Error while sending addmoney log', error);
        }
    }, { command: 'addmoney' })
};
