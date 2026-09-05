import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { removeExpression } from '../../services/bieuCamService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tlee-xoa')
        .setDescription('[Admin] Xoá 1 biểu cảm khỏi /tlee')
        .addStringOption((o) => o.setName('ten').setDescription('Tên biểu cảm cần xoá').setRequired(true))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const name = interaction.options.getString('ten', true).trim();
        const removed = await removeExpression(client, interaction.guildId, name);

        await InteractionHelper.safeEditReply(interaction, {
            content: removed ? `✅ Đã xoá biểu cảm **${name}**.` : `❌ Không tìm thấy biểu cảm **${name}**.`,
        });
    },
};
