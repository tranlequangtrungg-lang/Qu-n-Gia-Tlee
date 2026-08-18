import { createEmbed } from '../../utils/embeds.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { CATEGORY_ROOMS, SUBCOMMAND_ROOMS } from '../../utils/commandRooms.js';

export const GROUP_ORDER = ['economy', 'fun', 'music', 'roles'];
export const GROUPS = {
    economy: { label: '💰 Kiếm Bcoin', color: 'economy' },
    fun: { label: '🎮 Giải Trí', color: 'fuchsia' },
    music: { label: '🎵 Nghe Nhạc', color: 'blurple' },
    roles: { label: '🎭 Vai Trò', color: 'green' },
};

// Mô tả tiếng Việt cho từng lệnh. Nếu 1 lệnh không có ở đây, hệ thống sẽ
// dùng tạm mô tả gốc (thường là tiếng Anh) kèm ghi chú "(chưa dịch)" để bạn
// biết lệnh nào còn thiếu bản dịch — chỉ cần thêm dòng vào object này.
const VI_DESCRIPTIONS = {
    balance: 'Xem số dư Bcoin của bạn hoặc người khác',
    beg: 'Xin một ít tiền',
    buy: 'Mua vật phẩm từ cửa hàng',
    crime: 'Phạm tội để kiếm tiền (rủi ro cao)',
    daily: 'Nhận thưởng hằng ngày',
    deposit: 'Gửi tiền từ ví vào ngân hàng',
    economy: 'Các lệnh quản lý kinh tế',
    eleaderboard: 'Xem bảng xếp hạng 10 người giàu nhất server',
    fish: 'Đi câu cá để kiếm tiền',
    gamble: 'Đặt cược tiền để có cơ hội thắng nhiều hơn',
    inventory: 'Xem túi đồ kinh tế của bạn',
    mine: 'Đào mỏ để kiếm tiền',
    pay: 'Chuyển tiền cho người khác',
    rob: 'Thử cướp tiền người khác (rất rủi ro)',
    shop: 'Xem cửa hàng kinh tế',
    'shop-config': 'Cấu hình cửa hàng (cần quyền Manage Server)',
    slut: 'Làm việc rủi ro để nhận thưởng ngẫu nhiên hoặc mất tiền',
    withdraw: 'Rút tiền từ ngân hàng về ví',
    work: 'Đi làm để kiếm tiền',

    // Giải Trí
    count: 'Quản lý trò chơi đếm số của server',
    fight: 'Bắt đầu 1 trận đấu giả lập 1vs1 bằng chữ',
    flip: 'Tung đồng xu (Ngửa hoặc Sấp)',
    roll: 'Đổ xúc xắc theo cú pháp chuẩn (vd: 2d20, 1d6 + 5)',

    // Nghe Nhạc
    join: 'Vào kênh thoại của bạn (chưa phát nhạc)',
    music: 'Quản lý phát nhạc, hàng chờ và cài đặt phiên thoại',
    nowplaying: 'Xem bài đang phát',
    play: 'Phát 1 bài hát hoặc thêm vào hàng chờ',
    queue: 'Xem hàng chờ nhạc hiện tại',

    // Vai Trò
    reactroles: 'Quản lý gán vai trò qua reaction',
};

function normalizeCategory(raw) {
    return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function resolveGroupKey(command) {
    // /casino luôn thuộc nhóm Giải Trí bất kể category ghi là gì.
    if (command.data?.name === 'casino') {
        return 'fun';
    }

    // So sánh không phân biệt hoa/thường và khoảng trắng/gạch dưới, để không
    // bị lệch nếu các file lệnh ghi category không đồng nhất kiểu chữ.
    const normalized = normalizeCategory(command.category);
    if (normalized === 'economy') return 'economy';
    if (normalized === 'fun') return 'fun';
    if (normalized === 'music') return 'music';
    if (normalized === 'reaction_roles' || normalized === 'roles') return 'roles';
    return null;
}

export function buildGroupedCommands(client) {
    const groups = { economy: [], fun: [], music: [], roles: [] };
    for (const command of client.commands.values()) {
        const key = resolveGroupKey(command);
        if (key) {
            groups[key].push(command);
        }
    }
    for (const key of GROUP_ORDER) {
        groups[key].sort((a, b) => a.data.name.localeCompare(b.data.name));
    }
    return groups;
}

// Lấy danh sách lệnh thật từ Discord để có ID chính xác cho link bấm-điền.
// Trước đây chỉ fetch() không kèm guildId -> chỉ thấy lệnh đăng ký toàn cục
// (global), bỏ sót lệnh đăng ký riêng theo server -> ID sai -> bấm không ăn.
// Giờ lấy cả 2 nguồn rồi gộp lại, ưu tiên bản riêng theo server nếu trùng tên.
async function fetchAppCommands(client, guildId) {
    try {
        const [globalCommands, guildCommands] = await Promise.all([
            client.application.commands.fetch().catch(() => new Map()),
            guildId
                ? client.application.commands.fetch({ guildId }).catch(() => new Map())
                : Promise.resolve(new Map()),
        ]);

        const merged = new Map();
        for (const cmd of globalCommands.values()) {
            merged.set(cmd.name, cmd);
        }
        for (const cmd of guildCommands.values()) {
            merged.set(cmd.name, cmd);
        }
        return merged;
    } catch (error) {
        return new Map();
    }
}

// Tên hiển thị tiếng Việt cho các subcommand bị giới hạn theo kênh riêng
// (key trùng với SUBCOMMAND_ROOMS trong commandRooms.js).
const VI_SUBCOMMAND_LABELS = {
    'casino:taixiu': 'Tài Xỉu Đơn',
    'casino:tx': 'Tài Xỉu Nhóm',
    'casino:xocdia': 'Xóc Đĩa',
};

function mentionOrFallback(name, appCommands) {
    const found = appCommands.get(name);
    return found ? `</${name}:${found.id}>` : `\`/${name}\``;
}

// Discord hỗ trợ link bấm-điền luôn cả subcommand: "</name subcommand:id>".
// Bấm vào sẽ tự điền sẵn cả "/name subcommand ", không chỉ mỗi "/name" —
// quan trọng với /casino vì 3 trò chơi khác nhau, khác kênh khác nhau.
function mentionSubcommandOrFallback(commandName, subcommandName, appCommands) {
    const found = appCommands.get(commandName);
    return found
        ? `</${commandName} ${subcommandName}:${found.id}>`
        : `\`/${commandName} ${subcommandName}\``;
}

function describeCommand(command) {
    const name = command.data.name;
    if (VI_DESCRIPTIONS[name]) {
        return VI_DESCRIPTIONS[name];
    }
    const original = command.data.description || '';
    return original ? `${original} _(chưa dịch)_` : '_(chưa có mô tả)_';
}

// Nếu 1 lệnh có subcommand bị giới hạn theo kênh riêng (vd /casino), tách ra
// từng dòng riêng — mỗi dòng 1 link bấm-điền cho đúng subcommand đó, kèm
// đúng kênh của nó. Trả về null nếu lệnh không có subcommand nào như vậy,
// để buildCategoryView biết cần in dòng lệnh bình thường thay vào đó.
function buildRestrictedSubcommandLines(command, appCommands) {
    const commandName = command.data.name;
    const entries = Object.entries(SUBCOMMAND_ROOMS).filter(([key]) => key.startsWith(`${commandName}:`));
    if (entries.length === 0) {
        return null;
    }

    return entries.map(([key, channelId]) => {
        const subcommand = key.split(':')[1];
        const mention = mentionSubcommandOrFallback(commandName, subcommand, appCommands);
        const label = VI_SUBCOMMAND_LABELS[key] || subcommand;
        return `${mention} — ${label} · dùng ở <#${channelId}>`;
    });
}

export function buildOverviewButtons(groups) {
    const buttons = GROUP_ORDER
        .filter((key) => groups[key].length > 0)
        .map((key) =>
            new ButtonBuilder()
                .setCustomId(`tleecuube-view_${key}`)
                .setLabel(GROUPS[key].label)
                .setStyle(ButtonStyle.Secondary),
        );
    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];
}

export async function buildOverviewView(client) {
    const groups = buildGroupedCommands(client);
    const embed = createEmbed({
        title: '📖 Danh Sách Lệnh',
        description: 'Chọn 1 mục bên dưới để xem danh sách lệnh chi tiết.',
        color: 'primary',
        fields: GROUP_ORDER
            .filter((key) => groups[key].length > 0)
            .map((key) => ({
                name: GROUPS[key].label,
                value: `${groups[key].length} lệnh`,
                inline: true,
            })),
    });
    return {
        embeds: [embed],
        components: buildOverviewButtons(groups),
    };
}

export async function buildCategoryView(client, key, guildId) {
    const groups = buildGroupedCommands(client);
    const commands = groups[key] || [];
    const appCommands = await fetchAppCommands(client, guildId);
    const group = GROUPS[key];

    // Nếu cả nhóm dùng chung 1 kênh (kiếm Bcoin, nhạc), hiện 1 dòng ghi chú
    // chung ở đầu thay vì lặp lại trên từng dòng lệnh.
    const categoryChannelId = CATEGORY_ROOMS[key];
    const roomBanner = categoryChannelId
        ? `📍 Toàn bộ lệnh trong mục này chỉ dùng được ở <#${categoryChannelId}>.\n\n`
        : '';

    const lines = commands.flatMap((cmd) => {
        // /casino (và bất kỳ lệnh nào khác có subcommand bị giới hạn kênh
        // riêng) sẽ được tách thành nhiều dòng — mỗi trò chơi 1 dòng, 1 link
        // bấm-điền riêng, đúng kênh riêng của nó.
        const subLines = buildRestrictedSubcommandLines(cmd, appCommands);
        if (subLines) {
            return subLines;
        }
        const mention = mentionOrFallback(cmd.data.name, appCommands);
        return [`${mention} — ${describeCommand(cmd)}`];
    });

    const description = lines.length > 0
        ? roomBanner + lines.join('\n')
        : 'Chưa có lệnh nào trong mục này.';

    const embed = createEmbed({
        title: group.label,
        description,
        color: group.color,
    });

    const backButton = new ButtonBuilder()
        .setCustomId('tleecuube-back')
        .setLabel('⬅️ Quay lại')
        .setStyle(ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(backButton)],
    };
}
