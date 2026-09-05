import { logger } from '../utils/logger.js';

const STORAGE_CHANNEL_ID = '1545872460274999316';

function expressionKey(guildId, name) {
    return `bieucam:${guildId}:${name.toLowerCase()}`;
}

function listPrefix(guildId) {
    return `bieucam:${guildId}:`;
}

async function listKeys(client, prefix) {
    if (!client.db?.list) return [];
    let keys = await client.db.list(prefix).catch(() => []);
    if (!Array.isArray(keys)) {
        keys = typeof keys === 'object' && keys !== null ? Object.keys(keys) : [];
    }
    return keys.filter((k) => k.startsWith(prefix));
}

export async function addExpression(client, guildId, { name, description, captionTemplate, addedBy, attachmentUrl }) {
    const channel = client.channels.cache.get(STORAGE_CHANNEL_ID) || (await client.channels.fetch(STORAGE_CHANNEL_ID).catch(() => null));
    if (!channel) {
        throw new Error('Không tìm thấy kênh lưu trữ biểu cảm.');
    }

    // Đăng lại gif vào kênh lưu trữ riêng — link attachment gốc từ lệnh
    // Discord slash command có hạn sử dụng (thường hết hạn sau vài giờ),
    // nên cần 1 bản sao "sống lâu dài" để lấy lại link tươi mỗi lần dùng.
    const storageMessage = await channel.send({
        content: `📦 Biểu cảm: **${name}**`,
        files: [attachmentUrl],
    });

    const record = {
        name,
        description,
        captionTemplate: captionTemplate || null,
        addedBy,
        createdAt: Date.now(),
        storageMessageId: storageMessage.id,
    };

    await client.db.set(expressionKey(guildId, name), record);
    return record;
}

export async function removeExpression(client, guildId, name) {
    const key = expressionKey(guildId, name);
    const existing = await client.db.get(key).catch(() => null);
    if (!existing) return false;
    await client.db.delete(key);
    return true;
}

export async function listExpressions(client, guildId) {
    const keys = await listKeys(client, listPrefix(guildId));
    const expressions = [];
    for (const key of keys) {
        const data = await client.db.get(key).catch(() => null);
        if (data) expressions.push(data);
    }
    return expressions.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getExpression(client, guildId, name) {
    return await client.db.get(expressionKey(guildId, name)).catch(() => null);
}

/**
 * Lấy lại link đính kèm còn tươi từ tin nhắn lưu trữ — không bao giờ dùng
 * link đã lưu sẵn trong DB vì link attachment Discord hết hạn theo thời
 * gian.
 */
export async function getFreshAttachmentUrl(client, expression) {
    try {
        const channel = client.channels.cache.get(STORAGE_CHANNEL_ID) || (await client.channels.fetch(STORAGE_CHANNEL_ID).catch(() => null));
        if (!channel) return null;

        const message = await channel.messages.fetch(expression.storageMessageId).catch(() => null);
        if (!message) return null;

        const attachment = message.attachments.first();
        return attachment?.url || null;
    } catch (error) {
        logger.warn('[BIEU_CAM] Không lấy được link tươi:', error.message);
        return null;
    }
}

// Kho câu mặc định dùng khi admin không tự viết caption riêng cho biểu cảm.
// Mỗi lần gửi, bốc ngẫu nhiên 1 câu — tránh lặp lại y hệt gây khô khan.
// Hỗ trợ 3 placeholder: {nguoi_dung}, {muc_tieu}, {ten} (tên biểu cảm).
const DEFAULT_CAPTION_TEMPLATES = [
    'Tự nhiên {nguoi_dung} thấy {muc_tieu} phải nhận trọn vẹn cú {ten} này 😤',
    '{nguoi_dung} chính thức ném combo {ten} thẳng mặt {muc_tieu} 😭',
    'Không báo trước, {nguoi_dung} tặng {muc_tieu} một phát {ten} chất lượng cao 😏',
    '{muc_tieu} vừa nhận nguyên xi cú {ten} từ {nguoi_dung}, đau chưa? 😂',
    'Cảnh báo: {nguoi_dung} vừa {ten} {muc_tieu} không thương tiếc luôn 💀',
    '{nguoi_dung} thả nguyên quả {ten} vào mặt {muc_tieu}, ai cứu nổi 🤡',
];

export function buildCaption(expression, invoker, targets) {
    const targetText = targets.length === 0
        ? 'chính mình'
        : targets.length === 1
            ? `<@${targets[0]}>`
            : `${targets.slice(0, -1).map((id) => `<@${id}>`).join(', ')} và <@${targets[targets.length - 1]}>`;

    // Nếu admin đã tự viết caption riêng cho biểu cảm này thì luôn ưu tiên
    // dùng đúng câu đó. Chỉ khi để trống mới bốc ngẫu nhiên từ kho mặc định.
    const template = expression.captionTemplate
        || DEFAULT_CAPTION_TEMPLATES[Math.floor(Math.random() * DEFAULT_CAPTION_TEMPLATES.length)];

    return template
        .replace(/\{nguoi_dung\}/g, `<@${invoker}>`)
        .replace(/\{muc_tieu\}/g, targetText)
        .replace(/\{ten\}/g, expression.name);
}
