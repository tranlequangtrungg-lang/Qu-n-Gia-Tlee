import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { addExpression } from '../../services/bieuCamService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tlee-them')
        .setDescription('[Admin] Thêm 1 biểu cảm mới vào /tlee')
        .addStringOption((o) => o.setName('ten').setDescription('Tên biểu cảm (vd: khinh, cảm ơn)').setRequired(true))
        .addStringOption((o) => o.setName('mo_ta').setDescription('Mô tả ngắn hiện trong danh sách chọn').setRequired(true))
        .addAttachmentOption((o) => o.setName('file').setDescription('Gif/ảnh động cho biểu cảm này').setRequired(true))
        .addStringOption((o) => o.setName('caption').setDescription('Caption tuỳ chỉnh, dùng {nguoi_dung} và {muc_tieu} (bỏ trống = mẫu mặc định)'))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const name = interaction.options.getString('ten', true).trim();
        const description = interaction.options.getString('mo_ta', true).trim();
        const captionTemplate = interaction.options.getString('caption')?.trim() || null;
        const attachment = interaction.options.getAttachment('file', true);

        if (!attachment.contentType?.startsWith('image/')) {
            await InteractionHelper.safeEditReply(interaction, { content: '❌ File phải là ảnh hoặc gif.' });
            return;
        }

        try {
            await addExpression(client, interaction.guildId, {
                name,
                description,
                captionTemplate,
                addedBy: interaction.user.id,
                attachmentUrl: attachment.url,
            });

            await InteractionHelper.safeEditReply(interaction, {
                content: `✅ Đã thêm biểu cảm **${name}**. Dùng \`/tlee\` để thử ngay.`,
            });
        } catch (error) {
            await InteractionHelper.safeEditReply(interaction, {
                content: `❌ Thêm thất bại: ${error.message}`,
            });
        }
    },
};
