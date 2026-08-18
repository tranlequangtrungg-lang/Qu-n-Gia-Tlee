import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getMuteRoles, addMuteRole, removeMuteRole } from '../../utils/moderation.js';
import { logModerationAction } from '../../utils/moderation.js';

export default {
    data: new SlashCommandBuilder()
        .setName("muteconfig")
        .setDescription("Manage which roles are allowed to use /timeout.")
        .addSubcommand((sub) =>
            sub
                .setName("add")
                .setDescription("Allow a role to use /timeout")
                .addRoleOption((option) =>
                    option
                        .setName("role")
                        .setDescription("Role to allow")
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("remove")
                .setDescription("Remove a role from being allowed to use /timeout")
                .addRoleOption((option) =>
                    option
                        .setName("role")
                        .setDescription("Role to remove")
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("list")
                .setDescription("List roles currently allowed to use /timeout"),
        )
        // This command stays hard-locked to ManageGuild — unlike /timeout, there is
        // no need to open it up to custom roles, since it configures who those
        // custom roles even are.
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: "moderation",
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Muteconfig interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'muteconfig',
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (subcommand === "list") {
            const roles = await getMuteRoles(guildId);

            if (roles.length === 0) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "📋 **Mute roles**",
                            "No custom roles are currently allowed to use /timeout.\nOnly users with the native \"Moderate Members\" permission (or the bot owner) can use it.",
                        ),
                    ],
                });
                return;
            }

            const list = roles.map((id) => `<@&${id}>`).join("\n");
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "📋 **Mute roles**",
                        `The following roles can use /timeout without needing "Moderate Members":\n${list}`,
                    ),
                ],
            });
            return;
        }

        const role = interaction.options.getRole("role");
        if (!role) {
            throw new TitanBotError(
                'Missing role',
                ErrorTypes.USER_INPUT,
                'You must specify a role.',
            );
        }

        if (subcommand === "add") {
            const existing = await getMuteRoles(guildId);
            if (existing.includes(role.id)) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "ℹ️ Already added",
                            `**${role.name}** can already use /timeout.`,
                        ),
                    ],
                });
                return;
            }

            await addMuteRole(guildId, role.id);

            await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Mute Role Added',
                    target: `${role.name} (${role.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: 'Added via /muteconfig add',
                    metadata: {
                        roleId: role.id,
                        moderatorId: interaction.user.id,
                    },
                },
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "✅ **Role added**",
                        `**${role.name}** can now use /timeout without needing "Moderate Members".`,
                    ),
                ],
            });
            return;
        }

        if (subcommand === "remove") {
            const existing = await getMuteRoles(guildId);
            if (!existing.includes(role.id)) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "ℹ️ Not in list",
                            `**${role.name}** is not currently in the mute role list.`,
                        ),
                    ],
                });
                return;
            }

            await removeMuteRole(guildId, role.id);

            await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Mute Role Removed',
                    target: `${role.name} (${role.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: 'Removed via /muteconfig remove',
                    metadata: {
                        roleId: role.id,
                        moderatorId: interaction.user.id,
                    },
                },
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "✅ **Role removed**",
                        `**${role.name}** can no longer use /timeout via the custom mute role list.`,
                    ),
                ],
            });
            return;
        }
    },
};
