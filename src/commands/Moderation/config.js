import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getGuildConfig, setConfigValue } from '../../services/config/guildConfig.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isServerAdmin } from '../../utils/permissions.js';

export default {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Cấu hình các thiết lập của server (chỉ Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('set-log-channel')
                .setDescription('Đặt kênh nhận log giao dịch /addmoney')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Kênh sẽ nhận log')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('set-premium-role')
                .setDescription('Đặt role Premium (nhận bonus /daily)')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role Premium')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('Xem cấu hình hiện tại của server')
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        if (!isServerAdmin(interaction)) {
            throw createError(
                'Insufficient permission for /config',
                ErrorTypes.VALIDATION,
                'Bạn cần quyền Administrator hoặc là chủ server để dùng lệnh này.',
                { userId: interaction.user.id, guildId: interaction.guildId }
            );
        }

        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set-log-channel') {
            const channel = interaction.options.getChannel('channel');
            await setConfigValue(client, guildId, 'addMoneyLogChannelId', channel.id);

            const embed = successEmbed(
                '✅ Đã cập nhật',
                `Kênh log giao dịch /addmoney đã được đặt thành ${channel}.`
            );
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (subcommand === 'set-premium-role') {
            const role = interaction.options.getRole('role');
            await setConfigValue(client, guildId, 'premiumRoleId', role.id);

            const embed = successEmbed(
                '✅ Đã cập nhật',
                `Role Premium đã được đặt thành ${role}.`
            );
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (subcommand === 'view') {
            const guildConfig = await getGuildConfig(client, guildId);

            const embed = createEmbed({ title: '⚙️ Cấu hình server hiện tại' })
                .addFields(
                    {
                        name: 'Kênh log /addmoney',
                        value: guildConfig.addMoneyLogChannelId ? `<#${guildConfig.addMoneyLogChannelId}>` : 'Chưa đặt',
                        inline: true,
                    },
                    {
                        name: 'Role Premium',
                        value: guildConfig.premiumRoleId ? `<@&${guildConfig.premiumRoleId}>` : 'Chưa đặt',
                        inline: true,
                    },
                );

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }
    }, { command: 'config' })
};
