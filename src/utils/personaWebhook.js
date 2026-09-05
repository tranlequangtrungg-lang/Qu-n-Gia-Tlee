import { logger } from './logger.js';

// Danh sách persona: tên hiển thị + avatar riêng cho từng "nhân vật" của bot.
// Muốn đổi ảnh đại diện: chỉ cần thay avatarUrl bằng link ảnh thật, không cần
// sửa gì khác. avatarUrl: null = tạm dùng avatar chính của bot.
// Muốn thêm persona mới (vd "Thần Bài Tlee" cho casino): thêm 1 mục ở đây.
export const PERSONAS = {
    thu_ky: {
        name: 'Thư Ký Tlee',
        avatarUrl: null,
    },
};

const WEBHOOK_NAME = 'TitanBot Persona Hook';
const webhookCache = new Map(); // channelId (hoặc parent nếu là thread) -> Webhook

function resolvePersonaAvatar(client, persona) {
    return persona.avatarUrl || client.user.displayAvatarURL({ extension: 'png', size: 256 });
}

async function getOrCreateWebhook(channel) {
    const isThread = typeof channel.isThread === 'function' && channel.isThread();
    const targetChannel = isThread ? channel.parent : channel;
    if (!targetChannel) return null;

    const cacheKey = targetChannel.id;
    if (webhookCache.has(cacheKey)) {
        return webhookCache.get(cacheKey);
    }

    const existingHooks = await targetChannel.fetchWebhooks().catch(() => null);
    let webhook = existingHooks?.find((w) => w.name === WEBHOOK_NAME && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        webhook = await targetChannel
            .createWebhook({
                name: WEBHOOK_NAME,
                avatar: channel.client.user.displayAvatarURL({ extension: 'png' }),
                reason: 'Tạo webhook để bot gửi tin nhắn với nhiều persona khác nhau',
            })
            .catch((error) => {
                logger.warn(`[PERSONA] Không tạo được webhook ở kênh ${targetChannel.id}:`, error.message);
                return null;
            });
    }

    if (webhook) {
        webhookCache.set(cacheKey, webhook);
    }

    return webhook;
}

/**
 * Gửi 1 tin nhắn vào `channel` nhưng hiển thị tên + avatar theo persona
 * (vd "Thư Ký Tlee") thay vì tên bot thật.
 *
 * Tự động tạo/dùng lại 1 webhook chung cho kênh đó — không tạo webhook mới
 * mỗi lần gửi. Nếu không tạo/dùng được webhook (vd thiếu quyền Manage
 * Webhooks ở kênh này), tự fallback về channel.send() bình thường — tính
 * năng chính (/tlee) vẫn chạy, chỉ là hiện tên bot gốc thay vì persona.
 */
export async function sendAsPersona(channel, personaKey, payload) {
    const persona = PERSONAS[personaKey];
    if (!persona) {
        throw new Error(`Không tìm thấy persona "${personaKey}"`);
    }

    const webhook = await getOrCreateWebhook(channel);
    if (!webhook) {
        return channel.send(payload);
    }

    const isThread = typeof channel.isThread === 'function' && channel.isThread();

    try {
        return await webhook.send({
            ...payload,
            username: persona.name,
            avatarURL: resolvePersonaAvatar(channel.client, persona),
            threadId: isThread ? channel.id : undefined,
        });
    } catch (error) {
        logger.warn('[PERSONA] Gửi qua webhook thất bại, fallback gửi thường:', error.message);
        return channel.send(payload);
    }
}
