import { PermissionFlagsBits } from 'discord.js';

/**
 * Kiểm tra người dùng có phải Admin thật sự của server hay không.
 * Coi là admin nếu: là chủ server (owner) HOẶC có quyền Administrator.
 * Đây là lớp kiểm tra CHÍNH — không dựa vào setDefaultMemberPermissions
 * trên slash command vì admin server có thể tự đổi quyền đó trong
 * Server Settings > Integrations, khiến check phía Discord không còn
 * đáng tin cậy 100%.
 */
export function isServerAdmin(interaction) {
    if (!interaction.guild || !interaction.member) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;

    const permissions = interaction.member.permissions;
    if (!permissions || typeof permissions.has !== 'function') return false;

    return permissions.has(PermissionFlagsBits.Administrator);
}
