import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { getMuteRoles } from '../../utils/moderation.js';
import { isBotOwner } from '../../config/bot.js';

const durationChoices = [
    { name: "5 minutes", value: 5 },
    { name: "10 minutes", value: 10 },
    { name: "30 minutes", value: 30 },
    { name: "1 hour", value: 60 },
    { name: "6 hours", value: 360 },
    { name: "1 day", value: 1440 },
    { name: "1 week", value: 10080 },
];

// Since this command is no longer locked with .setDefaultMemberPermissions(),
// it will appear in the command list for everyone. This function is what
// actually enforces who is allowed to use it.
async function hasMutePermission(member, guildId) {
    if (isBotOwner(member.id)) {
        return true;
    }

    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return true;
    }

    const muteRoles = await getMuteRoles(guildId);
    if (muteRoles.length > 0 && member.roles.cache.some((role) => muteRoles.includes(role.id))) {
        return true;
    }

    return false;
}

export default {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a user for a specific duration.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("User to timeout")
                .setRequired(true),
        )
        .addIntegerOption(
            (option) =>
                option
                    .setName("duration")
                    .setDescription("Duration of the timeout")
                    .setRequired(true)
                    .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for the timeout"),
        ),
    // NOTE: .setDefaultMemberPermissions() intentionally removed.
    // Permission is now enforced manually below via hasMutePermission(),
    // so users with a role in moderation.muteRoles can use this command
    // even without the native ModerateMembers permission.
    category: "moderation",
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Timeout interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'timeout',
            });
            return;
        }

        const allowed = await hasMutePermission(interaction.member, interaction.guildId);
        if (!allowed) {
            throw new TitanBotError(
                'Missing mute permission',
                ErrorTypes.PERMISSION,
                'You do not have permission to use this command. You need "Moderate Members" permission or a role listed in the mute role list (see /muteconfig).',
            );
        }

        const targetUser = interaction.options.getUser("target");
        const member = interaction.options.getMember("target");
        const durationMinutes = interaction.options.getInteger("duration");
        const reason = interaction.options.getString("reason") || "No reason provided";
        if (!targetUser) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to timeout.',
                { subtype: 'invalid_user' },
            );
        }
        if (targetUser.id === interaction.user.id) {
            throw new TitanBotError(
                "Cannot timeout self",
                ErrorTypes.VALIDATION,
                "You cannot timeout yourself.",
            );
        }
        if (targetUser.id === client.user.id) {
            throw new TitanBotError(
                "Cannot timeout bot",
                ErrorTypes.VALIDATION,
                "You cannot timeout the bot.",
            );
        }
        if (!member) {
            throw new TitanBotError(
                "Target not found",
                ErrorTypes.USER_INPUT,
                "The target user is not currently in this server.",
            );
        }
        const durationMs = durationMinutes * 60 * 1000;
        const result = await ModerationService.timeoutUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            durationMs,
            reason,
        });
        const durationDisplay =
            durationChoices.find((c) => c.value === durationMinutes)
                ?.name || `${durationMinutes} minutes`;
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    `⏳ **Timed out** ${targetUser.tag} for ${durationDisplay}.`,
                    `**Reason:** ${reason}\n**Case ID:** #${result.caseId}`,
                ),
            ],
        });
    },
};
