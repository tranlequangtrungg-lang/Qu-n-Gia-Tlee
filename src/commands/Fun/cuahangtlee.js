import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    listExpressions,
    getExpression,
    getEffectivePrice,
    isFree,
    userOwnsExpression,
    purchaseExpression,
    getFreshAttachmentUrl,
    formatCurrency,
} from '../../services/bieuCamService.js';

async function buildShopOptions(client, guildId, userId, expressions) {
    const options = [];
    for (const e of expressions.slice(0, 25)) {
        const price = await getEffectivePrice(client, guildId, e);
        const owned = await userOwnsExpression(client, guildId, userId, e);
        const status = isFree(price) ? 'Miễn phí' : owned ? '✅ Đã sở hữu' : formatCurrency(price);
        options.push({
            label: e.name,
            description: `${status} · ${e.description}`.slice(0, 100),
            value: e.name,
        });
    }
    return options;
}

function buildPreviewEmbed(expression, imageUrl, price, owned) {
    const priceLine = isFree(price)
        ? '💚 Miễn phí — dùng được ngay trong /tlee'
        : owned
            ? '✅ Bạn đã sở hữu biểu cảm này'
            : `💰 Giá: **${formatCurrency(price)}**`;

    return new EmbedBuilder()
        .setTitle(`🛒 ${expression.name}`)
        .setDescription(`${expression.description}\n\n${priceLine}`)
        .setImage(imageUrl)
        .setColor('#e67e22');
}

export default {
    data: new SlashCommandBuilder()
        .setName('cuahangtlee')
        .setDescription('Xem và mua biểu cảm cho /tlee')
        .setDMPermission(false),
    category: 'fun',
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        const expressions = await listExpressions(client, interaction.guildId);
        if (expressions.length === 0) {
            await InteractionHelper.safeEditReply(interaction, { content: 'Cửa hàng chưa có biểu cảm nào cả.' });
            return;
        }

        const options = await buildShopOptions(client, interaction.guildId, interaction.user.id, expressions);
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('cuahangtlee_pick')
            .setPlaceholder('Chọn 1 biểu cảm để xem...')
            .addOptions(options);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('🛒 Cửa Hàng Biểu Cảm').setColor('#3498db')],
            components: [new ActionRowBuilder().addComponents(selectMenu)],
        });

        const message = await interaction.fetchReply().catch(() => null);
        if (!message) return;

        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 120_000,
        });

        collector.on('collect', async (i) => {
            if (i.customId === 'cuahangtlee_pick') {
                const name = i.values[0];
                const expression = await getExpression(client, interaction.guildId, name);
                const imageUrl = expression ? await getFreshAttachmentUrl(client, expression) : null;

                if (!expression || !imageUrl) {
                    await i.update({ content: '❌ Biểu cảm này bị lỗi. Báo admin nhé.', embeds: [], components: [] });
                    return;
                }

                const price = await getEffectivePrice(client, interaction.guildId, expression);
                const owned = await userOwnsExpression(client, interaction.guildId, interaction.user.id, expression);

                const rows = [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('cuahangtlee_pick')
                        .setPlaceholder('Chọn biểu cảm khác...')
                        .addOptions(options),
                )];

                if (!isFree(price) && !owned) {
                    rows.push(new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`cuahangtlee_buy_${name}`).setLabel(`Mua — ${formatCurrency(price)}`).setStyle(ButtonStyle.Success),
                    ));
                }

                await i.update({ embeds: [buildPreviewEmbed(expression, imageUrl, price, owned)], components: rows });
                return;
            }

            if (i.customId.startsWith('cuahangtlee_buy_')) {
                const name = i.customId.replace('cuahangtlee_buy_', '');
                const expression = await getExpression(client, interaction.guildId, name);
                if (!expression) {
                    await i.reply({ content: '❌ Biểu cảm này không còn tồn tại.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const result = await purchaseExpression(client, interaction.guildId, interaction.user.id, expression);

                if (!result.ok) {
                    const messages = {
                        already_owned: '❌ Bạn đã sở hữu biểu cảm này rồi.',
                        already_free: '❌ Biểu cảm này đang miễn phí, không cần mua.',
                        insufficient_funds: `❌ Không đủ Bcoin (cần ${formatCurrency(result.price)}, hiện có ${formatCurrency(result.available)}).`,
                    };
                    await i.reply({ content: messages[result.reason] || '❌ Mua thất bại.', flags: MessageFlags.Ephemeral });
                    return;
                }

                await i.reply({
                    content: `✅ Đã mua **${name}** với giá ${formatCurrency(result.price)}. Số dư còn: ${formatCurrency(result.newBalance)}. Vào \`/tlee\` để dùng ngay!`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        });
    },
};
