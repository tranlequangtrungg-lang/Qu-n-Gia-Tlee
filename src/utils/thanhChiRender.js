import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import { SolarDate } from '@nghiavuive/lunar_date_vi';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG_PATH = path.join(__dirname, '../../assets/images/thanhchi_bg.png');

let fontsRegistered = false;
function ensureFonts() {
    if (fontsRegistered) return;
    fontsRegistered = true;
    try {
        GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/BeVietnamPro-Bold.ttf'), 'CasinoBold');
        GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/BeVietnamPro-Regular.ttf'), 'CasinoRegular');
    } catch (error) {
        logger.warn('[THANHCHI_RENDER] Không tải được font, dùng font hệ thống', { error: error.message });
    }
}

const FONT_BOLD = 'CasinoBold, sans-serif';
const FONT_REGULAR = 'CasinoRegular, sans-serif';
const WIDTH = 1424;
const HEIGHT = 752;

const GIO_DIA_CHI = [
    ['Tý', 23, 1], ['Sửu', 1, 3], ['Dần', 3, 5], ['Mão', 5, 7],
    ['Thìn', 7, 9], ['Tỵ', 9, 11], ['Ngọ', 11, 13], ['Mùi', 13, 15],
    ['Thân', 15, 17], ['Dậu', 17, 19], ['Tuất', 19, 21], ['Hợi', 21, 23],
];

function getGioDiaChi(date = new Date()) {
    const h = date.getHours();
    const hit = GIO_DIA_CHI.find(([, start, end]) => (start < end ? h >= start && h < end : h >= start || h < end));
    return hit ? hit[0] : 'Tý';
}

function getAmLich(date = new Date()) {
    try {
        const solar = new SolarDate(date);
        const lunar = solar.toLunarDate();
        // Tên năm âm lịch dạng Can-Chi (vd "Bính Ngọ"). Nếu bản lib khác không có
        // getYearName/getMonthName, fallback về số ngày/tháng thô.
        const canChiNam = typeof lunar.getYearName === 'function' ? lunar.getYearName() : `${lunar.year}`;
        return { ngayAm: lunar.day, thangAm: lunar.month, canChiNam };
    } catch (error) {
        logger.warn('[THANHCHI_RENDER] Lỗi tính âm lịch', { error: error.message });
        return { ngayAm: '?', thangAm: '?', canChiNam: '?' };
    }
}

// Wrap text theo maxWidth, trả về mảng dòng
function wrapLines(ctx, text, maxWidth) {
    const paragraphs = text.split('\n');
    const lines = [];
    for (const para of paragraphs) {
        const words = para.split(' ');
        let current = '';
        for (const w of words) {
            const test = current ? ${current} ${w} : w;
            if (ctx.measureText(test).width > maxWidth && current) {
                lines.push(current);
                current = w;
            } else {
                current = test;
            }
        }
        if (current) lines.push(current);
    }
    return lines;
}

// Thử các cỡ chữ giảm dần cho đến khi số dòng vừa maxLines, trả {fontSize, lines}
function fitText(ctx, text, maxWidth, maxLines, sizes, fontFamily) {
    for (const size of sizes) {
        ctx.font = `${size}px ${fontFamily}`;
        const lines = wrapLines(ctx, text, maxWidth);
        if (lines.length <= maxLines) return { fontSize: size, lines };
    }
    const size = sizes[sizes.length - 1];
    ctx.font = `${size}px ${fontFamily}`;
    return { fontSize: size, lines: wrapLines(ctx, text, maxWidth).slice(0, maxLines) };
}

function drawCenteredLines(ctx, lines, centerX, startY, lineHeight) {
    ctx.textAlign = 'center';
    lines.forEach((line, i) => ctx.fillText(line, centerX, startY + i * lineHeight));
}

/**
 * @param {object} p
 * @param {string} p.avatarURL
 * @param {string} p.displayName - biệt danh server, KHÔNG dùng mention
 * @param {string} p.lyDo
 * @param {string} p.thoiGianText - chuỗi hiển thị đã format sẵn (vd "3 tiếng")
 */
export async function renderThanhChi({ avatarURL, displayName, lyDo, thoiGianText }) {
    ensureFonts();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    const bg = await loadImage(BG_PATH);
    ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);

    const now = new Date();
    const gioDiaChi = getGioDiaChi(now);
    const { ngayAm, thangAm, canChiNam } = getAmLich(now);

    const maxTextWidth = WIDTH * 0.72;

    // Đoạn trên
    const topText = `TRUYỀN LỆNH!\nTội đồ ${displayName} vào giờ ${gioDiaChi}, ngày mùng ${ngayAm} tháng ${thangAm} năm ${canChiNam}, đã phạm tội ${lyDo}.`;
        ctx.font = `bold 32px ${FONT_BOLD}`;
    const bodyTop = `Tội đồ ${displayName} vào giờ ${gioDiaChi}, ngày mùng ${ngayAm} tháng ${thangAm} năm ${canChiNam}, đã phạm tội ${lyDo}.`;
        ctx.font = `${fitTop.fontSize}px ${FONT_REGULAR}`;
    const bodyBottom = `Tang vật đã tịch thu đầy đủ.\nTuyên phạt đày đi khổ sai ${thoiGianText}.\nThi hành hình phạt ngay lập tức!`;
        ctx.font = `${fitBottom.fontSize}px ${FONT_REGULAR}`;
    drawCenteredLines(ctx, fitTop.lines, WIDTH / 2, 244, fitTop.fontSize * 1.35);

    // Avatar tròn
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
        ctx.strokeStyle = '#8a1c1c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    } catch (error) {
        logger.warn('[THANHCHI_RENDER] Không tải được avatar', { error: error.message });
    }

    // Đoạn dưới
    const bodyBottom = `Tang vật đã tịch thu đầy đủ.\nTuyên phạt đày đi khổ sai ${thoiGianText}.\nThi hành hình phạt ngay lập tức!`;
    const fitBottom = fitText(ctx, bodyBottom, maxTextWidth, 3, [34, 30, 26, 22, 20], FONT_REGULAR);
    ctx.font = `${fitBottom.fontSize}px ${FONT_REGULAR}`;
    drawCenteredLines(ctx, fitBottom.lines, WIDTH / 2, 535, fitBottom.fontSize * 1.35);

    return await canvas.encode('png');
}
