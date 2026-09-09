import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData, withEconomyLock, formatCurrency } from '../utils/economy.js';
import { checkTaiSanMoc } from './vinhDanhService.js';

const STORAGE_CHANNEL_ID = '1545872460274999316';
const DEFAULT_PRICE_FALLBACK = 36000;

function expressionKey(guildId, name) {
    return `bieucam:${guildId}:${name.toLowerCase()}`;
}

function listPrefix(guildId) {
    return `bieucam:${guildId}:`;
}

function configKey(guildId) {
    return `tlee_config:${guildId}`;
}

// Namespace riêng trong userData.upgrades — không bao giờ trùng với item id
// thật trong config/shop/items.js.
function ownershipKey(name) {
    return `tlee_${name.toLowerCase()}`;
}

async function listKeys(client, prefix) {
    if (!client.db?.list) return [];
    let keys = await client.db.list(prefix).catch(() => []);
    if (!Array.isArray(keys)) {
        keys = typeof keys === 'object' && keys !== null ? Object.keys(keys) : [];
    }
    return keys.filter((k) => k.startsWith(prefix));
}

// Dùng cho nhãn nút bấm / mô tả dropdown — 2 nơi Discord KHÔNG render được
// emoji tuỳ chỉnh dạng <:Bcoin:id>, chỉ hiện được chữ thường. Khác
// formatCurrency() (có emoji, dùng được trong embed/content bình thường).
export function formatCurrencyPlain(amount) {
    return `${amount.toLocaleString('vi-VN')} Bcoin`;
}

export async function getDefaultPrice(client, guildId) {
    const cfg = await client.db.get(configKey(guildId)).catch(() => null);
    return cfg?.defaultPrice ?? DEFAULT_PRICE_FALLBACK;
}

export async function setDefaultPrice(client, guildId, price) {
    await client.db.set(configKey(guildId), { defaultPrice: price });
}

export async function addExpression(client, guildId, { name, description, captionTemplate, addedBy, attachmentUrl, price }) {
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
        // null = dùng giá mặc định chung; số cụ thể (kể cả 0) = giá riêng.
        price: price === undefined || price === null ? null : price,
    };

    await client.db.set(expressionKey(guildId, name), record);
    return record;
}

export async function setExpressionPrice(client, guildId, name, price) {
    const key = expressionKey(guildId, name);
    const existing = await client.db.get(key).catch(() => null);
    if (!existing) return null;
    existing.price = price === undefined || price === null ? null : price;
    await client.db.set(key, existing);
    return existing;
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
 * Giá thực tế áp dụng — nếu biểu cảm không set giá riêng (null), dùng giá
 * mặc định chung của guild.
 */
export async function getEffectivePrice(client, guildId, expression) {
    if (expression.price !== null && expression.price !== undefined) {
        return expression.price;
    }
    return await getDefaultPrice(client, guildId);
}

export function isFree(effectivePrice) {
    return !effectivePrice || effectivePrice <= 0;
}

export async function userOwnsExpression(client, guildId, userId, expression) {
    const effectivePrice = await getEffectivePrice(client, guildId, expression);
    if (isFree(effectivePrice)) return true;

    const userData = await getEconomyData(client, guildId, userId);
    return Boolean(userData.upgrades?.[ownershipKey(expression.name)]);
}

/**
 * Mua vĩnh viễn 1 biểu cảm — trừ Bcoin, ghi cờ sở hữu vào userData.upgrades
 * (dùng chung định dạng với shop items thật, namespace riêng nên không đụng
 * độ). Trả về { ok: false, reason } nếu thất bại.
 */
export async function purchaseExpression(client, guildId, userId, expression) {
    return await withEconomyLock(guildId, userId, async () => {
        const effectivePrice = await getEffectivePrice(client, guildId, expression);

        if (isFree(effectivePrice)) {
            return { ok: false, reason: 'already_free' };
        }

        const userData = await getEconomyData(client, guildId, userId);
        const key = ownershipKey(expression.name);

        if (userData.upgrades?.[key]) {
            return { ok: false, reason: 'already_owned' };
        }

        if ((userData.wallet || 0) < effectivePrice) {
            return { ok: false, reason: 'insufficient_funds', available: userData.wallet || 0, price: effectivePrice };
        }

        userData.wallet -= effectivePrice;
        userData.upgrades = userData.upgrades || {};
        userData.upgrades[key] = true;
        await setEconomyData(client, guildId, userId, userData);

        // Chạy nền, đồng bộ với mọi giao dịch Bcoin khác — tự thoát sớm nếu
        // không có mốc Tài Sản mới nào bị ảnh hưởng (mua đồ chỉ giảm ví).
        checkTaiSanMoc(client, guildId, userId, (userData.wallet || 0) + (userData.bank || 0)).catch((error) => {
            logger.warn('[TLEE_SHOP] checkTaiSanMoc lỗi:', error.message);
        });

        return { ok: true, price: effectivePrice, newBalance: userData.wallet };
    });
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

export function buildCaption(expression, invoker, targets) {
    const targetText = targets.length === 0
        ? ''
        : targets.length === 1
            ? `<@${targets[0]}>`
            : `${targets.slice(0, -1).map((id) => `<@${id}>`).join(', ')} và <@${targets[targets.length - 1]}>`;

    if (expression.captionTemplate) {
        return expression.captionTemplate
            .replace(/\{nguoi_dung\}/g, `<@${invoker}>`)
            .replace(/\{muc_tieu\}/g, targetText || 'chính mình');
    }

    return targetText
        ? `<@${invoker}> ${expression.name} ${targetText}!`
        : `<@${invoker}> ${expression.name}!`;
}

export { formatCurrency };
