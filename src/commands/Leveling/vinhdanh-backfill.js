import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getUserLevelData } from '../../services/leveling/leveling.js';
import { listLevelUserIds } from '../../services/leveling/levelRoleSyncService.js';
import { backfillDanhVongMoc, DANH_VONG_MOCS } from '../../services/vinhDanhService.js';

// Lệnh admin chạy 1 lần: quét toàn bộ user đã có dữ liệu level, gửi thánh
// chỉ Danh Vọng còn thiếu cho những ai đạt mốc trước khi hệ thống vinh danh
// tồn tại. An toàn để chạy lại nhiều lần — vẫn gửi lại ảnh mỗi lần chạy cho
// người đủ điều kiện, nên chỉ nên dùng khi thực sự cần (không dùng định kỳ).
export default {
    data: new SlashCommandBuilder()
        .setName('vinhdanh-backfill')
        .setDescription('[Admin] Gửi bù thánh chỉ Danh Vọng cho user đã đạt mốc từ trước')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'Leveling',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const guildId = interaction.guildId;
        const minThreshold = DANH_VONG_MOCS[0].threshold;

        const userIds = await listLevelUserIds(client, guildId);
        let sent = 0;
        let checked = 0;

        for (const userId of userIds) {
            const levelData = await getUserLevelData(client, guildId, userId);
            if (levelData.level < minThreshold) continue;

            checked += 1;
            const success = await backfillDanhVongMoc(client, guildId, userId, levelData.level);
            if (success) sent += 1;

            // Giãn nhẹ giữa các lần gửi để tránh dồn dập render ảnh + gọi
            // Discord API liên tục cho server có nhiều user đủ điều kiện.
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }

        logger.info(`[VINH_DANH] Backfill hoàn tất cho guild ${guildId}: ${sent}/${checked} thánh chỉ đã gửi`);

        await InteractionHelper.safeEditReply(interaction, {
            content: `✅ Đã quét xong. Gửi thành công **${sent}/${checked}** thánh chỉ Danh Vọng còn thiếu.`,
        });
    },
};
