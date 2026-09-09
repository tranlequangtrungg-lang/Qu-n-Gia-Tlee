// FILE MỚI → src/commands/Economy/jackpot.js
//
// Thay cho subcommand `/casino jackpot` cũ. Chỉ là lệnh xem thông tin, KHÔNG
// đứng tên persona (đây không phải "kết quả" ván chơi, chỉ là tra cứu số
// dư) — giữ nguyên cách hiển thị cũ (interaction.editReply bình thường).

import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getJackpot } from '../../utils/casinoJackpot.js';
import { renderJackpotCard } from '../../utils/casinoRender.js';

export default {
    data: new SlashCommandBuilder()
        .setName('jackpot')
        .setDescription('Xem số dư Jackpot hiện tại'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const [taixiuJackpot, xocdiaJackpot] = await Promise.all([
            getJackpot(client, guildId, 'taixiu'),
            getJackpot(client, guildId, 'xocdia'),
        ]);

        const imageBuffer = await renderJackpotCard({ taixiuJackpot, xocdiaJackpot });
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'jackpot.png' });
        const embed = createEmbed({ color: 'primary' }).setImage('attachment://jackpot.png');
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], files: [attachment] });
    }, { command: 'jackpot' }),
};
