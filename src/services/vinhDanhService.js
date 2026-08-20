// vinhDanhService.js — Hệ thống "thánh chỉ vinh danh" cho 2 trục Tài Sản & Danh Vọng.

import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { renderVinhDanhTaiSan, renderVinhDanhDanhVong } from '../utils/thanhChiVinhDanh.js';

// Mốc phải xếp theo thứ tự TĂNG DẦN — logic tìm "mốc cao nhất đã đạt" dựa vào thứ tự này.
export const TAI_SAN_MOCS = [
    { threshold: 50000, name: 'Có Tí Tiền', roleId: '1538163925051510875' },
    { threshold: 250000, name: 'Có Nhiều Tí Tiền', roleId: '1538164055423062189' },
    { threshold: 1000000, name: 'Triệu Phú', roleId: '1538164282208944178' },
    { threshold: 10000000, name: 'Bố Triệu Phú', roleId: '1538164400546906112' },
    { threshold: 50000000, name: 'Tỷ Phú', roleId: '1538164506683904052' },
    { threshold: 100000000, name: 'Vua', roleId: '1538164870556426321' },
];

export const DANH_VONG_MOCS = [
    { threshold: 15, name: 'Người Bạn Kĩ Năng Thấp', roleId: '1539850440710033529' },
    { threshold: 30, name: 'Người Bạn Kĩ Năng Cao', roleId: '1539850701021257729' },
    { threshold: 50, name: 'Có Tiềm Năng', roleId: '1539850964717277295' },
    { threshold: 75, name: 'Vua Lầu Cây', roleId: '1539851108992688180' },
    { threshold: 100, name: 'Phạm Nhật Vượng', roleId: '1539851204769878108' },
];

const CHANNEL_TAI_SAN = '1539852102313058395'; // #Ai-là-triệu-phú
const CHANNEL_DANH_VONG = '1539851934222131292'; // #bảng-phong-thần

// Đếm số thứ tự vinh dự cho từng mốc (dùng chung pattern key-value như
// generateCaseId trong moderation.js).
async function incrementMocCounter(guildId, mocKey) {
    const key = `vinhdanh_counter_${guildId}_${mocKey}`;
    const current = await getFromDb(key, 0);
    const next = current + 1;
    await setInDb(key, next);
    return next;
}

async function sendVinhDanhImage(client, guildId, channelId, buffer, filename) {
    try {
        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        const channel = guild?.channels.cache.get(channelId);
        if (!channel) {
            logger.warn(`[VINH_DANH] Không tìm thấy kênh ${channelId} trong guild ${guildId}`);
            return;
        }
        await channel.send({ files: [{ attachment: buffer, name: filename }] });
    } catch (error) {
        logger.warn('[VINH_DANH] Gửi ảnh vinh danh thất bại:', error.message);
    }
}

// Tìm mốc cao nhất mà giá trị hiện tại đã đạt được trong 1 danh sách mốc.
function findTargetMoc(mocs, value) {
    let target = null;
    for (const moc of mocs) {
        if (value >= moc.threshold) {
            target = moc;
        }
    }
    return target;
}

/**
 * Gọi hàm này mỗi khi tổng Bcoin (ví + ngân hàng) của 1 user thay đổi.
 * Tự xác định mốc mới (nếu có), gán/gỡ role, và gửi thánh chỉ vinh danh.
 * An toàn để gọi thường xuyên — tự thoát sớm nếu không có gì thay đổi.
 */
export async function checkTaiSanMoc(client, guildId, userId, tongBcoin) {
    try {
        const targetMoc = findTargetMoc(TAI_SAN_MOCS, tongBcoin);
        if (!targetMoc) return;

        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const axisRoleIds = TAI_SAN_MOCS.map((m) => m.roleId);
        const alreadyHasTarget = member.roles.cache.has(targetMoc.roleId);
        if (alreadyHasTarget) return; // đã ở đúng mốc cao nhất, không có gì mới

        const rolesToRemove = axisRoleIds.filter((id) => id !== targetMoc.roleId && member.roles.cache.has(id));
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove, 'Nâng mốc Tài Sản mới').catch((error) => {
                logger.warn('[VINH_DANH] Không gỡ được role Tài Sản cũ:', error.message);
            });
        }

        await member.roles.add(targetMoc.roleId, 'Đạt mốc Tài Sản mới').catch((error) => {
            logger.warn('[VINH_DANH] Không gán được role Tài Sản mới:', error.message);
        });

        const thuTu = await incrementMocCounter(guildId, `taisan_${targetMoc.roleId}`);

        const buffer = await renderVinhDanhTaiSan({
            avatarURL: member.displayAvatarURL({ extension: 'png', size: 256 }),
            displayName: member.displayName,
            mocBcoin: targetMoc.threshold.toLocaleString('vi-VN'),
            tenRole: targetMoc.name,
            thuTu,
        });

        await sendVinhDanhImage(client, guildId, CHANNEL_TAI_SAN, buffer, `sac-phong-tai-san-${userId}.png`);
        logger.info(`[VINH_DANH] ${member.user.tag} đạt mốc Tài Sản "${targetMoc.name}" (thứ ${thuTu})`);
    } catch (error) {
        logger.warn('[VINH_DANH] checkTaiSanMoc lỗi:', error.message);
    }
}

/**
 * Gọi hàm này mỗi khi 1 user vừa lên level (leveling XP). Tương tự
 * checkTaiSanMoc nhưng cho trục Danh Vọng.
 */
export async function checkDanhVongMoc(client, guildId, userId, level) {
    try {
        const targetMoc = findTargetMoc(DANH_VONG_MOCS, level);
        if (!targetMoc) return;

        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const axisRoleIds = DANH_VONG_MOCS.map((m) => m.roleId);
        const alreadyHasTarget = member.roles.cache.has(targetMoc.roleId);
        if (alreadyHasTarget) return;

        const rolesToRemove = axisRoleIds.filter((id) => id !== targetMoc.roleId && member.roles.cache.has(id));
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove, 'Nâng mốc Danh Vọng mới').catch((error) => {
                logger.warn('[VINH_DANH] Không gỡ được role Danh Vọng cũ:', error.message);
            });
        }

        await member.roles.add(targetMoc.roleId, 'Đạt mốc Danh Vọng mới').catch((error) => {
            logger.warn('[VINH_DANH] Không gán được role Danh Vọng mới:', error.message);
        });

        const thuTu = await incrementMocCounter(guildId, `danhvong_${targetMoc.roleId}`);

        const buffer = await renderVinhDanhDanhVong({
            avatarURL: member.displayAvatarURL({ extension: 'png', size: 256 }),
            displayName: member.displayName,
            level,
            tenRole: targetMoc.name,
            thuTu,
        });

        await sendVinhDanhImage(client, guildId, CHANNEL_DANH_VONG, buffer, `tan-phong-danh-vong-${userId}.png`);
        logger.info(`[VINH_DANH] ${member.user.tag} đạt mốc Danh Vọng "${targetMoc.name}" (thứ ${thuTu})`);
    } catch (error) {
        logger.warn('[VINH_DANH] checkDanhVongMoc lỗi:', error.message);
    }
}
