import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPaginationRow } from '../../utils/components.js';

const QUEUE_PAGE_SIZE = 10;
const PROGRESS_BAR_LENGTH = 12;

// Giữ nguyên các customId này — nút bấm ở nơi khác trong code đang dùng đúng
// các ID này để nhận diện, đổi tên ở đây sẽ làm nút ngừng hoạt động.
export const MUSIC_BUTTON_IDS = {
    PAUSE: 'music_pause',
    RESUME: 'music_resume',
    SKIP: 'music_skip',
    STOP: 'music_stop',
    SHUFFLE: 'music_shuffle',
    LOOP: 'music_loop',
    VOL_DOWN: 'music_vol_down',
    VOL_UP: 'music_vol_up',
    QUEUE: 'music_queue',
    QUEUE_FIRST: 'music_queue_first',
    QUEUE_PREV: 'music_queue_prev',
    QUEUE_NEXT: 'music_queue_next',
    QUEUE_LAST: 'music_queue_last',
};

export function formatDuration(ms) {
    if (!ms || Number.isNaN(ms)) {
        return 'Trực tiếp';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getTrackArtwork(track) {
    return track?.info?.artworkUrl || track?.info?.thumbnail || null;
}

function getLoopLabel(loop) {
    switch (loop) {
        case 'track':
            return '🔂 Bài hát';
        case 'queue':
            return '🔁 Cả hàng chờ';
        default:
            return 'Tắt';
    }
}

// Thanh tiến trình dạng chữ, đẹp hơn khi chỉ hiện số giây — vd: ▬▬▬🔘▬▬▬▬▬▬▬
function buildProgressBar(currentMs, totalMs) {
    if (!totalMs || Number.isNaN(totalMs) || totalMs <= 0) {
        return '🔴 TRỰC TIẾP';
    }
    const ratio = Math.min(Math.max((currentMs || 0) / totalMs, 0), 1);
    const filled = Math.round(ratio * PROGRESS_BAR_LENGTH);
    const empty = Math.max(PROGRESS_BAR_LENGTH - filled, 0);
    return `${'▬'.repeat(filled)}🔘${'▬'.repeat(empty)}`;
}

export function buildNowPlayingEmbed(track, player, guildData) {
    const requester = track?.info?.requester;
    const requesterLabel = requester
        ? (requester.username || requester.tag || 'Không rõ')
        : 'Không rõ';

    const positionMs = player?.position || 0;
    const durationMs = track?.info?.length || 0;
    const position = formatDuration(positionMs);
    const duration = formatDuration(durationMs);
    const progressBar = buildProgressBar(positionMs, durationMs);
    const isPaused = Boolean(player?.paused);

    return createEmbed({
        title: '🎶 Đang Phát',
        description: `**${track?.info?.title || 'Không rõ tên bài hát'}**\n${progressBar}\n\`${position} / ${duration}\``,
        color: isPaused ? 'warning' : 'primary',
        fields: [
            { name: '🎤 Nghệ Sĩ', value: track?.info?.author || 'Không rõ', inline: true },
            { name: '🙋 Người Yêu Cầu', value: requesterLabel, inline: true },
            { name: '🔊 Âm Lượng', value: `${guildData?.volume ?? 75}%`, inline: true },
            { name: '🔁 Lặp Lại', value: getLoopLabel(guildData?.loop), inline: true },
            { name: '📋 Hàng Chờ', value: `${player?.queue?.length || 0} bài`, inline: true },
        ],
        thumbnail: getTrackArtwork(track),
        footer: isPaused ? '⏸️ Đã tạm dừng' : '▶️ Đang phát',
    });
}

export function buildQueueEmbed(queue, currentTrack, page = 0) {
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const slice = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];

    let description = '';
    if (currentTrack) {
        description += `**🎶 Đang phát**\n${currentTrack.info?.title || 'Không rõ'} — ${currentTrack.info?.author || 'Không rõ'}\n\n`;
    }

    if (slice.length === 0) {
        description += 'Hàng chờ đang trống.';
    } else {
        description += slice
            .map((track, index) => {
                const num = start + index + 1;
                return `**${num}.** ${track.info?.title || 'Không rõ'} — ${track.info?.author || 'Không rõ'}`;
            })
            .join('\n');
    }

    return createEmbed({
        title: '📋 Hàng Chờ Nhạc',
        description: description.substring(0, 4096),
        color: 'info',
        footer: `Trang ${safePage + 1}/${totalPages} • ${totalTracks} bài trong hàng chờ`,
    });
}

export function buildPlayerButtonRows(player, guildData) {
    const paused = player?.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.PAUSE)
            .setLabel('Tạm Dừng')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⏸️')
            .setDisabled(Boolean(paused)),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.RESUME)
            .setLabel('Tiếp Tục')
            .setStyle(ButtonStyle.Success)
            .setEmoji('▶️')
            .setDisabled(!paused),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SKIP)
            .setLabel('Bỏ Qua')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.STOP)
            .setLabel('Dừng')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SHUFFLE)
            .setLabel('Xáo Trộn')
            .setStyle(guildData?.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔀'),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.LOOP)
            .setLabel('Lặp Lại')
            .setStyle(guildData?.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔁'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_DOWN)
            .setLabel('Giảm Âm')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔉'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_UP)
            .setLabel('Tăng Âm')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔊'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.QUEUE)
            .setLabel('Hàng Chờ')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
    );

    return [row1, row2];
}

export function buildQueuePaginationRow(page, totalPages) {
    return getPaginationRow('music_queue', page + 1, totalPages);
}

export function getQueuePageSize() {
    return QUEUE_PAGE_SIZE;
}
