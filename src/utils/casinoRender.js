import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fontsRegistered = false;
function ensureFonts() {
    if (fontsRegistered) return;
    fontsRegistered = true;
    try {
        GlobalFonts.registerFromPath(
            path.join(__dirname, '../../assets/fonts/BeVietnamPro-Bold.ttf'),
            'CasinoBold'
        );
        GlobalFonts.registerFromPath(
            path.join(__dirname, '../../assets/fonts/BeVietnamPro-Regular.ttf'),
            'CasinoRegular'
        );
    } catch (error) {
        logger.warn('[CASINO_RENDER] Could not load custom fonts, falling back to system font', {
            error: error.message
        });
    }
}

const FONT_BOLD = 'CasinoBold, sans-serif';
const FONT_REGULAR = 'CasinoRegular, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0b3d24');
    gradient.addColorStop(1, '#062015');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const vignette = ctx.createRadialGradient(
        width / 2, height / 2, height / 4,
        width / 2, height / 2, height
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 6;
    roundRect(ctx, 6, 6, width - 12, height - 12, 24);
    ctx.stroke();
}

function drawDiePip(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
}

const PIP_LAYOUTS = {
    1: [[0.5, 0.5]],
    2: [[0.25, 0.25], [0.75, 0.75]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

function drawDie(ctx, x, y, size, value) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;

    const gradient = ctx.createLinearGradient(x, y, x, y + size);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#e2e2e2');
    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, size, size, size * 0.18);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, size * 0.18);
    ctx.stroke();

    const pipRadius = size * 0.075;
    for (const [px, py] of PIP_LAYOUTS[value]) {
        drawDiePip(ctx, x + size * px, y + size * py, pipRadius);
    }
}

const OUTCOME_STYLES = {
    tai: { label: 'TÀI', color: '#e74c3c' },
    xiu: { label: 'XỈU', color: '#3498db' },
    bao: { label: 'BÃO', color: '#f1c40f' },
};

function drawResultBanner(ctx, width, y, label, color) {
    ctx.save();
    ctx.font = `bold 54px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = color;
    ctx.fillText(label, width / 2, y);
    ctx.restore();
}

function drawHistoryStrip(ctx, width, y, history, colorMap) {
    const barWidth = 14;
    const gap = 6;
    const items = history.slice(-20);
    const totalWidth = items.length * (barWidth + gap) - gap;
    const startX = (width - totalWidth) / 2;

    items.forEach((entry, index) => {
        const style = colorMap[entry.outcome] || { color: '#888888' };
        const x = startX + index * (barWidth + gap);
        const isLast = index === items.length - 1;
        ctx.globalAlpha = isLast ? 1 : 0.55 + (0.35 * index) / items.length;
        ctx.fillStyle = style.color;
        roundRect(ctx, x, y, barWidth, barWidth, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
    });

    if (items.length === 0) {
        ctx.font = `16px ${FONT_REGULAR}`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa có lịch sử ván nào', width / 2, y + barWidth / 2);
    }
}

export async function renderTaiXiuImage({ dice, total, outcome, betLabel, betAmount, won, payout, history }) {
    ensureFonts();

    const width = 800;
    const height = 480;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx, width, height);

    ctx.font = `bold 30px ${FONT_BOLD}`;
    ctx.fillStyle = '#d4af37';
    ctx.textAlign = 'center';
    ctx.fillText('TÀI XỈU', width / 2, 56);

    const dieSize = 130;
    const spacing = 40;
    const totalDiceWidth = dieSize * 3 + spacing * 2;
    let dieX = (width - totalDiceWidth) / 2;
    const dieY = 90;
    dice.forEach((value) => {
        drawDie(ctx, dieX, dieY, dieSize, value);
        dieX += dieSize + spacing;
    });

    ctx.font = `bold 26px ${FONT_REGULAR}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`Tổng điểm: ${total}`, width / 2, dieY + dieSize + 40);

    const style = OUTCOME_STYLES[outcome];
    drawResultBanner(ctx, width, dieY + dieSize + 100, style.label, style.color);

    ctx.font = `22px ${FONT_REGULAR}`;
    ctx.fillStyle = won ? '#2ecc71' : '#e74c3c';
    const betText = won
        ? `${betLabel} • Cược ${betAmount.toLocaleString()} • Thắng +${(payout - betAmount).toLocaleString()}`
        : `${betLabel} • Cược ${betAmount.toLocaleString()} • Thua -${betAmount.toLocaleString()}`;
    ctx.fillText(betText, width / 2, dieY + dieSize + 150);

    ctx.font = `16px ${FONT_REGULAR}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Lịch sử phiên gần đây', width / 2, height - 55);
    drawHistoryStrip(ctx, width, height - 40, history, OUTCOME_STYLES);

    return await canvas.encode('png');
}

function drawCoin(ctx, x, y, radius, isRed) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;

    const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    if (isRed) {
        gradient.addColorStop(0, '#ff6b5b');
        gradient.addColorStop(1, '#c0392b');
    } else {
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#d5d5d5');
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `bold ${Math.floor(radius * 0.7)}px ${FONT_BOLD}`;
    ctx.fillStyle = isRed ? '#ffffff' : '#c0392b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isRed ? 'Đ' : 'T', x, y + 2);
}

export async function renderXocDiaImage({ coins, redCount, betLabel, betAmount, won, payout, history }) {
    ensureFonts();

    const width = 800;
    const height = 480;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx, width, height);

    ctx.font = `bold 30px ${FONT_BOLD}`;
    ctx.fillStyle = '#d4af37';
    ctx.textAlign = 'center';
    ctx.fillText('XÓC ĐĨA', width / 2, 56);

    const coinRadius = 55;
    const spacing = 130;
    const totalWidth = spacing * (coins.length - 1);
    let coinX = (width - totalWidth) / 2;
    const coinY = 150;
    coins.forEach((isRed) => {
        drawCoin(ctx, coinX, coinY, coinRadius, isRed);
        coinX += spacing;
    });

    ctx.font = `bold 26px ${FONT_REGULAR}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`Số Đỏ: ${redCount} / 4`, width / 2, coinY + coinRadius + 55);

    const parity = redCount % 2 === 0 ? 'chan' : 'le';
    const parityStyles = {
        chan: { label: 'CHẴN', color: '#2ecc71' },
        le: { label: 'LẺ', color: '#9b59b6' },
    };
    const style = parityStyles[parity];
    drawResultBanner(ctx, width, coinY + coinRadius + 115, style.label, style.color);

    ctx.font = `22px ${FONT_REGULAR}`;
    ctx.fillStyle = won ? '#2ecc71' : '#e74c3c';
    const betText = won
        ? `${betLabel} • Cược ${betAmount.toLocaleString()} • Thắng +${(payout - betAmount).toLocaleString()}`
        : `${betLabel} • Cược ${betAmount.toLocaleString()} • Thua -${betAmount.toLocaleString()}`;
    ctx.fillText(betText, width / 2, coinY + coinRadius + 165);

    ctx.font = `16px ${FONT_REGULAR}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Lịch sử phiên gần đây', width / 2, height - 55);
    drawHistoryStrip(ctx, width, height - 40, history, {
        chan: { color: '#2ecc71' },
        le: { color: '#9b59b6' },
    });

    return await canvas.encode('png');
}
