import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { closeBetting, getLatestOpenMatch } from '../../services/matchBettingService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('dong-cuoc')
        .setDescription('[Admin] Đóng cược 1 trận đấu trước giờ bóng lăn')
        .addStringOption((o) => o.setName('ma_tran').setDescription('Mã trận (bỏ trống = trận mở gần nhất)'))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        let matchId = interaction.options.getString('ma_tran');
        if (!matchId) {
            const latest = await getLatestOpenMatch(client, interaction.guildId);
            if (!latest) {
                await InteractionHelper.safeEditReply(interaction, { content: '❌ Không có trận nào đang mở cược.' });
                return;
            }
            matchId = latest.id;
        }

        const result = await closeBetting(client, interaction.guildId, matchId);
        if (!result.ok) {
            const messages = {
                not_found: '❌ Không tìm thấy trận đấu với mã đó.',
                not_open: '❌ Trận này không ở trạng thái đang mở (đã đóng hoặc đã chốt kết quả rồi).',
            };
            await InteractionHelper.safeEditReply(interaction, { content: messages[result.reason] || '❌ Đóng cược thất bại.' });
            return;
        }

        await InteractionHelper.safeEditReply(interaction, {
            content: `🔒 Đã đóng cược cho **${result.match.teamA} vs ${result.match.teamB}**. Không ai đặt cược thêm được nữa — dùng \`/chot-tran\` sau khi có kết quả thật.`,
        });
    },
};
