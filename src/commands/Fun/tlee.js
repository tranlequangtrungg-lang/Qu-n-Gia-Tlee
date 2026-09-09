import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { listExpressions, getExpression, getFreshAttachmentUrl, buildCaption, userOwnsExpression } from '../../services/bieuCamService.js';

function buildPreviewEmbed(expression, imageUrl, selectedTargets) {
    const targetLine = selectedTargets.length > 0
        ? `🎯 Đang tag: ${selectedTargets.map((id) => `<@${id}>`).join(', ')}`
        : '🎯 Chưa chọn ai (có thể bỏ trống)';

    return new EmbedBuilder()
        .setTitle(`✨ ${expression.name}`)
        .setDescription(`${expression.description}\n\n${targetLine}`)
        .setImage(imageUrl)
        .setColor('#f39c12');
}

export default {
    data: new SlashCommandBuilder()
        .setName('tlee')
        .setDescription('Gửi 1 biểu cảm vui cho ai đó')
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        const expressions = await listExpressions(client, interaction.guildId);
        if (expressions.length === 0) {
            await InteractionHelper.safeEditReply(interaction, { content: 'Server chưa có biểu cảm nào. Nhờ admin dùng `/tleethanhtra them` để thêm nhé.' });
            return;
        }

        // Chỉ hiện biểu cảm miễn phí hoặc đã mua — biểu cảm trả phí chưa mua
        // được lọc bỏ khỏi danh sách, hướng người dùng qua /cuahangtlee.
        const usableExpressions = [];
        for (const e of expressions) {
            const owned = await userOwnsExpression(client, interaction.guildId, interaction.user.id, e);
            if (owned) usableExpressions.push(e);
        }

        if (usableExpressions.length === 0) {
            await InteractionHelper.safeEditReply(interaction, {
                content: 'Bạn chưa sở hữu biểu cảm nào cả. Dùng `/cuahangtlee` để xem và mua nhé!',
            });
            return;
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('tlee_pick')
            .setPlaceholder('Chọn 1 biểu cảm...')
            .addOptions(
                usableExpressions.slice(0, 25).map((e) => ({
                    label: e.name,
                    description: e.description.slice(0, 100),
                    value: e.name,
                })),
            );

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('🎭 Chọn biểu cảm').setColor('#3498db')],
            components: [new ActionRowBuilder().addComponents(selectMenu)],
        });

        const message = await interaction.fetchReply().catch(() => null);
        if (!message) return;

        const pickInteraction = await message
            .awaitMessageComponent({
                filter: (i) => i.user.id === interaction.user.id,
                componentType: ComponentType.StringSelect,
                time: 60_000,
            })
            .catch(() => null);

        if (!pickInteraction) {
            await InteractionHelper.safeEditReply(interaction, { content: '⌛ Hết thời gian chọn, thử lại nhé.', embeds: [], components: [] });
            return;
        }

        const expressionName = pickInteraction.values[0];
        const expression = await getExpression(client, interaction.guildId, expressionName);
        const imageUrl = expression ? await getFreshAttachmentUrl(client, expression) : null;

        if (!expression || !imageUrl) {
            await pickInteraction.update({ content: '❌ Biểu cảm này bị lỗi (có thể đã bị xoá khỏi kho lưu trữ). Báo admin nhé.', embeds: [], components: [] });
            return;
        }

        let selectedTargets = [];

        const userSelectRow = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('tlee_targets')
                .setPlaceholder('Chọn người muốn tag (không bắt buộc)')
                .setMinValues(0)
                .setMaxValues(10),
        );
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tlee_send').setLabel('Gửi').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('tlee_cancel').setLabel('Huỷ').setStyle(ButtonStyle.Secondary),
        );

        await pickInteraction.update({
            embeds: [buildPreviewEmbed(expression, imageUrl, selectedTargets)],
            components: [userSelectRow, buttonRow],
        });

        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 120_000,
        });

        collector.on('collect', async (i) => {
            if (i.customId === 'tlee_targets') {
                selectedTargets = i.values;
                await i.update({
                    embeds: [buildPreviewEmbed(expression, imageUrl, selectedTargets)],
                    components: [userSelectRow, buttonRow],
                });
                return;
            }

            if (i.customId === 'tlee_cancel') {
                await i.update({ content: '❌ Đã huỷ.', embeds: [], components: [] });
                collector.stop();
                return;
            }

            if (i.customId === 'tlee_send') {
                const caption = buildCaption(expression, interaction.user.id, selectedTargets);
                await interaction.channel.send({
                    content: caption,
                    files: [{ attachment: imageUrl, name: `${expression.name}.gif` }],
                });
                await i.update({ content: '✅ Đã gửi!', embeds: [], components: [] });
                collector.stop();
            }
        });

        collector.on('end', async (_collected, reason) => {
            if (reason === 'time') {
                await InteractionHelper.safeEditReply(interaction, { content: '⌛ Hết thời gian, thử lại nhé.', embeds: [], components: [] }).catch(() => null);
            }
        });
    },
};
