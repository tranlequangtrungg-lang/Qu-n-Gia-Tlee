import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserBetHistory, listAllMatches, getAllBetsForMatch } from '../../services/matchBettingService.js';

function formatUserBetLine(entry) {
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

    const scoreLine = match.status === 'resolved' ? ` (KQ: ${match.realScoreA}-${match.realScoreB})` : '';
    return `**${match.teamA} vs ${match.teamB}**${scoreLine}\nCược: ${pickLabel} · ${bet.amount.toLocaleString('vi-VN')} Bcoin\n${statusLine}`;
}

async function handleUserHistory(interaction, client, targetUser) {
    const history = await getUserBetHistory(client, interaction.guildId, targetUser.id);

    if (history.length === 0) {
        await InteractionHelper.safeEditReply(interaction, {
            content: targetUser.id === interaction.user.id
                ? 'Bạn chưa đặt cược trận nào cả.'
                : `${targetUser.username} chưa đặt cược trận nào cả.`,
        });
        return;
    }

    const recent = history.slice(0, 10);
    const totalWon = history.reduce((sum, e) => sum + (e.bet.resolved ? e.bet.payout : 0), 0);
    const totalStaked = history.reduce((sum, e) => sum + e.bet.amount + (e.bet.tax || 0), 0);

    const embed = new EmbedBuilder()
        .setTitle(`⚽ Lịch sử cược của ${targetUser.username}`)
        .setColor('#2ecc71')
        .setDescription(recent.map(formatUserBetLine).join('\n\n'))
        .setFooter({ text: `Tổng đã cược: ${totalStaked.toLocaleString('vi-VN')} Bcoin · Tổng đã thắng: ${totalWon.toLocaleString('vi-VN')} Bcoin${history.length > 10 ? ` · Hiện 10/${history.length} trận gần nhất` : ''}` });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleAllHistory(interaction, client) {
    const allMatches = await listAllMatches(client, interaction.guildId);
    const resolvedMatches = allMatches.filter((m) => m.status === 'resolved').slice(0, 5);

    if (resolvedMatches.length === 0) {
        await InteractionHelper.safeEditReply(interaction, { content: 'Chưa có trận nào được chốt kết quả cả.' });
        return;
    }

    const blocks = [];
    for (const match of resolvedMatches) {
        const bets = await getAllBetsForMatch(client, interaction.guildId, match.id);
        const winners = bets.filter((b) => b.resolved && b.payout > 0);
        const losers = bets.filter((b) => b.resolved && b.payout === 0);

        const winnerLines = winners.length > 0
            ? winners.map((w) => `🎉 <@${w.userId}> +${w.payout.toLocaleString('vi-VN')} Bcoin`).join('\n')
            : '_Không ai thắng_';
        const loserLines = losers.length > 0
            ? losers.map((l) => `❌ <@${l.userId}> -${l.amount.toLocaleString('vi-VN')} Bcoin`).join('\n')
            : '';

        blocks.push(
            `**${match.teamA} ${match.realScoreA} - ${match.realScoreB} ${match.teamB}**\n${winnerLines}${loserLines ? `\n${loserLines}` : ''}`,
        );
    }

    const embed = new EmbedBuilder()
        .setTitle('⚽ Lịch sử cược — 5 trận gần nhất')
        .setColor('#2ecc71')
        .setDescription(blocks.join('\n\n'));

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

export default {
    data: new SlashCommandBuilder()
        .setName('lichsucuoc')
        .setDescription('Xem lịch sử cược bóng đá')
        .addSubcommand((sub) =>
            sub
                .setName('user')
                .setDescription('Xem lịch sử cược của 1 người (bỏ trống = chính bạn)')
                .addUserOption((opt) => opt.setName('nguoi_dung').setDescription('Người muốn xem')),
        )
        .addSubcommand((sub) =>
            sub.setName('all').setDescription('Xem tổng hợp lịch sử cược của mọi người'),
        )
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'all') {
            await handleAllHistory(interaction, client);
            return;
        }

        const targetUser = interaction.options.getUser('nguoi_dung') || interaction.user;
        await handleUserHistory(interaction, client, targetUser);
    },
};
