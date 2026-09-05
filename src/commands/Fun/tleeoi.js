// FILE MỚI → paste vào: src/commands/Fun/tleeoi.js
//
// Bảng điều khiển persona, chỉ admin thấy và thao tác (ephemeral).
// Cũng export `startPersonaPanel` để /tleelist.js dùng chung, mở thẳng vào
// đúng màn "Quản lý phòng" mà không phải viết lại toàn bộ collector.

import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { PERSONA_ACTIONS } from '../../config/personaActions.js';
import {
    listPersonas,
    getPersona,
    createPersona,
    deletePersona,
    setRooms,
    setFreeRoam,
    assignAction,
    unassignAction,
    listActionAssignments,
} from '../../services/personaService.js';

const IDS = {
    MAIN_ADD: 'po_main_add',
    MAIN_REMOVE: 'po_main_remove',
    MAIN_ROOMS: 'po_main_rooms',
    MAIN_ASSIGN: 'po_main_assign',
    BACK: 'po_back',

    REMOVE_SELECT: 'po_remove_select',
    REMOVE_CANCEL: 'po_remove_cancel',

    ROOMS_PERSONA_SELECT: 'po_rooms_persona_select',
    ROOMS_CHANNEL_SELECT: 'po_rooms_channel_select',
    ROOMS_FREEROAM_TOGGLE: 'po_rooms_freeroam_toggle',
    ROOMS_BACK: 'po_rooms_back',

    ASSIGN_ACTION_SELECT: 'po_assign_action_select',
    ASSIGN_PERSONA_SELECT: 'po_assign_persona_select',
    ASSIGN_BACK: 'po_assign_back',
};

// ============ Builders ============

function buildMainPanel(personas) {
    const embed = new EmbedBuilder()
        .setTitle('🎭 Bảng điều khiển Tính Cách')
        .setColor('#9b59b6')
        .setDescription(
            personas.length > 0
                ? personas.map((p) => `**${p.name}** — ${p.freeRoam ? '🔓 Tự do mọi nơi' : `🔒 ${p.rooms.length} phòng`}`).join('\n')
                : 'Chưa có tính cách nào. Bấm **➕ Thêm tính cách** để bắt đầu.',
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.MAIN_ADD).setLabel('Thêm tính cách').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(IDS.MAIN_REMOVE).setLabel('Xoá tính cách').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(personas.length === 0),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.MAIN_ROOMS).setLabel('Quản lý phòng').setEmoji('🔑').setStyle(ButtonStyle.Primary).setDisabled(personas.length === 0),
        new ButtonBuilder().setCustomId(IDS.MAIN_ASSIGN).setLabel('Gán lệnh').setEmoji('🔗').setStyle(ButtonStyle.Primary).setDisabled(personas.length === 0),
    );

    return { embeds: [embed], components: [row1, row2] };
}

function buildRemovePanel(personas) {
    const embed = new EmbedBuilder().setTitle('🗑️ Xoá tính cách').setColor('#e74c3c').setDescription('Chọn tính cách muốn xoá.');
    const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.REMOVE_SELECT)
        .setPlaceholder('Chọn tính cách cần xoá...')
        .addOptions(personas.slice(0, 25).map((p) => ({ label: p.name, value: p.key })));

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(IDS.REMOVE_CANCEL).setLabel('Huỷ').setStyle(ButtonStyle.Secondary)),
        ],
    };
}

function buildAddModal() {
    return new ModalBuilder()
        .setCustomId('po_add_modal')
        .setTitle('➕ Thêm tính cách mới')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('po_add_name')
                    .setLabel('Tên tính cách (vd: Thần Bài Tlee)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(32)
                    .setRequired(true),
            ),
        );
}

function buildRoomsPersonaSelectPanel(personas) {
    const embed = new EmbedBuilder()
        .setTitle('🔑 Quản lý phòng')
        .setColor('#3498db')
        .setDescription(
            personas.map((p) => `**${p.name}** — ${p.freeRoam ? '🔓 Tự do mọi nơi' : p.rooms.length > 0 ? p.rooms.map((id) => `<#${id}>`).join(', ') : '🔒 Chưa có phòng nào'}`).join('\n\n'),
        );
    const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.ROOMS_PERSONA_SELECT)
        .setPlaceholder('Chọn tính cách muốn chỉnh phòng...')
        .addOptions(personas.slice(0, 25).map((p) => ({ label: p.name, value: p.key })));

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(IDS.ROOMS_BACK).setLabel('Đóng').setStyle(ButtonStyle.Secondary)),
        ],
    };
}

function buildRoomEditorPanel(persona) {
    const embed = new EmbedBuilder()
        .setTitle(`🔑 Phòng của ${persona.name}`)
        .setColor('#3498db')
        .setDescription(
            persona.freeRoam
                ? '🔓 Đang **tự do đi lại** — hoạt động ở mọi kênh, bỏ qua danh sách phòng bên dưới.'
                : persona.rooms.length > 0
                    ? `🔒 Đang được phép ở: ${persona.rooms.map((id) => `<#${id}>`).join(', ')}`
                    : '🔒 Chưa có phòng nào — persona này sẽ không hiện tên ở bất kỳ đâu cho tới khi được cấp phòng.',
        );

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(IDS.ROOMS_CHANNEL_SELECT)
        .setPlaceholder('Tick/bỏ tick phòng cho tính cách này...')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
        .setMinValues(0)
        .setMaxValues(25)
        .setDefaultChannels(persona.rooms.slice(0, 25));

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(IDS.ROOMS_FREEROAM_TOGGLE)
            .setLabel(persona.freeRoam ? '🔒 Khoá lại' : '🔓 Tự do')
            .setStyle(persona.freeRoam ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(IDS.ROOMS_BACK).setLabel('Quay lại').setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), buttonRow] };
}

function buildAssignActionPanel(assignments, personas) {
    const embed = new EmbedBuilder()
        .setTitle('🔗 Gán lệnh')
        .setColor('#2ecc71')
        .setDescription(
            Object.entries(PERSONA_ACTIONS)
                .map(([key, label]) => {
                    const assignedKey = assignments[key];
                    const persona = assignedKey ? personas.find((p) => p.key === assignedKey) : null;
                    return `**${label}** → ${persona ? persona.name : '_chưa gán_'}`;
                })
                .join('\n'),
        );
    const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.ASSIGN_ACTION_SELECT)
        .setPlaceholder('Chọn hành động muốn gán tính cách...')
        .addOptions(Object.entries(PERSONA_ACTIONS).map(([key, label]) => ({ label, value: key })));

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(IDS.ASSIGN_BACK).setLabel('Đóng').setStyle(ButtonStyle.Secondary)),
        ],
    };
}

function buildAssignPersonaPanel(actionKey, personas) {
    const embed = new EmbedBuilder()
        .setTitle(`🔗 ${PERSONA_ACTIONS[actionKey]}`)
        .setColor('#2ecc71')
        .setDescription('Chọn tính cách sẽ đứng tên cho hành động này.');
    const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.ASSIGN_PERSONA_SELECT)
        .setPlaceholder('Chọn tính cách...')
        .addOptions([
            { label: '— Bỏ gán (dùng tên bot gốc) —', value: '__none__' },
            ...personas.slice(0, 24).map((p) => ({ label: p.name, value: p.key })),
        ]);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(IDS.ASSIGN_BACK).setLabel('Huỷ').setStyle(ButtonStyle.Secondary)),
        ],
    };
}

// ============ Flow chính ============

export async function startPersonaPanel(interaction, client, { initialView = 'main' } = {}) {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    if (!isAdmin) {
        return InteractionHelper.safeEditReply
            ? interaction.reply({ content: '❌ Chỉ admin mới dùng được lệnh này.', flags: MessageFlags.Ephemeral })
            : null;
    }

    const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferred) return;

    const guildId = interaction.guildId;
    let personas = await listPersonas(client, guildId);
    let activePersonaKey = null; // đang chỉnh phòng cho persona nào
    let activeActionKey = null; // đang gán tính cách cho hành động nào

    const initialPanel = initialView === 'rooms' && personas.length > 0
        ? buildRoomsPersonaSelectPanel(personas)
        : buildMainPanel(personas);
    await InteractionHelper.safeEditReply(interaction, initialPanel);

    const message = await interaction.fetchReply().catch(() => null);
    if (!message) return;

    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        idle: 180_000,
        time: 900_000,
    });

    collector.on('collect', async (i) => {
        try {
            // ---- Main ----
            if (i.customId === IDS.MAIN_ROOMS || i.customId === IDS.ROOMS_BACK && initialView === 'main') {
                personas = await listPersonas(client, guildId);
                await i.update(personas.length > 0 ? buildRoomsPersonaSelectPanel(personas) : buildMainPanel(personas));
                return;
            }

            if (i.customId === IDS.BACK) {
                personas = await listPersonas(client, guildId);
                await i.update(buildMainPanel(personas));
                return;
            }

            // Nếu mở trực tiếp ở view "rooms" (từ /tleelist) thì nút "Đóng" đóng luôn bảng.
            if (i.customId === IDS.ROOMS_BACK && initialView === 'rooms' && !activePersonaKey) {
                await i.update({ content: '✅ Đã đóng.', embeds: [], components: [] });
                return;
            }

            // ---- Xoá tính cách ----
            if (i.customId === IDS.MAIN_REMOVE) {
                await i.update(buildRemovePanel(personas));
                return;
            }
            if (i.customId === IDS.REMOVE_SELECT) {
                const key = i.values[0];
                await deletePersona(client, guildId, key);
                personas = await listPersonas(client, guildId);
                await i.update(buildMainPanel(personas));
                return;
            }
            if (i.customId === IDS.REMOVE_CANCEL) {
                await i.update(buildMainPanel(personas));
                return;
            }

            // ---- Thêm tính cách ----
            if (i.customId === IDS.MAIN_ADD) {
                await i.showModal(buildAddModal());
                const submitted = await i
                    .awaitModalSubmit({ filter: (m) => m.customId === 'po_add_modal' && m.user.id === interaction.user.id, time: 180_000 })
                    .catch(() => null);
                if (!submitted) return;

                const name = submitted.fields.getTextInputValue('po_add_name').trim();

                await submitted.reply({
                    content: `📎 Gửi **1 ảnh đại diện** cho tính cách **${name}** vào kênh này trong vòng **60 giây** (bắt buộc phải có ảnh mới tạo xong).`,
                    flags: MessageFlags.Ephemeral,
                });

                const uploaded = await interaction.channel
                    .awaitMessages({ filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0, max: 1, time: 60_000 })
                    .then((c) => c.first())
                    .catch(() => null);

                if (!uploaded) {
                    await submitted.editReply({ content: '⌛ Không nhận được ảnh trong 60 giây, đã huỷ tạo tính cách.' });
                    return;
                }
                const attachment = uploaded.attachments.first();
                if (!attachment.contentType?.startsWith('image/')) {
                    await submitted.editReply({ content: '❌ File phải là ảnh. Đã huỷ, thử lại nhé.' });
                    await uploaded.delete().catch(() => {});
                    return;
                }

                try {
                    await createPersona(client, guildId, { name, avatarUrl: attachment.url, createdBy: interaction.user.id });
                    await submitted.editReply({ content: `✅ Đã tạo tính cách **${name}**! Vào "Quản lý phòng" để cấp quyền hoạt động.` });
                } catch (error) {
                    await submitted.editReply({ content: `❌ Tạo thất bại: ${error.message}` });
                }
                await uploaded.delete().catch(() => {});

                personas = await listPersonas(client, guildId);
                await InteractionHelper.safeEditReply(interaction, buildMainPanel(personas));
                return;
            }

            // ---- Quản lý phòng: chọn persona ----
            if (i.customId === IDS.ROOMS_PERSONA_SELECT) {
                activePersonaKey = i.values[0];
                const persona = await getPersona(client, guildId, activePersonaKey);
                await i.update(buildRoomEditorPanel(persona));
                return;
            }

            if (i.customId === IDS.ROOMS_CHANNEL_SELECT) {
                const persona = await setRooms(client, guildId, activePersonaKey, i.values);
                await i.update(buildRoomEditorPanel(persona));
                return;
            }

            if (i.customId === IDS.ROOMS_FREEROAM_TOGGLE) {
                const current = await getPersona(client, guildId, activePersonaKey);
                const persona = await setFreeRoam(client, guildId, activePersonaKey, !current.freeRoam);
                await i.update(buildRoomEditorPanel(persona));
                return;
            }

            // Quay lại từ room-editor -> về danh sách chọn persona
            if (i.customId === IDS.ROOMS_BACK && activePersonaKey) {
                activePersonaKey = null;
                personas = await listPersonas(client, guildId);
                await i.update(buildRoomsPersonaSelectPanel(personas));
                return;
            }

            // ---- Gán lệnh ----
            if (i.customId === IDS.MAIN_ASSIGN) {
                const assignments = await listActionAssignments(client, guildId);
                await i.update(buildAssignActionPanel(assignments, personas));
                return;
            }
            if (i.customId === IDS.ASSIGN_ACTION_SELECT) {
                activeActionKey = i.values[0];
                await i.update(buildAssignPersonaPanel(activeActionKey, personas));
                return;
            }
            if (i.customId === IDS.ASSIGN_PERSONA_SELECT) {
                const value = i.values[0];
                if (value === '__none__') {
                    await unassignAction(client, guildId, activeActionKey);
                } else {
                    await assignAction(client, guildId, activeActionKey, value);
                }
                const assignments = await listActionAssignments(client, guildId);
                await i.update(buildAssignActionPanel(assignments, personas));
                return;
            }
            if (i.customId === IDS.ASSIGN_BACK) {
                const assignments = await listActionAssignments(client, guildId);
                await i.update(buildAssignActionPanel(assignments, personas));
            }
        } catch (error) {
            await i.update({ content: `❌ Có lỗi xảy ra: ${error.message}`, embeds: [], components: [] }).catch(() => {});
        }
    });

    collector.on('end', async (_collected, reason) => {
        if (reason === 'time' || reason === 'idle') {
            await InteractionHelper.safeEditReply(interaction, { content: '⌛ Bảng đã hết hạn, gõ lại lệnh nhé.', embeds: [], components: [] }).catch(() => {});
        }
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('tleeoi')
        .setDescription('[Admin] Bảng điều khiển tính cách Tlee')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'fun',
    async execute(interaction, config, client) {
        await startPersonaPanel(interaction, client, { initialView: 'main' });
    },
};
