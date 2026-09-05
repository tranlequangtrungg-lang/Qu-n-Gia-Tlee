import { logger } from './logger.js';

// Mỗi persona = tên của 1 webhook riêng. Muốn đổi tên hiển thị hoặc avatar:
// vào Discord → Server Settings → Integrations → Webhooks → chọn đúng
// webhook có tên trùng persona bên dưới → sửa trực tiếp ở đó, KHÔNG cần
// đụng code hay nhờ ai sửa giúp.
//
// Muốn thêm persona mới (vd "Thần Bài Tlee" cho casino): chỉ cần thêm 1
// dòng vào object bên dưới, bot sẽ tự tạo webhook tương ứng ở lần gửi đầu
// tiên (dùng tạm avatar của bot, sau đó bạn tự đổi ảnh trong Discord).
export const PERSONAS = {
    thu_ky: 'Thư Ký Tlee',
};

const webhookCache = new Map(); // `${channelId}:${personaName}` -> Webhook

async function getOrCreatePersonaWebhook(channel, personaName) {
    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    const targetChannel = isThread ? channel.parent : channel;
    if (!targetChannel) return null;

    const cacheKey = `${targetChannel.id}:${personaName}`;
    if (webhookCache.has(cacheKey)) {
        return webhookCache.get(cacheKey);
    }

    const existingHooks = await targetChannel.fetchWebhooks().catch(() => null);
    let webhook = existingHooks?.find((w) => w.name === personaName && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        webhook = await targetChannel
            .createWebhook({
                name: personaName,
                avatar: channel.client.user.displayAvatarURL({ extension: 'png' }),
                reason: `Tạo webhook persona "${personaName}"`,
            })
            .catch((error) => {
                logger.warn(`[PERSONA] Không tạo được webhook "${personaName}" ở kênh ${targetChannel.id}:`, error.message);
                return null;
            });
    }

    if (webhook) {
        webhookCache.set(cacheKey, webhook);
    }

    return webhook;
}

/**
 * Gửi 1 tin nhắn vào `channel` bằng webhook riêng của persona đó — tên và
 * avatar hiển thị chính là tên/avatar của webhook (chỉnh trực tiếp trong
 * Discord, không cần code).
 *
 * Nếu không tạo/dùng được webhook (vd thiếu quyền Manage Webhooks ở kênh
 * này), tự fallback về channel.send() bình thường — tính năng chính vẫn
 * chạy, chỉ là hiện tên bot gốc.
 */
export async function sendAsPersona(channel, personaKey, payload) {
    const personaName = PERSONAS[personaKey];
    if (!personaName) {
        throw new Error(`Không tìm thấy persona "${personaKey}"`);
    }

    const webhook = await getOrCreatePersonaWebhook(channel, personaName);
    if (!webhook) {
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
        return channel.send(payload);
    }
}
