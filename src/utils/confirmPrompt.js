import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Hiện 2 nút Xác nhận / Hủy dưới 1 embed, đợi người dùng bấm, trả về true/false.
 * Yêu cầu: interaction đã được defer trước đó (dùng editReply).
 */
export async function requestConfirmation(interaction, {
    embed,
    confirmLabel = 'Xác nhận',
    cancelLabel = 'Hủy',
    timeoutMs = 30000,
} = {}) {
    const confirmId = `confirm_${interaction.id}`;
    const cancelId = `cancel_${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel(cancelLabel).setStyle(ButtonStyle.Secondary),
    );

    const message = await interaction.editReply({ embeds: [embed], components: [row] });

    try {
        const clicked = await message.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
            time: timeoutMs,
        });

        await clicked.deferUpdate();
        return clicked.customId === confirmId;
    } catch {
        // Hết thời gian chờ hoặc lỗi khác -> coi như hủy, gỡ nút đi
        await interaction.editReply({ components: [] }).catch(() => {});
        return false;
    }
}
