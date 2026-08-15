import { logger } from './logger.js';

// Sắp xếp tăng dần theo ngưỡng — thứ tự này quan trọng cho thuật toán chọn bậc.
export const WEALTH_TIERS = [
    { tier: 1, threshold: 50000, roleId: '1538163925051510875', name: 'Có Tí Tiền' },
    { tier: 2, threshold: 250000, roleId: '1538164055423062189', name: 'Có Nhiều Tí Tiền' },
    { tier: 3, threshold: 1000000, roleId: '1538164282208944178', name: 'Triệu Phú' },
    { tier: 4, threshold: 10000000, roleId: '1538164400546906112', name: 'Bố Triệu Phú' },
    { tier: 5, threshold: 50000000, roleId: '1538164506683904052', name: 'Tỷ Phú' },
    { tier: 6, threshold: 200000000, roleId: '1538164870556426321', name: 'Vua' },
];

const ALL_ROLE_IDS = WEALTH_TIERS.map(t => t.roleId);

/**
 * Trả về số thứ tự bậc (1-6) tương ứng tổng tài sản, hoặc null nếu chưa đạt bậc nào.
 */
export function getWealthTier(totalWealth) {
    let matched = null;
    for (const t of WEALTH_TIERS) {
        if (totalWealth >= t.threshold) {
            matched = t.tier;
        }
    }
    return matched;
}

/**
 * Đồng bộ role Discord theo bậc mới. Gỡ mọi role bậc cũ (nếu có), gán role bậc mới (nếu có).
 * Không throw ra ngoài — lỗi (thiếu quyền, member rời server...) chỉ ghi log, không ảnh hưởng ví tiền.
 */
export async function syncWealthRole(client, guildId, userId, newTier) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    let member = guild.members.cache.get(userId);
    if (!member) {
        member = await guild.members.fetch(userId).catch(() => null);
    }
    if (!member) return;

    const targetTierInfo = WEALTH_TIERS.find(t => t.tier === newTier) || null;
    const currentWealthRoleIds = member.roles.cache
        .filter(r => ALL_ROLE_IDS.includes(r.id))
        .map(r => r.id);

    const rolesToRemove = currentWealthRoleIds.filter(id => id !== targetTierInfo?.roleId);
    const needsAdd = targetTierInfo && !currentWealthRoleIds.includes(targetTierInfo.roleId);

    try {
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove, 'Cập nhật bậc tài sản');
        }
        if (needsAdd) {
            await member.roles.add(targetTierInfo.roleId, 'Cập nhật bậc tài sản');
            logger.info(`[WEALTH_ROLE] ${userId} lên bậc "${targetTierInfo.name}"`, { guildId, tier: newTier });
        }
    } catch (error) {
        logger.error(`[WEALTH_ROLE] Không thể cập nhật role cho ${userId} (có thể thiếu quyền hoặc vị trí role cao hơn bot)`, {
            error: error.message, guildId, userId
        });
    }
}
