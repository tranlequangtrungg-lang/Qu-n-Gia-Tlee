import { MessageFlags } from 'discord.js';
import { placeBet, MIN_BET, MAX_BET } from '../../utils/casinoTable.js';

export default {
    name: 'taixiu_amount',
    async execute(interaction, client, args) {
        const [side, channelId] = args;
        const raw = interaction.fields.getTextInputValue('amount');
        const amount = parseInt(raw.replace(/[^0-9]/g, ''), 10);

        if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
            return interaction.reply({
                content: `⚠️ Số tiền không hợp lệ (từ ${MIN_BET.toLocaleString()} đến ${MAX_BET.toLocaleString()}).`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const result = await placeBet(client, interaction.guildId, channelId, interaction.user, side, amount);

        if (!result.ok) {
            return interaction.reply({ content: `⚠️ ${result.message}`, flags: MessageFlags.Ephemeral });
        }

        const sideLabel = side === 'tai' ? 'TÀI' : 'XỈU';
        await interaction.reply({
            content: `✅ Đã cược **${sideLabel}** • **${amount.toLocaleString()} Bcoin**! Chờ mở bát nhé.`,
            flags: MessageFlags.Ephemeral,
        });
    }
};
