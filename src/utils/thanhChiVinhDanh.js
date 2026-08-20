// thanhChiVinhDanh.js — "Thánh chỉ vinh danh" cho 2 trục Tài Sản & Danh Vọng.
// Dùng lại toàn bộ helper, nền, và font từ thanhChiRender.js — chỉ đổi tông màu.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { logger } from './logger.js';
import {
    ensureFonts,
    fitText,
    drawCenteredLines,
    getGioDiaChi,
    getAmLich,
    FONT_REGULAR,
    WIDTH,
    HEIGHT,
    BG_PATH,
} from './thanhChiRender.js';

const TONE = {
    // Trục Tài Sản: đỏ-vàng kim
    taiSan: {
        textColor: '#6b3f00',
        ringColor: '#c9a227',
    },
    // Trục Danh Vọng: xanh ngọc-vàng
    danhVong: {
        textColor: '#064e46',
        ringColor: '#12a58d',
    },
};

async function renderVinhDanh({ avatarURL, topText, bottomText, tone }) {
    ensureFonts();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    const bg = await loadImage(BG_PATH);
    ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);

    const maxTextWidth = WIDTH * 0.72;

    // Nội dung vinh danh dài hơn thánh chỉ mute một chút (có thêm số thứ tự
    // vinh dự) nên tăng maxLines và thêm cỡ chữ dự phòng nhỏ hơn.
    const fitTop = fitText(ctx, topText, maxTextWidth, 5, [34, 30, 26, 22, 20, 18], FONT_REGULAR);
    ctx.fillStyle = tone.textColor;
    ctx.font = `${fitTop.fontSize}px ${FONT_REGULAR}`;
    drawCenteredLines(ctx, fitTop.lines, WIDTH / 2, 244, fitTop.fontSize * 1.35);

    try {
        const avatar = await loadImage(avatarURL);
        const cx = 712, cy = 415, r = 92.5;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
        ctx.strokeStyle = tone.ringColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    } catch (error) {
        logger.warn('[VINH_DANH_RENDER] Không tải được avatar', { error: error.message });
    }

    const fitBottom = fitText(ctx, bottomText, maxTextWidth, 4, [34, 30, 26, 22, 20, 18], FONT_REGULAR);
    ctx.fillStyle = tone.textColor;
    ctx.font = `${fitBottom.fontSize}px ${FONT_REGULAR}`;
    drawCenteredLines(ctx, fitBottom.lines, WIDTH / 2, 535, fitBottom.fontSize * 1.35);

    return await canvas.encode('png');
}

export async function renderVinhDanhTaiSan({ avatarURL, displayName, mocBcoin, tenRole, thuTu }) {
    const now = new Date();
    const gioDiaChi = getGioDiaChi(now);
    const { ngayAm, thangAm, canChiNam } = getAmLich(now);

    const topText = `Sắc Phong! ${displayName} tích luỹ phú quý hơn người, tài sản đạt ${mocBcoin} Bcoin, nay Ban Thưởng danh hiệu ${tenRole}!`;
    const bottomText = `Sắc phong vào giờ ${gioDiaChi}, ngày ${ngayAm} tháng ${thangAm} năm ${canChiNam}.\nLà người thứ ${thuTu} đạt được vinh dự này!`;

    return renderVinhDanh({ avatarURL, topText, bottomText, tone: TONE.taiSan });
}

export async function renderVinhDanhDanhVong({ avatarURL, displayName, level, tenRole, thuTu }) {
    const now = new Date();
    const gioDiaChi = getGioDiaChi(now);
    const { ngayAm, thangAm, canChiNam } = getAmLich(now);

    const topText = `Tấn Phong! ${displayName} dùi mài cần cù nơi trò chuyện, đạt Level ${level}, nay ban Danh Hiệu ${tenRole}!`;
    const bottomText = `Tấn phong vào giờ ${gioDiaChi}, ngày ${ngayAm} tháng ${thangAm} năm ${canChiNam}.\nLà người thứ ${thuTu} đạt được vinh dự này!`;

    return renderVinhDanh({ avatarURL, topText, bottomText, tone: TONE.danhVong });
}
