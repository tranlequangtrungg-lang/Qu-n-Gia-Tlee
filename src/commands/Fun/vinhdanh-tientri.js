import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { resolveLeg } from '../../services/tienTriService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('vinhdanh-tientri')
        .setDescription('[Admin] Chốt kết quả trận đấu và trao role Nhà Tiên Tri')
        .addStringOption((option) =>
            option
                .setName('luot')
                .setDescription('Lượt đấu cần chốt kết quả')
                .setRequired(true)
                .addChoices(
                    { name: 'Lượt đi', value: 'luot_di' },
                    { name: 'Lượt về', value: 'luot_ve' },
                ),
        )
        .addIntegerOption((option) =>
            option
                .setName('vietnam')
                .setDescription('Tỉ số thật của Việt Nam')
                .setMinValue(0)
                .setMaxValue(20)
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName('thailan')
                .setDescription('Tỉ số thật của Thái Lan')
                .setMinValue(0)
                .setMaxValue(20)
                .setRequired(true),
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const leg = interaction.options.getString('luot', true);
        const vn = interaction.options.getInteger('vietnam', true);
        const thai = interaction.options.getInteger('thailan', true);

        const { winners } = await resolveLeg(client, interaction.guildId, leg, vn, thai);

        await InteractionHelper.safeEditReply(interaction, {
            content: winners.length > 0
                ? `✅ Đã chốt kết quả. **${winners.length}** người nhận role Nhà Tiên Tri — xem thông báo tại <#1539851934222131292>.`
                : `✅ Đã chốt kết quả. Không có dự đoán nào để so khớp.`,
        });
    },
};
