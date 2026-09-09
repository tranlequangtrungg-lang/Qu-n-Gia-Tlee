// GHI ĐÈ (thay thế toàn bộ) → src/utils/personaWebhook.js
//
// So với bản trước: GIỮ NGUYÊN toàn bộ sendAsPersona() cũ (đang được /tlee
// dùng, không đổi gì cả). THÊM MỚI 2 hàm sendPersonaFrame() / editPersonaFrame()
// để hỗ trợ các hành động cần gửi 1 tin nhắn rồi SỬA NHIỀU LẦN liên tiếp
// (hoạt ảnh lắc bát -> mở bát -> kết quả của Tài Xỉu / Xóc Đĩa), vì
// `interaction.editReply()` không thể đổi tên/avatar hiển thị được, nên các
// hành động dạng hoạt ảnh phải chuyển hẳn sang gửi bằng tin nhắn kênh thường
// (qua webhook persona) ngay từ khung đầu tiên.

import { logger } from './logger.js';
import { getPersona, getAssignedPersonaKey } from '../services/personaService.js';

const ADMIN_LOG_CHANNEL_ID = '1310661747882856538';
const FRAME_EDIT_TIMEOUT_MS = 6000;

const webhookCache = new Map(); // `${channelId}:${personaKey}` -> Webhook

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} quá ${ms}ms`)), ms)),
    ]);
}

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
 * Tra xem hành động `actionKey` đang được gán cho persona nào, và persona đó
 * có được phép hiện ở `channel` này không.
 * Trả về persona (đủ điều kiện dùng) hoặc null (chưa gán / bị chặn phòng —
 * trong trường hợp bị chặn, đã tự báo admin bên trong hàm này).
 */
async function resolveEligiblePersona(client, channel, guildId, actionKey) {
    const personaKeyValue = await getAssignedPersonaKey(client, guildId, actionKey);
    if (!personaKeyValue) return null;

    const persona = await getPersona(client, guildId, personaKeyValue);
    if (!persona) return null;

    const allowed = persona.freeRoam || persona.rooms.includes(channel.id);
    if (!allowed) {
        await notifyAdmins(
            channel.guild,
            `⚠️ Tính cách **${persona.name}** chưa được cấp quyền ở kênh <#${channel.id}> (hành động: \`${actionKey}\`). Bot đã gửi bằng tên gốc thay thế. Dùng \`/tleelist\` để cấp quyền phòng.`,
        );
        return null;
    }

    return persona;
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
    const persona = await resolveEligiblePersona(client, channel, guildId, actionKey);
    if (!persona) {
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

/**
 * Gửi KHUNG ĐẦU TIÊN của 1 chuỗi hoạt ảnh nhiều khung (VD: lắc bát -> mở bát
 * -> kết quả) bằng tính cách đang được gán cho `actionKey`. Vì
 * `interaction.editReply()` không thể đổi tên/avatar hiển thị, nên MỌI khung
 * hình của hoạt ảnh (kể cả khung đầu) đều phải đi qua đây — không dùng
 * `interaction.editReply()` nữa cho các hành động dạng hoạt ảnh.
 *
 * Trả về 1 "frame handle" — truyền handle này cho editPersonaFrame() để sửa
 * các khung tiếp theo trên đúng tin nhắn vừa gửi.
 */
export async function sendPersonaFrame(client, channel, guildId, actionKey, payload) {
    const persona = await resolveEligiblePersona(client, channel, guildId, actionKey);
    const isThread = typeof channel.isThread === 'function' && channel.isThread();

    if (persona) {
        const webhook = await getOrCreatePersonaWebhook(channel, persona);
        if (webhook) {
            try {
                const message = await webhook.send({
                    ...payload,
                    threadId: isThread ? channel.id : undefined,
                });
                return { message, mode: 'webhook', webhook, isThread, channel };
            } catch (error) {
                logger.warn('[PERSONA] Gửi khung đầu qua webhook thất bại, fallback gửi thường:', error.message);
                await notifyAdmins(channel.guild, `⚠️ Gửi webhook cho tính cách **${persona.name}** thất bại (${error.message}). Bot đã gửi bằng tên gốc thay thế.`);
            }
        } else {
            await notifyAdmins(
                channel.guild,
                `⚠️ Không tạo được webhook cho tính cách **${persona.name}** ở kênh <#${channel.id}> (có thể thiếu quyền Manage Webhooks). Bot đã gửi bằng tên gốc thay thế.`,
            );
        }
    }

    // Fallback: persona chưa gán / bị chặn phòng / lỗi webhook -> gửi bằng bot gốc
    const message = await channel.send(payload);
    return { message, mode: 'channel', webhook: null, isThread, channel };
}

/**
 * Sửa 1 khung hình tiếp theo trên đúng tin nhắn đã tạo bởi sendPersonaFrame().
 * Có giới hạn thời gian chờ — treo/lỗi mạng thì bỏ qua (chỉ ghi log), KHÔNG
 * được phép chặn phần trả tiền/xử lý logic phía sau lệnh gọi hàm này.
 *
 * Trả về true nếu sửa thành công, false nếu thất bại/timeout (để nơi gọi có
 * thể tự quyết định có cần báo riêng cho người chơi hay không).
 */
export async function editPersonaFrame(frameHandle, payload) {
    if (!frameHandle) return false;
    try {
        if (frameHandle.mode === 'webhook' && frameHandle.webhook) {
            await withTimeout(
                frameHandle.webhook.editMessage(frameHandle.message.id, {
                    ...payload,
                    threadId: frameHandle.isThread ? frameHandle.channel.id : undefined,
                }),
                FRAME_EDIT_TIMEOUT_MS,
                'webhook.editMessage',
            );
        } else {
            await withTimeout(frameHandle.message.edit(payload), FRAME_EDIT_TIMEOUT_MS, 'message.edit');
        }
        return true;
    } catch (error) {
        logger.warn('[PERSONA] Sửa khung hoạt ảnh thất bại/timeout — bỏ qua, không chặn phần trả tiền:', error.message);
        return false;
    }
}
