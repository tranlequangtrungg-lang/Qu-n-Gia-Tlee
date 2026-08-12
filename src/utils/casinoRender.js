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
        logger.warn('[CASINO_RENDER] Không tải được font tùy chỉnh, dùng font hệ thống thay thế', {
            error: error.message
        });
    }
}

const FONT_BOLD = 'CasinoBold, sans-serif';
const FONT_REGULAR = 'CasinoRegular, sans-serif';

const WIDTH = 900;
const HEIGHT = 600;

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#0b3d24');
    gradient.addColorStop(1, '#04150d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const vignette = ctx.createRadialGradient(
        WIDTH / 2, HEIGHT / 2, HEIGHT / 4,
        WIDTH / 2, HEIGHT / 2, HEIGHT
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 6;
    roundRect(ctx, 6, 6, WIDTH - 12, HEIGHT - 12, 26);
    ctx.stroke();
}

function drawTitle(ctx, text) {
    ctx.font = `bold 32px ${FONT_BOLD}`;
    ctx.fillStyle = '#d4af37';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, WIDTH / 2, 54);
}

function drawJackpotBanner(ctx, jackpotAmount) {
    ctx.save();
    ctx.font = `bold 22px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`💰 JACKPOT: ${jackpotAmount.toLocaleString()} Bcoin 💰`, WIDTH / 2, 90);
    ctx.restore();
}

// ===================== XÚC XẮC =====================
const DIE_SIZE = 180;
const DIE_GAP = 45;

const PIP_LAYOUTS = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function drawDie(ctx, x, y, size, value) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;

    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, '#3a3a3a');
    gradient.addColorStop(0.35, '#151515');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, size, size, size * 0.16);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, size, size, size * 0.16);
    ctx.clip();
    const highlight = ctx.createRadialGradient(
        x + size * 0.28, y + size * 0.22, 2,
        x + size * 0.28, y + size * 0.22, size * 0.55
    );
    highlight.addColorStop(0, 'rgba(255,255,255,0.35)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(x, y, size, size);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, size * 0.16);
    ctx.stroke();

    if (value) {
        const pipRadius = size * 0.075;
        for (const [px, py] of PIP_LAYOUTS[value]) {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(x + size * px, y + size * py, pipRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }
    }
}

const OUTCOME_STYLES = {
    tai: { label: 'TÀI', color: '#e74c3c' },
    xiu: { label: 'XỈU', color: '#3498db' },
    bao: { label: 'BÃO', color: '#f1c40f' },
};

function drawResultBanner(ctx, y, label, color) {
    ctx.save();
    ctx.font = `bold 60px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.shadowColor = color;
    ctx.shadowBlur = 35;
    ctx.fillStyle = color;
    ctx.fillText(label, WIDTH / 2, y);
    ctx.restore();
}

function drawStatusLine(ctx, y, text, color = '#ffffff') {
    ctx.font = `22px ${FONT_REGULAR}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, WIDTH / 2, y);
}

export async function renderTaiXiuFrame({
    phase,
    revealedValues = [null, null, null],
    statusText = '',
    jackpotAmount = 0,
    betLabel,
    betAmount,
    resultInfo = null,
    balanceText = null,
}) {
    ensureFonts();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawTitle(ctx, 'TÀI XỈU');
    drawJackpotBanner(ctx, jackpotAmount);

    const totalDiceWidth = DIE_SIZE * 3 + DIE_GAP * 2;
    let dieX = (WIDTH - totalDiceWidth) / 2;
    const dieY = 130;

    for (let i = 0; i < 3; i++) {
        let jitterX = 0;
        let jitterY = 0;
        if (phase === 'shaking') {
            jitterX = (Math.random() - 0.5) * 10;
            jitterY = (Math.random() - 0.5) * 10;
        }
        drawDie(ctx, dieX + jitterX, dieY + jitterY, DIE_SIZE, revealedValues[i]);
        dieX += DIE_SIZE + DIE_GAP;
    }

    const belowDiceY = dieY + DIE_SIZE + 55;

    if (phase === 'result' && resultInfo) {
        drawStatusLine(ctx, belowDiceY, `Tổng điểm: ${resultInfo.total}`);
        const style = OUTCOME_STYLES[resultInfo.outcome];
        drawResultBanner(ctx, belowDiceY + 65, style.label, style.color);

        const betColor = resultInfo.won ? '#2ecc71' : '#e74c3c';
        const betText = resultInfo.won
            ? `${betLabel} • Cược ${betAmount.toLocaleString()} • Thắng +${resultInfo.netWinnings.toLocaleString()}`
            : `${betLabel} • Cược ${betAmount.toLocaleString()} • Thua -${betAmount.toLocaleString()}`;
        drawStatusLine(ctx, belowDiceY + 115, betText, betColor);

        if (balanceText) {
            drawStatusLine(ctx, belowDiceY + 150, balanceText, 'rgba(255,255,255,0.6)');
        }
    } else {
        drawStatusLine(ctx, belowDiceY + 20, statusText || `${betLabel} • Cược ${betAmount.toLocaleString()}`);
    }

    return await canvas.encode('png');
}

// ===================== XÓC ĐĨA =====================
const COIN_RADIUS = 65;
const COIN_GAP = 150;

function drawCoin(ctx, x, y, radius, isRed) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;

    const gradient = ctx.createRadialGradient(
        x - radius * 0.3, y - radius * 0.3, radius * 0.1,
        x, y, radius
    );
    gradient.addColorStop(0, '#fff3c0');
    gradient.addColorStop(0.5, '#e6b800');
    gradient.addColorStop(1, '#8a6a00');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#fff3c0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#5c4600';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (isRed !== null) {
        ctx.font = `bold ${Math.floor(radius * 0.75)}px ${FONT_BOLD}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isRed ? '#c0392b' : '#1a1a1a';
        ctx.fillText(isRed ? 'Đ' : 'T', x, y + 3);
    }
}

export async function renderXocDiaFrame({
    phase,
    revealedCoins = [null, null, null, null],
    statusText = '',
    jackpotAmount = 0,
    betLabel,
    betAmount,
    resultInfo = null,
    balanceText = null,
}) {
    ensureFonts();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawTitle(ctx, 'XÓC ĐĨA');
    drawJackpotBanner(ctx, jackpotAmount);

    const totalWidth = COIN_GAP * 3;
    let coinX = (WIDTH - totalWidth) / 2;
    const coinY = 200;

    for (let i = 0; i < 4; i++) {
        let jitterX = 0;
        let jitterY = 0;
        if (phase === 'shaking') {
            jitterX = (Math.random() - 0.5) * 10;
            jitterY = (Math.random() - 0.5) * 10;
        }
        drawCoin(ctx, coinX + jitterX, coinY + jitterY, COIN_RADIUS, revealedCoins[i]);
        coinX += COIN_GAP;
    }

    const belowY = coinY + COIN_RADIUS + 60;

    if (phase === 'result' && resultInfo) {
        drawStatusLine(ctx, belowY, `${resultInfo.redCount} Đỏ / 4`);
        const parityLabel = resultInfo.redCount % 2 === 0 ? 'CHẴN' : 'LẺ';
        const parityColor = resultInfo.redCount % 2 === 0 ? '#2ecc71' : '#9b59b6';
        drawResultBanner(ctx, belowY + 65, parityLabel, parityColor);

        const betColor = resultInfo.won ? '#2ecc71' : '#e74c3c';
        const betText = resultInfo.won
            ? `${betLabel} • Cược ${betAmount.toLocaleString()} • Thắng +${resultInfo.netWinnings.toLocaleString()}`
            : `${betLabel} • Cược ${betAmount.toLocaleString()} • Thua -${betAmount.toLocaleString()}`;
        drawStatusLine(ctx, belowY + 115, betText, betColor);

        if (balanceText) {
            drawStatusLine(ctx, belowY + 150, balanceText, 'rgba(255,255,255,0.6)');
        }
    } else {
        drawStatusLine(ctx, belowY + 20, statusText || `${betLabel} • Cược ${betAmount.toLocaleString()}`);
    }

    return await canvas.encode('png');
}

export async function renderJackpotCard({ taixiuJackpot, xocdiaJackpot }) {
    ensureFonts();
    const canvas = createCanvas(WIDTH, 320);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawTitle(ctx, '💰 JACKPOT CASINO 💰');

    ctx.font = `bold 30px ${FONT_BOLD}`;
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.fillText(`Tài Xỉu: ${taixiuJackpot.toLocaleString()} Bcoin`, WIDTH / 2, 160);
    ctx.fillText(`Xóc Đĩa: ${xocdiaJackpot.toLocaleString()} Bcoin`, WIDTH / 2, 220);

    return await canvas.encode('png');
}
