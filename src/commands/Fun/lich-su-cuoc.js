import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserBetHistory } from '../../services/matchBettingService.js';

function formatBetLine(entry) {
    const { match, bet } = entry;
    const pickLabel = bet.type === 'thang'
        ? { a: match.teamA, hoa: 'Hoà', b: match.teamB }[bet.pick]
        : `${bet.pick.a} - ${bet.pick.b}`;

    let statusLine;
    if (match.status !== 'resolved') {
        statusLine = '⏳ Chưa có kết quả';
    } else if (bet.resolved && bet.payout > 0) {
        statusLine = `🎉 Thắng **+${bet.payout.toLocaleString('vi-VN')} Bcoin**`;
    } else {
        statusLine = `❌ Thua **-${bet.amount.toLocaleString('vi-VN')} Bcoin**`;
    }

    const scoreLine = match.status === 'resolved'
        ? ` (KQ: ${match.realScoreA}-${match.realScoreB})`
        : '';

    return `**${match.teamA} vs ${match.teamB}**${scoreLine}\nCược: ${pickLabel} · ${bet.amount.toLocaleString('vi-VN')} Bcoin\n${statusLine}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('lich-su-cuoc')
        .setDescription('Xem lịch sử cược bóng đá của bạn')
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        const history = await getUserBetHistory(client, interaction.guildId, interaction.user.id);

        if (history.length === 0) {
            await InteractionHelper.safeEditReply(interaction, { content: 'Bạn chưa đặt cược trận nào cả.' });
            return;
        }

        // Mới nhất trước, giới hạn 10 trận gần nhất để tránh embed quá dài.
        const recent = history.slice(0, 10);
        const totalWon = history.reduce((sum, e) => sum + (e.bet.resolved ? e.bet.payout : 0), 0);
        const totalStaked = history.reduce((sum, e) => sum + e.bet.amount + (e.bet.tax || 0), 0);

        const embed = new EmbedBuilder()
            .setTitle(`⚽ Lịch sử cược của ${interaction.user.username}`)
            .setColor('#2ecc71')
            .setDescription(recent.map(formatBetLine).join('\n\n'))
            .setFooter({ text: `Tổng đã cược: ${totalStaked.toLocaleString('vi-VN')} Bcoin · Tổng đã thắng: ${totalWon.toLocaleString('vi-VN')} Bcoin${history.length > 10 ? ` · Hiện 10/${history.length} trận gần nhất` : ''}` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    },
};
