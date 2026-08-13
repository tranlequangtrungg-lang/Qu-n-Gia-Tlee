import { MessageFlags } from 'discord.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { getActiveTable } from '../../utils/casinoTable.js';

export default {
    name: 'taixiu_bet',
    async execute(interaction, client, args) {
        const [side, channelId] = args;

        const table = await getActiveTable(client, channelId);
        if (!table || table.status !== 'open' || Date.now() >= table.closesAt) {
            return interaction.reply({
                content: '🔒 Bàn đã đóng cược, chờ ván sau nhé!',
                flags: MessageFlags.Ephemeral,
            });
        }
        if (table.participants[interaction.user.id]) {
            return interaction.reply({
                content: '✋ Bạn đã đặt cược trong ván này rồi!',
                flags: MessageFlags.Ephemeral,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`taixiu_amount:${side}:${channelId}`)
            .setTitle(side === 'tai' ? 'Cược TÀI' : 'Cược XỈU');

        const amountInput = new TextInputBuilder()
            .setCustomId('amount')
            .setLabel('Số Bcoin muốn cược')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ví dụ: 1000')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

        await interaction.showModal(modal);
    }
};
