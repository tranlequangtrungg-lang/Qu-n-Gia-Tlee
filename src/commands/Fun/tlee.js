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
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    addExpression,
    removeExpression,
    listExpressions,
    getExpression,
    getFreshAttachmentUrl,
    buildCaption,
} from '../../services/bieuCamService.js';

const ADD_BUTTON_ID = 'tlee_admin_add';
const REMOVE_BUTTON_ID = 'tlee_admin_remove';
const PICK_SELECT_ID = 'tlee_pick';
const TARGET_SELECT_ID = 'tlee_targets';
const SEND_BUTTON_ID = 'tlee_send';
const CANCEL_BUTTON_ID = 'tlee_cancel';
const BACK_BUTTON_ID = 'tlee_back';
const REMOVE_PICK_SELECT_ID = 'tlee_remove_pick';
const REMOVE_CANCEL_BUTTON_ID = 'tlee_remove_cancel';

// ============ Các hàm dựng giao diện (embed + nút) ============

function buildMainPanel(expressions, isAdmin) {
    const embed = new EmbedBuilder()
        .setTitle('🎭 Bảng Biểu Cảm Tlee')
        .setColor('#3498db')
        .setDescription(
            expressions.length > 0
                ? 'Chọn 1 biểu cảm bên dưới để gửi.'
                : 'Chưa có biểu cảm nào được thêm.' + (isAdmin ? ' Bấm **➕ Thêm biểu cảm** để bắt đầu.' : ' Nhờ admin thêm nhé.'),
        );

    const components = [];

    if (expressions.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(PICK_SELECT_ID)
            .setPlaceholder('Chọn 1 biểu cảm...')
            .addOptions(
                expressions.slice(0, 25).map((e) => ({
                    label: e.name,
                    description: (e.description || '').slice(0, 100) || undefined,
                    value: e.name,
                })),
            );
        components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    if (isAdmin) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(ADD_BUTTON_ID).setLabel('Thêm biểu cảm').setEmoji('➕').setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(REMOVE_BUTTON_ID)
                    .setLabel('Xoá biểu cảm')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(expressions.length === 0),
            ),
        );
    }

    return { embeds: [embed], components };
}

function buildPreviewPanel(expression, imageUrl, selectedTargets) {
    const targetLine = selectedTargets.length > 0
        ? `🎯 Đang tag: ${selectedTargets.map((id) => `<@${id}>`).join(', ')}`
        : '🎯 Chưa chọn ai (có thể bỏ trống)';

    const embed = new EmbedBuilder()
        .setTitle(`✨ ${expression.name}`)
        .setDescription(`${expression.description || ''}\n\n${targetLine}`)
        .setImage(imageUrl)
        .setColor('#f39c12');

    const userSelectRow = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(TARGET_SELECT_ID)
            .setPlaceholder('Chọn người muốn tag (không bắt buộc)')
            .setMinValues(0)
            .setMaxValues(10),
    );
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SEND_BUTTON_ID).setLabel('Gửi').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CANCEL_BUTTON_ID).setLabel('Huỷ').setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [userSelectRow, buttonRow] };
}

function buildRemovePanel(expressions) {
    const embed = new EmbedBuilder()
        .setTitle('🗑️ Xoá biểu cảm')
        .setColor('#e74c3c')
        .setDescription('Chọn biểu cảm muốn xoá.');

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(REMOVE_PICK_SELECT_ID)
        .setPlaceholder('Chọn biểu cảm cần xoá...')
        .addOptions(
            expressions.slice(0, 25).map((e) => ({
                label: e.name,
                description: (e.description || '').slice(0, 100) || undefined,
                value: e.name,
            })),
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(selectMenu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(REMOVE_CANCEL_BUTTON_ID).setLabel('Huỷ').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

function buildAddModal() {
    return new ModalBuilder()
        .setCustomId('tlee_add_modal')
        .setTitle('➕ Thêm biểu cảm mới')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('add_name')
                    .setLabel('Tên biểu cảm (vd: khinh, cảm ơn)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(32)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('add_description')
                    .setLabel('Mô tả ngắn (hiện trong danh sách chọn)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('add_caption')
                    .setLabel('Caption tuỳ chỉnh (bỏ trống = mặc định)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Dùng {nguoi_dung} và {muc_tieu}, vd: {nguoi_dung} khinh {muc_tieu} ra mặt!')
                    .setMaxLength(200)
                    .setRequired(false),
            ),
        );
}

// ============ Lệnh chính ============

export default {
    data: new SlashCommandBuilder()
        .setName('tlee')
        .setDescription('Mở bảng biểu cảm — gửi 1 biểu cảm vui cho ai đó')
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        let expressions = await listExpressions(client, interaction.guildId);
        await InteractionHelper.safeEditReply(interaction, buildMainPanel(expressions, isAdmin));

        const message = await interaction.fetchReply().catch(() => null);
        if (!message) return;

        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            idle: 120_000,
            time: 600_000,
        });

        // State dùng chung giữa các bước chọn biểu cảm -> chọn người tag -> gửi.
        let activeExpression = null;
        let activeImageUrl = null;
        let selectedTargets = [];

        collector.on('collect', async (i) => {
            try {
                // ---- User thường: chọn biểu cảm để xem trước ----
                if (i.customId === PICK_SELECT_ID) {
                    const name = i.values[0];
                    const expression = await getExpression(client, interaction.guildId, name);
                    const imageUrl = expression ? await getFreshAttachmentUrl(client, expression) : null;

                    if (!expression || !imageUrl) {
                        await i.update({ content: '❌ Biểu cảm này bị lỗi (có thể đã bị xoá khỏi kho lưu trữ). Báo admin nhé.', embeds: [], components: [] });
                        return;
                    }

                    activeExpression = expression;
                    activeImageUrl = imageUrl;
                    selectedTargets = [];
                    await i.update(buildPreviewPanel(expression, imageUrl, selectedTargets));
                    return;
                }

                if (i.customId === TARGET_SELECT_ID) {
                    selectedTargets = i.values;
                    await i.update(buildPreviewPanel(activeExpression, activeImageUrl, selectedTargets));
                    return;
                }

                if (i.customId === SEND_BUTTON_ID) {
                    const caption = buildCaption(activeExpression, interaction.user.id, selectedTargets);
                    await interaction.channel.send({
                        content: caption,
                        files: [{ attachment: activeImageUrl, name: `${activeExpression.name}.gif` }],
                    });

                    const backRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(BACK_BUTTON_ID).setLabel('Quay lại bảng').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
                    );
                    await i.update({ content: '✅ Đã gửi!', embeds: [], components: [backRow] });
                    return;
                }

                if (i.customId === CANCEL_BUTTON_ID || i.customId === BACK_BUTTON_ID) {
                    expressions = await listExpressions(client, interaction.guildId);
                    await i.update(buildMainPanel(expressions, isAdmin));
                    return;
                }

                // ---- Admin: xoá biểu cảm ----
                if (i.customId === REMOVE_BUTTON_ID) {
                    if (expressions.length === 0) {
                        await i.deferUpdate();
                        return;
                    }
                    await i.update(buildRemovePanel(expressions));
                    return;
                }

                if (i.customId === REMOVE_PICK_SELECT_ID) {
                    const name = i.values[0];
                    await removeExpression(client, interaction.guildId, name);
                    expressions = await listExpressions(client, interaction.guildId);
                    await i.update({
                        embeds: [new EmbedBuilder().setTitle('✅ Đã xoá').setDescription(`Đã xoá biểu cảm **${name}**.`).setColor('#2ecc71')],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(BACK_BUTTON_ID).setLabel('Quay lại bảng').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
                            ),
                        ],
                    });
                    return;
                }

                if (i.customId === REMOVE_CANCEL_BUTTON_ID) {
                    await i.update(buildMainPanel(expressions, isAdmin));
                    return;
                }

                // ---- Admin: thêm biểu cảm mới ----
                if (i.customId === ADD_BUTTON_ID) {
                    // showModal phải là phản hồi DUY NHẤT cho interaction này —
                    // không được update/defer trước đó.
                    await i.showModal(buildAddModal());

                    const submitted = await i
                        .awaitModalSubmit({
                            filter: (m) => m.customId === 'tlee_add_modal' && m.user.id === interaction.user.id,
                            time: 180_000,
                        })
                        .catch(() => null);

                    if (!submitted) return;

                    const name = submitted.fields.getTextInputValue('add_name').trim();
                    const description = submitted.fields.getTextInputValue('add_description').trim();
                    const captionTemplate = submitted.fields.getTextInputValue('add_caption')?.trim() || null;

                    await submitted.reply({
                        content: `📎 Giờ bạn gửi **1 tin nhắn có đính kèm gif/ảnh** vào kênh này trong vòng **60 giây** để hoàn tất thêm biểu cảm **${name}**.`,
                        flags: MessageFlags.Ephemeral,
                    });

                    const uploaded = await interaction.channel
                        .awaitMessages({
                            filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
                            max: 1,
                            time: 60_000,
                        })
                        .then((collected) => collected.first())
                        .catch(() => null);

                    if (!uploaded) {
                        await submitted.editReply({ content: '⌛ Không nhận được ảnh/gif nào trong 60 giây, huỷ thêm biểu cảm.' });
                        return;
                    }

                    const attachment = uploaded.attachments.first();
                    if (!attachment.contentType?.startsWith('image/')) {
                        await submitted.editReply({ content: '❌ File phải là ảnh hoặc gif. Đã huỷ, thử lại nhé.' });
                        await uploaded.delete().catch(() => {});
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
                        await submitted.editReply({ content: `✅ Đã thêm biểu cảm **${name}**!` });
                    } catch (error) {
                        await submitted.editReply({ content: `❌ Thêm thất bại: ${error.message}` });
                    }

                    await uploaded.delete().catch(() => {});

                    expressions = await listExpressions(client, interaction.guildId);
                    await InteractionHelper.safeEditReply(interaction, buildMainPanel(expressions, isAdmin));
                }
            } catch (error) {
                await i.update({ content: `❌ Có lỗi xảy ra: ${error.message}`, embeds: [], components: [] }).catch(() => {});
            }
        });

        collector.on('end', async (_collected, reason) => {
            if (reason === 'time' || reason === 'idle') {
                await InteractionHelper.safeEditReply(interaction, { content: '⌛ Bảng đã hết hạn, gõ `/tlee` lại nhé.', embeds: [], components: [] }).catch(() => {});
            }
        });
    },
};
