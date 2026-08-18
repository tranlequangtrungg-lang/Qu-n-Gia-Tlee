import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { getMuteRoles } from '../../utils/moderation.js';
import { isBotOwner } from '../../config/bot.js';
import { renderThanhChi } from '../../utils/thanhChiRender.js';

const MAX_DURATION_MS = 28 * 24 * 60 * 60 * 1000; // giới hạn cứng của Discord

// "30m" / "2h" / "3d" -> {ms, display}
function parseDuration(input) {
    const match = /^(\d+)\s*(m|h|d)$/i.exec(input.trim());
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const unitMs = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    const unitLabel = { m: 'phút', h: 'giờ', d: 'ngày' };
    const ms = value * unitMs[unit];
    if (ms <= 0 || ms > MAX_DURATION_MS) return null;
    return { ms, display: `${value} ${unitLabel[unit]}` };
}

async function hasMutePermission(member, guildId) {
    if (isBotOwner(member.id)) return true;
    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
    const muteRoles = await getMuteRoles(guildId);
    if (muteRoles.length > 0 && member.roles.cache.some((role) => muteRoles.includes(role.id))) return true;
    return false;
}

export default {
    data: new SlashCommandBuilder()
        .setName('tungay')
        .setDescription('Tống ngay một thành viên trong khoảng thời gian chỉ định.')
        .addUserOption((option) => option.setName('target').setDescription('Người bị tống ngay').setRequired(true))
        .addStringOption((option) =>
            option
                .setName('duration')
                .setDescription('Thời gian, vd: 30m, 2h, 3d (tối đa 28d)')
                .setRequired(true),
        )
        .addStringOption((option) => option.setName('reason').setDescription('Lý do')),
    category: 'moderation',
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Tungay interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'tungay',
            });
            return;
        }

        const allowed = await hasMutePermission(interaction.member, interaction.guildId);
        if (!allowed) {
            throw new TitanBotError(
                'Missing mute permission',
                ErrorTypes.PERMISSION,
                'Bạn không có quyền dùng lệnh này. Cần quyền "Moderate Members" hoặc role nằm trong danh sách mute (xem /muteconfig).',
            );
        }

        const targetUser = interaction.options.getUser('target');
        const member = interaction.options.getMember('target');
        const durationInput = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'Không có lý do';

        if (!targetUser) {
            throw new TitanBotError('Missing target user', ErrorTypes.USER_INPUT, 'Bạn phải chọn người để tống ngay.', { subtype: 'invalid_user' });
        }
        if (targetUser.id === interaction.user.id) {
            throw new TitanBotError('Cannot timeout self', ErrorTypes.VALIDATION, 'Bạn không thể tự tống ngay chính mình.');
        }
        if (targetUser.id === client.user.id) {
            throw new TitanBotError('Cannot timeout bot', ErrorTypes.VALIDATION, 'Bạn không thể tống ngay bot.');
        }
        if (isBotOwner(targetUser.id)) {
            throw new TitanBotError('Cannot timeout bot owner', ErrorTypes.VALIDATION, 'Không thể tống ngay chủ bot.');
        }
        if (!member) {
            throw new TitanBotError('Target not found', ErrorTypes.USER_INPUT, 'Người này hiện không có trong server.');
        }

        const parsed = parseDuration(durationInput);
        if (!parsed) {
            throw new TitanBotError(
                'Invalid duration',
                ErrorTypes.VALIDATION,
                'Thời gian không hợp lệ. Dùng dạng số + đơn vị (m/h/d), vd: 30m, 2h, 3d. Tối đa 28d.',
            );
        }

        const result = await ModerationService.timeoutUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            durationMs: parsed.ms,
            reason,
        });

        // Gửi DM báo người bị mute (best-effort, không chặn luồng chính nếu lỗi)
        try {
            await targetUser.send(Bạn đã bị tống ngay tại ${interaction.guild.name} trong ${parsed.display}.\nLý do: ${reason},);
        } catch (error) {
            logger.warn('[TUNGAY] Không gửi được DM báo mute', { userId: targetUser.id, error: error.message });
        }

        // Render ảnh Thánh Chỉ, gửi kèm cả kênh và DM
        let attachment = null;
        try {
            const buffer = await renderThanhChi({
                avatarURL: targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
                displayName: member.displayName,
                lyDo: reason,
                thoiGianText: parsed.display,
            });
            attachment = new AttachmentBuilder(buffer, { name: 'thanhchi.png' });
        } catch (error) {
            logger.warn('[TUNGAY] Không render được ảnh Thánh Chỉ', { error: error.message });
        }

        if (attachment) {
            try {
                await targetUser.send({ files: [attachment] });
            } catch (error) {
                logger.warn('[TUNGAY] Không gửi được ảnh Thánh Chỉ qua DM', { error: error.message });
            }
        }

        await InteractionHelper.safeEditReply(interaction, {embeds: [successEmbed(⏳ Đã tống ngay ${targetUser.tag} trong ${parsed.display}.,**Lý do:** ${reason}\n**Case ID:** #${result.caseId},),],files: attachment ? [attachment] : [],});
    },
};
