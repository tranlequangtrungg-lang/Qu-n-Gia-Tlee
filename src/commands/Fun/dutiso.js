import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { submitPrediction } from '../../services/tienTriService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('dutiso')
        .setDescription('Dự đoán tỉ số trận Việt Nam vs Thái Lan (ASEAN Championship)')
        .addStringOption((option) =>
            option
                .setName('luot')
                .setDescription('Lượt đấu bạn đang dự đoán')
                .setRequired(true)
                .addChoices(
                    { name: 'Lượt đi', value: 'luot_di' },
                    { name: 'Lượt về', value: 'luot_ve' },
                ),
        )
        .addIntegerOption((option) =>
            option
                .setName('vietnam')
                .setDescription('Số bàn thắng của Việt Nam')
                .setMinValue(0)
                .setMaxValue(20)
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName('thailan')
                .setDescription('Số bàn thắng của Thái Lan')
                .setMinValue(0)
                .setMaxValue(20)
                .setRequired(true),
        )
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const leg = interaction.options.getString('luot', true);
        const vn = interaction.options.getInteger('vietnam', true);
        const thai = interaction.options.getInteger('thailan', true);

        await submitPrediction(client, interaction.guildId, interaction.user.id, leg, vn, thai);

        const legLabel = leg === 'luot_di' ? 'Lượt đi' : 'Lượt về';
        await InteractionHelper.safeEditReply(interaction, {
            content: `✅ Đã ghi nhận dự đoán **${legLabel}**: Việt Nam ${vn} - ${thai} Thái Lan.\nDùng lại lệnh này để sửa dự đoán trước khi trận đấu kết thúc.`,
        });
    },
};
