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
import {
    listExpressions,
    getExpression,
    getEffectivePrice,
    isFree,
    userOwnsExpression,
    purchaseExpression,
    getFreshAttachmentUrl,
    buildCaption,
    formatCurrency,
    formatCurrencyPlain,
} from '../../services/bieuCamService.js';

async function buildShopOptions(client, guildId, userId, expressions) {
    const options = [];
    for (const e of expressions.slice(0, 25)) {
        const price = await getEffectivePrice(client, guildId, e);
        const owned = await userOwnsExpression(client, guildId, userId, e);
        const status = isFree(price) ? 'Miễn phí' : owned ? 'Đã sở hữu' : formatCurrencyPlain(price);
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
            time: 180_000,
        });

        collector.on('collect', async (i) => {
            // --- Chọn biểu cảm để xem ---
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
                        new ButtonBuilder()
                            .setCustomId(`cuahangtlee_buy_${name}`)
                            .setLabel(`Mua — ${formatCurrencyPlain(price)}`)
                            .setStyle(ButtonStyle.Success),
                    ));
                } else if (owned || isFree(price)) {
                    rows.push(new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`cuahangtlee_use_${name}`)
                            .setLabel('🎁 Dùng ngay')
                            .setStyle(ButtonStyle.Primary),
                    ));
                }

                await i.update({ embeds: [buildPreviewEmbed(expression, imageUrl, price, owned)], components: rows });
                return;
            }

            // --- Mua ---
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
                        insufficient_funds: `❌ Không đủ Bcoin (cần ${formatCurrencyPlain(result.price)}, hiện có ${formatCurrencyPlain(result.available)}).`,
                    };
                    await i.reply({ content: messages[result.reason] || '❌ Mua thất bại.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const imageUrl = await getFreshAttachmentUrl(client, expression);
                const rows = [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('cuahangtlee_pick')
                            .setPlaceholder('Chọn biểu cảm khác...')
                            .addOptions(options),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`cuahangtlee_use_${name}`).setLabel('🎁 Dùng ngay').setStyle(ButtonStyle.Primary),
                    ),
                ];

                await i.update({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`✅ Đã mua ${name}`)
                            .setDescription(`Giá: ${formatCurrency(result.price)}\nSố dư còn: ${formatCurrency(result.newBalance)}`)
                            .setImage(imageUrl)
                            .setColor('#2ecc71'),
                    ],
                    components: rows,
                });
                return;
            }

            // --- Dùng ngay (bỏ qua /tlee, gửi thẳng từ đây) ---
            if (i.customId.startsWith('cuahangtlee_use_')) {
                const name = i.customId.replace('cuahangtlee_use_', '');
                const expression = await getExpression(client, interaction.guildId, name);
                const imageUrl = expression ? await getFreshAttachmentUrl(client, expression) : null;

                if (!expression || !imageUrl) {
                    await i.reply({ content: '❌ Biểu cảm này bị lỗi.', flags: MessageFlags.Ephemeral });
                    return;
                }

                let selectedTargets = [];
                const userSelectRow = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('cuahangtlee_use_targets')
                        .setPlaceholder('Chọn người muốn tag (không bắt buộc)')
                        .setMinValues(0)
                        .setMaxValues(10),
                );
                const sendRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('cuahangtlee_use_send').setLabel('Gửi').setStyle(ButtonStyle.Success),
                );

                await i.update({
                    embeds: [new EmbedBuilder().setTitle(`✨ ${expression.name}`).setImage(imageUrl).setColor('#f39c12')],
                    components: [userSelectRow, sendRow],
                });

                const useCollector = message.createMessageComponentCollector({
                    filter: (ci) => ci.user.id === interaction.user.id,
                    time: 60_000,
                });

                useCollector.on('collect', async (ci) => {
                    if (ci.customId === 'cuahangtlee_use_targets') {
                        selectedTargets = ci.values;
                        await ci.deferUpdate();
                        return;
                    }
                    if (ci.customId === 'cuahangtlee_use_send') {
                        const caption = buildCaption(expression, interaction.user.id, selectedTargets);
                        await interaction.channel.send({ content: caption, files: [{ attachment: imageUrl, name: `${expression.name}.gif` }] });
                        await ci.update({ content: '✅ Đã gửi!', embeds: [], components: [] });
                        useCollector.stop();
                        collector.stop();
                    }
                });
            }
        });
    },
};
