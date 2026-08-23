import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createMatch } from '../../services/matchBettingService.js';

// Tự parse tỉ lệ từ chuỗi, chấp nhận cả dấu "." và "," làm dấu thập phân —
// không phụ thuộc Discord client tự hiểu số theo ngôn ngữ hiển thị (đã gặp
// lỗi "1.8" bị hiểu thành 18 khi dùng Number option ở giao diện tiếng Việt).
function parseOdds(raw) {
    if (!raw) return null;
    const normalized = raw.trim().replace(',', '.');
    const value = parseFloat(normalized);
    return Number.isFinite(value) && value > 1 ? value : null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('tao-tran')
        .setDescription('[Admin] Mở cược cho 1 trận đấu mới')
        .addStringOption((o) => o.setName('doi_a').setDescription('Tên đội A').setRequired(true))
        .addStringOption((o) => o.setName('doi_b').setDescription('Tên đội B').setRequired(true))
        .addStringOption((o) => o.setName('giai_dau').setDescription('Tên giải đấu (vd: ASEAN Championship - Chung kết lượt về)').setRequired(true))
        .addStringOption((o) => o.setName('ti_le_a_thang').setDescription('Tỉ lệ ăn nếu đội A thắng (vd 1.8 hoặc 1,8)').setRequired(true))
        .addStringOption((o) => o.setName('ti_le_hoa').setDescription('Tỉ lệ ăn nếu hoà (vd 4.1 hoặc 4,1)').setRequired(true))
        .addStringOption((o) => o.setName('ti_le_b_thang').setDescription('Tỉ lệ ăn nếu đội B thắng (vd 5.1 hoặc 5,1)').setRequired(true))
        .addStringOption((o) => o.setName('ti_le_ti_so').setDescription('Tỉ lệ ăn nếu đoán đúng tỉ số (vd 8.0 hoặc 8,0)').setRequired(true))
        .addStringOption((o) => o.setName('co_a').setDescription('Emoji cờ đội A (vd 🇻🇳)'))
        .addStringOption((o) => o.setName('co_b').setDescription('Emoji cờ đội B (vd 🇹🇭)'))
        .addStringOption((o) => o.setName('thoi_gian').setDescription('Thời gian đá (vd: 26.08.2026 20:00)'))
        .addStringOption((o) => o.setName('ket_qua_truoc').setDescription('Kết quả trận trước, nếu có (vd: Kết quả lượt đi: 2-0)'))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const teamA = interaction.options.getString('doi_a', true);
        const teamB = interaction.options.getString('doi_b', true);
        const tournament = interaction.options.getString('giai_dau', true);

        const oddsA = parseOdds(interaction.options.getString('ti_le_a_thang', true));
        const oddsHoa = parseOdds(interaction.options.getString('ti_le_hoa', true));
        const oddsB = parseOdds(interaction.options.getString('ti_le_b_thang', true));
        const oddsTiSo = parseOdds(interaction.options.getString('ti_le_ti_so', true));

        if (!oddsA || !oddsHoa || !oddsB || !oddsTiSo) {
            await InteractionHelper.safeEditReply(interaction, {
                content: '❌ Tỉ lệ không hợp lệ — nhập số lớn hơn 1, vd `1.8` hoặc `1,8`.',
            });
            return;
        }

        const flagA = interaction.options.getString('co_a');
        const flagB = interaction.options.getString('co_b');
        const matchTime = interaction.options.getString('thoi_gian');
        const previousResult = interaction.options.getString('ket_qua_truoc');

        const match = await createMatch(client, interaction.guildId, {
            teamA, teamB, tournament, flagA, flagB, matchTime, previousResult,
            oddsThang: { a: oddsA, hoa: oddsHoa, b: oddsB },
            oddsTiSo,
        });

        await InteractionHelper.safeEditReply(interaction, {
            content:
                `✅ Đã mở cược cho trận **${teamA} vs ${teamB}** (${tournament}).\n` +
                `Mã trận: \`${match.id}\`\n\n` +
                `Dùng \`/bongda\` để hiện bảng cược cho mọi người bấm.`,
        });
    },
};
