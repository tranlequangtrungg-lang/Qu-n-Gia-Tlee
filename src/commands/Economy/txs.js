// FILE MỚI → src/commands/Economy/txs.js
//
// Thay cho subcommand `/casino tx` cũ. Không chứa logic trò chơi (nằm hết
// trong src/utils/casinoTable.js, dùng chung với các bàn tự mở lại sau mỗi
// ván) — file này chỉ lo phần "nhận lệnh": nếu đã có bàn mở sẵn thì trỏ
// người chơi tới đó, còn không thì mở bàn mới (ẩn tin nhắn tạm rồi để
// casinoTable.js tự gửi tin nhắn persona thật).

import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getActiveTable, openTable } from '../../utils/casinoTable.js';

export default {
    data: new SlashCommandBuilder()
        .setName('txs')
        .setDescription('Bàn Tài Xỉu chung nhiều người chơi'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const channelId = interaction.channelId;
        const existing = await getActiveTable(client, channelId);
        if (existing && existing.status !== 'resolved') {
            const jumpLink = `https://discord.com/channels/${interaction.guildId}/${channelId}/${existing.messageId}`;
            await InteractionHelper.safeEditReply(interaction, {
                content: `🎲 Đang có bàn Tài Xỉu mở sẵn rồi! [Bấm vào đây để tham gia](${jumpLink})`,
            });
            return;
        }

        // Chưa có bàn nào -> ẩn tin nhắn tạm, để casinoTable.js tự mở bàn
        // mới bằng tin nhắn persona thật trong kênh.
        await InteractionHelper.safeDeleteReply(interaction);
        await openTable(client, interaction.channel);
    }, { command: 'txs' }),
};
