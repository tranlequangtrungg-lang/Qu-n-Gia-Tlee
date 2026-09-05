// GHI ĐÈ (thay thế toàn bộ) → src/utils/personaWebhook.js
//
// Khác bản cũ: persona không còn hardcode trong object PERSONAS nữa, mà đọc
// từ personaService (quản lý qua /tleeoi trong Discord). Thêm bước kiểm tra
// quyền phòng (rooms / freeRoam) trước khi gửi — nếu bị chặn thì fallback
// gửi bằng bot gốc + báo admin (DM từng admin + kênh log cố định).

import { logger } from './logger.js';
import { getPersona, getAssignedPersonaKey } from '../services/personaService.js';

const ADMIN_LOG_CHANNEL_ID = '1310661747882856538';

const webhookCache = new Map(); // `${channelId}:${personaKey}` -> Webhook

async function getOrCreatePersonaWebhook(channel, persona) {
    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    const targetChannel = isThread ? channel.parent : channel;
    if (!targetChannel) return null;

    const cacheKey = `${targetChannel.id}:${persona.key}`;
    if (webhookCache.has(cacheKey)) {
        return webhookCache.get(cacheKey);
    }

    const existingHooks = await targetChannel.fetchWebhooks().catch(() => null);
    let webhook = existingHooks?.find((w) => w.name === persona.name && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        // Lưu ý: avatarUrl lấy từ link đính kèm lúc tạo persona — link CDN
        // đính kèm Discord có hạn dùng, nhưng vì createWebhook tải ảnh về
        // ngay lúc này và lưu thành asset riêng của webhook, nên webhook đã
        // tạo xong sẽ KHÔNG bị ảnh hưởng nếu link gốc hết hạn sau đó. Chỉ
        // rủi ro nếu webhook bị xoá thủ công và phải tạo lại sau khi link
        // avatarUrl gốc đã hết hạn — lúc đó sẽ tạo lại bằng avatar bot gốc.
        webhook = await targetChannel
            .createWebhook({
                name: persona.name,
                avatar: persona.avatarUrl || channel.client.user.displayAvatarURL({ extension: 'png' }),
                reason: `Tạo webhook tính cách "${persona.name}"`,
            })
            .catch((error) => {
                logger.warn(`[PERSONA] Không tạo được webhook "${persona.name}" ở kênh ${targetChannel.id}:`, error.message);
                return null;
            });
    }

    if (webhook) {
        webhookCache.set(cacheKey, webhook);
    }
    return webhook;
}

async function notifyAdmins(guild, content) {
    try {
        const logChannel = guild.channels.cache.get(ADMIN_LOG_CHANNEL_ID)
            || (await guild.channels.fetch(ADMIN_LOG_CHANNEL_ID).catch(() => null));
        if (logChannel) {
            await logChannel.send({ content }).catch((error) => {
                logger.warn('[PERSONA] Không gửi được log admin:', error.message);
            });
        }
    } catch (error) {
        logger.warn('[PERSONA] Lỗi khi gửi log admin:', error.message);
    }

    try {
        const members = await guild.members.fetch();
        const admins = members.filter((m) => m.permissions.has('Administrator') && !m.user.bot);
        for (const member of admins.values()) {
            await member.send({ content }).catch(() => {});
        }
    } catch (error) {
        logger.warn('[PERSONA] Không DM được admin:', error.message);
    }
}

/**
 * Gửi tin nhắn vào `channel` bằng tính cách đang được gán cho `actionKey`
 * (gán/đổi qua /tleeoi, không cần sửa code). Nếu tính cách đó chưa được
 * admin cấp quyền ở kênh này (không nằm trong danh sách phòng và không bật
 * "tự do đi lại") → fallback gửi bằng bot gốc + báo admin.
 *
 * @param client   discord.js Client (cần client.db)
 * @param channel  kênh (hoặc thread) sẽ gửi tin vào
 * @param guildId  ID server, vì persona lưu theo từng server riêng
 * @param actionKey  khoá hành động khai báo trong config/personaActions.js
 * @param payload  nội dung gửi (content, embeds, files...)
 */
export async function sendAsPersona(client, channel, guildId, actionKey, payload) {
    const personaKeyValue = await getAssignedPersonaKey(client, guildId, actionKey);
    if (!personaKeyValue) {
        // Chưa có ai gán tính cách cho hành động này -> gửi bằng bot gốc,
        // không tính là lỗi (admin có thể cố ý chưa gán).
        return channel.send(payload);
    }

    const persona = await getPersona(client, guildId, personaKeyValue);
    if (!persona) {
        return channel.send(payload);
    }

    const allowed = persona.freeRoam || persona.rooms.includes(channel.id);
    if (!allowed) {
        await notifyAdmins(
            channel.guild,
            `⚠️ Tính cách **${persona.name}** chưa được cấp quyền ở kênh <#${channel.id}> (hành động: \`${actionKey}\`). Bot đã gửi bằng tên gốc thay thế. Dùng \`/tleelist\` để cấp quyền phòng.`,
        );
        return channel.send(payload);
    }

    const webhook = await getOrCreatePersonaWebhook(channel, persona);
    if (!webhook) {
        await notifyAdmins(
            channel.guild,
            `⚠️ Không tạo được webhook cho tính cách **${persona.name}** ở kênh <#${channel.id}> (có thể thiếu quyền Manage Webhooks). Bot đã gửi bằng tên gốc thay thế.`,
        );
        return channel.send(payload);
    }

    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    try {
        return await webhook.send({
            ...payload,
            threadId: isThread ? channel.id : undefined,
        });
    } catch (error) {
        logger.warn('[PERSONA] Gửi qua webhook thất bại, fallback gửi thường:', error.message);
        await notifyAdmins(channel.guild, `⚠️ Gửi webhook cho tính cách **${persona.name}** thất bại (${error.message}). Bot đã gửi bằng tên gốc thay thế.`);
        return channel.send(payload);
    }
}
