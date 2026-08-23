import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getMatch, resolveMatch, getLatestOpenMatch } from '../../services/matchBettingService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('chot-tran')
        .setDescription('[Admin] Chốt kết quả trận đấu và trả thưởng')
        .addIntegerOption((o) => o.setName('diem_doi_a').setDescription('Tỉ số thật của đội A').setMinValue(0).setMaxValue(20).setRequired(true))
        .addIntegerOption((o) => o.setName('diem_doi_b').setDescription('Tỉ số thật của đội B').setMinValue(0).setMaxValue(20).setRequired(true))
        .addStringOption((o) => o.setName('ma_tran').setDescription('Mã trận (bỏ trống = trận vừa đóng/mở gần nhất)'))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const scoreA = interaction.options.getInteger('diem_doi_a', true);
        const scoreB = interaction.options.getInteger('diem_doi_b', true);

        let matchId = interaction.options.getString('ma_tran');
        let matchBefore;

        if (matchId) {
            matchBefore = await getMatch(client, interaction.guildId, matchId);
        } else {
            // Trận đã /dong-cuoc vẫn giữ status 'closed', không còn là
            // 'open' nữa nên getLatestOpenMatch sẽ không thấy — cần bạn
            // truyền ma_tran rõ ràng trong trường hợp đó. Chỉ tự tìm được
            // khi trận còn đang 'open' (quên đóng cược trước khi chốt).
            matchBefore = await getLatestOpenMatch(client, interaction.guildId);
            matchId = matchBefore?.id;
        }

        if (!matchBefore) {
            await InteractionHelper.safeEditReply(interaction, {
                content: '❌ Không tìm thấy trận đấu. Nếu trận đã `/dong-cuoc`, hãy nhập rõ `ma_tran` (mã hiện ở tin nhắn `/tao-tran` hoặc footer bảng `/bongda`).',
            });
            return;
        }

        const result = await resolveMatch(client, interaction.guildId, matchId, scoreA, scoreB);

        if (!result.ok) {
            await InteractionHelper.safeEditReply(interaction, {
                content: result.reason === 'already_resolved' ? '❌ Trận này đã được chốt trước đó.' : '❌ Chốt trận thất bại.',
            });
            return;
        }

        const winners = result.results.filter((r) => r.won);
        const losers = result.results.filter((r) => !r.won);

        const embed = new EmbedBuilder()
            .setTitle(`⚽ Kết quả: ${matchBefore.teamA} ${scoreA} - ${scoreB} ${matchBefore.teamB}`)
            .setColor('#2ecc71')
            .setDescription(
                winners.length > 0
                    ? winners.map((w) => `🎉 <@${w.userId}> thắng **${w.payout.toLocaleString('vi-VN')} Bcoin**`).join('\n')
                    : 'Không có ai thắng cược trận này.',
            )
            .setFooter({ text: `${winners.length} thắng · ${losers.length} thua · Tổng ${result.results.length} lượt cược` });

        await InteractionHelper.safeEditReply(interaction, { content: '✅ Đã chốt kết quả và trả thưởng.', embeds: [embed] });
    },
};
