import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getLatestOpenMatch, getMatch, placeBet } from '../../services/matchBettingService.js';

function buildMatchEmbed(match) {
    const lines = [
        `${match.flagA} **${match.teamA}**   —   ${match.flagB} **${match.teamB}**`,
    ];
    if (match.matchTime) lines.push(`🕐 ${match.matchTime}`);
    if (match.previousResult) lines.push(`\n📋 ${match.previousResult}`);

    return new EmbedBuilder()
        .setTitle(`⚽ ${match.tournament.toUpperCase()}`)
        .setColor('#0a2540')
        .setDescription(lines.join('\n'))
        .addFields(
            { name: `${match.teamA} thắng`, value: `x${match.oddsThang.a}`, inline: true },
            { name: 'Hoà', value: `x${match.oddsThang.hoa}`, inline: true },
            { name: `${match.teamB} thắng`, value: `x${match.oddsThang.b}`, inline: true },
            { name: 'Đúng tỉ số', value: `x${match.oddsTiSo}`, inline: false },
        )
        .setFooter({ text: `Mã trận: ${match.id} · Bấm nút bên dưới để đặt cược Bcoin` });
}

function buildBetButtons(match) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bongda_thang_a_${match.id}`)
            .setLabel(`${match.teamA} thắng · x${match.oddsThang.a}`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`bongda_thang_hoa_${match.id}`)
            .setLabel(`Hoà · x${match.oddsThang.hoa}`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`bongda_thang_b_${match.id}`)
            .setLabel(`${match.teamB} thắng · x${match.oddsThang.b}`)
            .setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bongda_tiso_${match.id}`)
            .setLabel(`🎯 Đoán đúng tỉ số · x${match.oddsTiSo}`)
            .setStyle(ButtonStyle.Success),
    );
    return [row1, row2];
}

async function handleMoneylineClick(buttonInteraction, matchId, pick, client) {
    const modal = new ModalBuilder()
        .setCustomId(`bongda_modal_thang_${matchId}_${pick}`)
        .setTitle('Đặt cược Bcoin');

    const amountInput = new TextInputBuilder()
        .setCustomId('so_bcoin')
        .setLabel('Số Bcoin muốn cược')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('5000')
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
    await buttonInteraction.showModal(modal);

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: (i) => i.customId === `bongda_modal_thang_${matchId}_${pick}` && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);
    if (!submitted) return;

    const rawAmount = submitted.fields.getTextInputValue('so_bcoin').trim();
    const amount = parseInt(rawAmount, 10);

    if (!Number.isInteger(amount) || amount <= 0) {
        await submitted.reply({ content: '❌ Số Bcoin không hợp lệ.', flags: MessageFlags.Ephemeral });
        return;
    }

    await finalizeBet(submitted, client, matchId, 'thang', pick, amount);
}

async function handleScoreClick(buttonInteraction, matchId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`bongda_modal_tiso_${matchId}`)
        .setTitle('Đoán đúng tỉ số');

    const scoreAInput = new TextInputBuilder()
        .setCustomId('diem_a')
        .setLabel('Số bàn đội A')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('2')
        .setRequired(true);
    const scoreBInput = new TextInputBuilder()
        .setCustomId('diem_b')
        .setLabel('Số bàn đội B')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1')
        .setRequired(true);
    const amountInput = new TextInputBuilder()
        .setCustomId('so_bcoin')
        .setLabel('Số Bcoin muốn cược')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('5000')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(scoreAInput),
        new ActionRowBuilder().addComponents(scoreBInput),
        new ActionRowBuilder().addComponents(amountInput),
    );
    await buttonInteraction.showModal(modal);

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: (i) => i.customId === `bongda_modal_tiso_${matchId}` && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);
    if (!submitted) return;

    const a = parseInt(submitted.fields.getTextInputValue('diem_a').trim(), 10);
    const b = parseInt(submitted.fields.getTextInputValue('diem_b').trim(), 10);
    const amount = parseInt(submitted.fields.getTextInputValue('so_bcoin').trim(), 10);

    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
        await submitted.reply({ content: '❌ Tỉ số không hợp lệ.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
        await submitted.reply({ content: '❌ Số Bcoin không hợp lệ.', flags: MessageFlags.Ephemeral });
        return;
    }

    await finalizeBet(submitted, client, matchId, 'tiso', { a, b }, amount);
}

async function finalizeBet(modalInteraction, client, matchId, type, pick, amount) {
    const match = await getMatch(client, modalInteraction.guildId, matchId);
    if (!match) {
        await modalInteraction.reply({ content: '❌ Không tìm thấy trận đấu.', flags: MessageFlags.Ephemeral });
        return;
    }

    const result = await placeBet(client, modalInteraction.guildId, modalInteraction.user.id, matchId, type, pick, amount);

    if (!result.ok) {
        const messages = {
            match_closed: '❌ Trận này đã đóng cược hoặc đã chốt kết quả.',
            already_bet: '❌ Bạn đã đặt cược cho trận này rồi — không thể đặt thêm hoặc sửa.',
            insufficient_funds: `❌ Bạn không đủ Bcoin (hiện có: ${result.available?.toLocaleString('vi-VN')}).`,
            insufficient_funds_with_tax: `❌ Không đủ Bcoin sau khi tính thuế vượt hạn mức cược ngày (cần: ${result.totalCharge?.toLocaleString('vi-VN')}, hiện có: ${result.available?.toLocaleString('vi-VN')}).`,
        };
        await modalInteraction.reply({ content: messages[result.reason] || '❌ Đặt cược thất bại.', flags: MessageFlags.Ephemeral });
        return;
    }

    const pickLabel = type === 'thang' ? { a: match.teamA, hoa: 'Hoà', b: match.teamB }[pick] : `${pick.a} - ${pick.b}`;
    const taxNote = result.tax > 0 ? ` (+${result.tax.toLocaleString('vi-VN')} thuế vượt hạn mức)` : '';

    await modalInteraction.reply({
        content: `✅ Đã đặt **${amount.toLocaleString('vi-VN')} Bcoin**${taxNote} cho **${match.teamA} vs ${match.teamB}** — dự đoán: **${pickLabel}**.`,
        flags: MessageFlags.Ephemeral,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('bongda')
        .setDescription('Hiện bảng cược cho trận đấu đang mở')
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const match = await getLatestOpenMatch(client, interaction.guildId);
        if (!match) {
            await InteractionHelper.safeEditReply(interaction, { content: 'Hiện không có trận đấu nào đang mở cược.' });
            return;
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [buildMatchEmbed(match)],
            components: buildBetButtons(match),
        });

        // Dùng fetchReply() để chắc chắn lấy đúng đối tượng Message thật —
        // trước đây dùng luôn giá trị trả về của safeEditReply nên collector
        // gắn nhầm chỗ, khiến nút bấm không bao giờ được lắng nghe.
        const message = await interaction.fetchReply().catch(() => null);
        if (!message) return;

        // Lắng nghe nút bấm ngay trên tin nhắn bảng cược — bất kỳ ai trong
        // kênh cũng bấm được, không chỉ người gõ /bongda. Lưu ý: nếu bot
        // khởi động lại (redeploy) trong lúc bảng đang mở, listener này mất
        // theo — chạy lại /bongda là có bảng mới hoạt động bình thường,
        // các cược đã đặt trước đó không bị ảnh hưởng gì.
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 7 * 24 * 60 * 60 * 1000,
        });

        collector.on('collect', async (buttonInteraction) => {
            try {
                const { customId } = buttonInteraction;
                if (customId === `bongda_thang_a_${match.id}`) {
                    await handleMoneylineClick(buttonInteraction, match.id, 'a', client);
                } else if (customId === `bongda_thang_hoa_${match.id}`) {
                    await handleMoneylineClick(buttonInteraction, match.id, 'hoa', client);
                } else if (customId === `bongda_thang_b_${match.id}`) {
                    await handleMoneylineClick(buttonInteraction, match.id, 'b', client);
                } else if (customId === `bongda_tiso_${match.id}`) {
                    await handleScoreClick(buttonInteraction, match.id, client);
                }
            } catch (error) {
                logger.error('[BONGDA] Lỗi xử lý nút cược:', error);
            }
        });
    },
};
