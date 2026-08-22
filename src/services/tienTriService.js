import { logger } from '../utils/logger.js';

const ROLE_NHA_TIEN_TRI = '1540698040149610536';
const CHANNEL_PHONG_THAN_BANG = '1539851934222131292';

function predictionKey(guildId, leg, userId) {
    return `tientri:${guildId}:${leg}:${userId}`;
}

function predictionPrefix(guildId, leg) {
    return `tientri:${guildId}:${leg}:`;
}

export async function submitPrediction(client, guildId, userId, leg, vn, thai) {
    const key = predictionKey(guildId, leg, userId);
    await client.db.set(key, { vn, thai, submittedAt: Date.now() });
}

async function listPredictions(client, guildId, leg) {
    const prefix = predictionPrefix(guildId, leg);
    if (!client.db?.list) return [];

    let keys = await client.db.list(prefix).catch(() => []);
    if (!Array.isArray(keys)) {
        keys = typeof keys === 'object' && keys !== null ? Object.keys(keys) : [];
    }

    const predictions = [];
    for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        const userId = key.slice(prefix.length);
        const data = await client.db.get(key).catch(() => null);
        if (data && Number.isFinite(data.vn) && Number.isFinite(data.thai)) {
            predictions.push({ userId, vn: data.vn, thai: data.thai });
        }
    }
    return predictions;
}

/**
 * Chốt kết quả 1 lượt đấu — so khớp toàn bộ dự đoán đã nộp với tỉ số thật,
 * gán role cho người thắng (ưu tiên đúng tuyệt đối; nếu không ai đúng thì
 * lấy người có tổng chênh lệch bàn thắng thấp nhất — có thể nhiều người
 * hoà nhau), và gửi thông báo vào kênh chung. An toàn chạy lại nhiều lần
 * cho cùng 1 lượt — chỉ gán thêm role cho ai chưa có, không đổi/xoá ai.
 */
export async function resolveLeg(client, guildId, leg, realVn, realThai) {
    const predictions = await listPredictions(client, guildId, leg);
    if (predictions.length === 0) {
        return { winners: [], predictions: [] };
    }

    const scored = predictions.map((p) => ({
        ...p,
        diff: Math.abs(p.vn - realVn) + Math.abs(p.thai - realThai),
        exact: p.vn === realVn && p.thai === realThai,
    }));

    const hasExact = scored.some((p) => p.exact);
    const winners = hasExact
        ? scored.filter((p) => p.exact)
        : (() => {
            const minDiff = Math.min(...scored.map((p) => p.diff));
            return scored.filter((p) => p.diff === minDiff);
        })();

    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { winners, predictions: scored };

    const awardedUsers = [];
    for (const winner of winners) {
        const member = await guild.members.fetch(winner.userId).catch(() => null);
        if (!member) continue;

        if (!member.roles.cache.has(ROLE_NHA_TIEN_TRI)) {
            await member.roles
                .add(ROLE_NHA_TIEN_TRI, `Đoán trúng tỉ số ${leg === 'luot_di' ? 'lượt đi' : 'lượt về'}`)
                .catch((error) => {
                    logger.warn('[TIEN_TRI] Không gán được role:', error.message);
                });
        }
        awardedUsers.push(member);
    }

    await sendResultAnnouncement(client, guildId, leg, realVn, realThai, awardedUsers, hasExact);

    return { winners, predictions: scored };
}

async function sendResultAnnouncement(client, guildId, leg, realVn, realThai, awardedUsers, hasExact) {
    try {
        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        const channel = guild?.channels.cache.get(CHANNEL_PHONG_THAN_BANG);
        if (!channel) return;

        const legLabel = leg === 'luot_di' ? 'Lượt đi' : 'Lượt về';

        if (awardedUsers.length === 0) {
            await channel.send(
                `⚽ **Kết quả ${legLabel}:** Việt Nam ${realVn} - ${realThai} Thái Lan\nKhông có ai dự đoán để so khớp.`,
            );
            return;
        }

        const mentions = awardedUsers.map((m) => `<@${m.id}>`).join(', ');
        const verdict = hasExact ? 'đoán trúng chính xác tỉ số' : 'đoán gần đúng nhất';

        await channel.send(
            `⚽ **Kết quả ${legLabel}:** Việt Nam ${realVn} - ${realThai} Thái Lan\n\n` +
            `🔮 Chúc mừng ${mentions} đã ${verdict} và nhận danh hiệu <@&${ROLE_NHA_TIEN_TRI}> **Nhà Tiên Tri Tháng 8/2026**!`,
        );
    } catch (error) {
        logger.warn('[TIEN_TRI] Gửi thông báo kết quả thất bại:', error.message);
    }
}
