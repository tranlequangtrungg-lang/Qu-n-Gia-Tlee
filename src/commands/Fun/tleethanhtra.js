import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { addExpression, removeExpression, setExpressionPrice, getExpression, formatCurrency } from '../../services/bieuCamService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tleethanhtra')
        .setDescription('[Admin] Quản lý biểu cảm cho /tlee và /cuahangtlee')
        .addSubcommand((sub) =>
            sub
                .setName('them')
                .setDescription('Thêm 1 biểu cảm mới')
                .addStringOption((o) => o.setName('ten').setDescription('Tên biểu cảm (vd: khinh, cảm ơn)').setRequired(true))
                .addStringOption((o) => o.setName('mo_ta').setDescription('Mô tả ngắn hiện trong danh sách chọn').setRequired(true))
                .addAttachmentOption((o) => o.setName('file').setDescription('Gif/ảnh động cho biểu cảm này').setRequired(true))
                .addStringOption((o) => o.setName('caption').setDescription('Caption tuỳ chỉnh, dùng {nguoi_dung} và {muc_tieu} (bỏ trống = mẫu mặc định)'))
                .addIntegerOption((o) => o.setName('gia').setDescription('Giá riêng (Bcoin). Bỏ trống = dùng giá mặc định chung. Nhập 0 = miễn phí.').setMinValue(0)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('xoa')
                .setDescription('Xoá 1 biểu cảm')
                .addStringOption((o) => o.setName('ten').setDescription('Tên biểu cảm cần xoá').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('sua-gia')
                .setDescription('Đổi giá 1 biểu cảm đã có sẵn')
                .addStringOption((o) => o.setName('ten').setDescription('Tên biểu cảm cần đổi giá').setRequired(true))
                .addIntegerOption((o) => o.setName('gia_moi').setDescription('Giá mới (Bcoin). 0 = miễn phí. Bỏ trống = quay về dùng giá mặc định chung.').setMinValue(0)),
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'them') {
            const name = interaction.options.getString('ten', true).trim();
            const description = interaction.options.getString('mo_ta', true).trim();
            const captionTemplate = interaction.options.getString('caption')?.trim() || null;
            const price = interaction.options.getInteger('gia');
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
                    price,
                });

                const priceNote = price === null || price === undefined
                    ? '(dùng giá mặc định chung)'
                    : price === 0
                        ? '(miễn phí)'
                        : `(giá riêng: ${formatCurrency(price)})`;

                await InteractionHelper.safeEditReply(interaction, {
                    content: `✅ Đã thêm biểu cảm **${name}** ${priceNote}. Dùng \`/tlee\` để thử ngay.`,
                });
            } catch (error) {
                await InteractionHelper.safeEditReply(interaction, { content: `❌ Thêm thất bại: ${error.message}` });
            }
            return;
        }

        if (subcommand === 'xoa') {
            const name = interaction.options.getString('ten', true).trim();
            const removed = await removeExpression(client, interaction.guildId, name);
            await InteractionHelper.safeEditReply(interaction, {
                content: removed ? `✅ Đã xoá biểu cảm **${name}**.` : `❌ Không tìm thấy biểu cảm **${name}**.`,
            });
            return;
        }

        if (subcommand === 'sua-gia') {
            const name = interaction.options.getString('ten', true).trim();
            const newPrice = interaction.options.getInteger('gia_moi');

            const existing = await getExpression(client, interaction.guildId, name);
            if (!existing) {
                await InteractionHelper.safeEditReply(interaction, { content: `❌ Không tìm thấy biểu cảm **${name}**.` });
                return;
            }

            await setExpressionPrice(client, interaction.guildId, name, newPrice);

            const priceNote = newPrice === null || newPrice === undefined
                ? 'quay về dùng giá mặc định chung'
                : newPrice === 0
                    ? 'miễn phí'
                    : formatCurrency(newPrice);

            await InteractionHelper.safeEditReply(interaction, { content: `✅ Đã đổi giá **${name}** thành: ${priceNote}.` });
        }
    },
};
