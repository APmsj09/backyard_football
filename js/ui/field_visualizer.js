const FIELD_WIDTH_YARDS = 53.3;
const FIELD_LENGTH_YARDS = 120;
const PADDING_Y_YARDS = 1.0;
const VIEW_HEIGHT_YARDS = FIELD_WIDTH_YARDS + (PADDING_Y_YARDS * 2);

export function formatGameClock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(s / 60);
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

export function showPlayOverlay(text) {
    const overlay = document.getElementById('sim-play-overlay');
    if (overlay) {
        let cleanText = text.replace(/\[Tick \d+\] /g, '');
        overlay.textContent = cleanText;
        overlay.style.opacity = '1';

        if (overlay.timeoutId) clearTimeout(overlay.timeoutId);
        overlay.timeoutId = setTimeout(() => { overlay.style.opacity = '0'; }, 3000);
    }
}

export function drawFieldVisualization(canvas, ctx, frameData, homeColor = '#0000aa', awayColor = '#aa0000', homeName = 'HOME', awayName = 'AWAY') {
    if (!canvas || !ctx || !frameData) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    const ppY = h / VIEW_HEIGHT_YARDS;
    const VIEW_LENGTH_YARDS = w / ppY;
    const ballY = frameData.ball ? frameData.ball.y : 60;

    const MIN_CAM_Y = 0;
    const MAX_CAM_Y = FIELD_LENGTH_YARDS - VIEW_LENGTH_YARDS;

    let camBottomY = ballY - (VIEW_LENGTH_YARDS / 2);
    camBottomY = Math.max(MIN_CAM_Y, Math.min(MAX_CAM_Y, camBottomY));

    const toScreenX = (fieldY) => (fieldY - camBottomY) * ppY;
    const toScreenY = (fieldX) => (fieldX + PADDING_Y_YARDS) * ppY;

    ctx.fillStyle = "#1a4d2e";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(26, 77, 46, 0.3)";
    for (let stripe = 0; stripe < w; stripe += ppY * 5) {
        ctx.fillRect(stripe, 0, ppY * 2.5, h);
    }

    ctx.lineWidth = Math.max(1, ppY * 0.03);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";

    const startYard = Math.floor(camBottomY) - 1;
    const endYard = Math.ceil(camBottomY + VIEW_LENGTH_YARDS) + 1;

    for (let y = startYard; y <= endYard; y++) {
        const sy = toScreenX(y);
        if (sy >= -10 && sy <= w + 10) {
            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(0) - ppY * 0.15);
            ctx.lineTo(sy, toScreenY(0));
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(FIELD_WIDTH_YARDS) + ppY * 0.15);
            ctx.lineTo(sy, toScreenY(FIELD_WIDTH_YARDS));
            ctx.stroke();
        }
    }

    ctx.lineWidth = Math.max(1, ppY * 0.05);
    ctx.font = `bold ${ppY * 0.8}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const startYard10 = Math.floor(camBottomY / 10) * 10;
    const endYard10 = Math.floor((camBottomY + VIEW_LENGTH_YARDS) / 10) * 10 + 10;

    for (let y = startYard10; y <= endYard10; y += 10) {
        const sy = toScreenX(y);

        if (y === 10 || y === 110) {
            ctx.lineWidth = Math.max(3, ppY * 0.2);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        } else if (y % 20 === 0) {
            ctx.lineWidth = Math.max(2, ppY * 0.08);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        } else {
            ctx.lineWidth = Math.max(1, ppY * 0.05);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        }

        ctx.beginPath();
        ctx.moveTo(sy, 0);
        ctx.lineTo(sy, h);
        ctx.stroke();

        if (y >= 10 && y < 110 && y % 10 === 0) {
            const num = y <= 50 ? y - 10 : 110 - y;
            if (num > 0) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
                ctx.font = `bold ${ppY * 0.9}px monospace`;
                ctx.fillText(num, sy, toScreenY(0) + ppY * 1.3);
                ctx.fillText(num, sy, toScreenY(FIELD_WIDTH_YARDS) - ppY * 0.9);
            }
        }
    }

    const drawEndzone = (yStart, yEnd, color, label) => {
        const sY = toScreenX(yStart);
        const eY = toScreenX(yEnd);
        const topY = Math.min(sY, eY);
        const heightPx = Math.abs(sY - eY);

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(topY, 0, heightPx, h);
        ctx.globalAlpha = 1.0;

        ctx.lineWidth = Math.max(2, ppY * 0.15);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.moveTo(topY, 0);
        ctx.lineTo(topY, h);
        ctx.moveTo(topY + heightPx, 0);
        ctx.lineTo(topY + heightPx, h);
        ctx.stroke();

        ctx.save();
        ctx.translate(topY + heightPx / 2, h / 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = `bold ${ppY * 1.5}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0);
        ctx.restore();
    };

    drawEndzone(0, 10, awayColor, awayName);
    drawEndzone(110, 120, homeColor, homeName);

    const drawSpecialLine = (lineY, color) => {
        if (typeof lineY !== 'number') return;
        const sy = toScreenX(lineY);
        ctx.beginPath();
        ctx.moveTo(sy, 0);
        ctx.lineTo(sy, h);
        ctx.lineWidth = ppY * 0.15;
        ctx.strokeStyle = color;
        ctx.stroke();
    };

    drawSpecialLine(frameData.lineOfScrimmage, "#3b82f6");
    if (frameData.firstDownY) drawSpecialLine(frameData.firstDownY, "#eab308");

    ctx.lineWidth = ppY * 0.1;
    ctx.strokeStyle = "white";
    ctx.beginPath();
    ctx.moveTo(0, toScreenY(0));
    ctx.lineTo(w, toScreenY(0));
    ctx.moveTo(0, toScreenY(FIELD_WIDTH_YARDS));
    ctx.lineTo(w, toScreenY(FIELD_WIDTH_YARDS));
    ctx.stroke();

    if (frameData.players) {
        frameData.players.forEach(p => {
            const px = toScreenX(p.y);
            const py = toScreenY(p.x);
            const baseSize = ppY * 0.7;
            const weightScale = 0.7 + ((p.wgt || 200) / 300);
            const heightScale = 0.8 + ((p.hgt || 70) / 100);

            ctx.save();
            let jitterX = p.isStunned ? (Math.random() - 0.5) * 2 : 0;
            let jitterY = p.isStunned ? (Math.random() - 0.5) * 2 : 0;
            ctx.translate(px + jitterX, py + jitterY);

            ctx.save();
            ctx.rotate(p.angle);

            const jerseyColor = p.isStunned ? "#4b5563" : (p.primaryColor || "#333");
            const helmetColor = p.isStunned ? "#9ca3af" : (p.secondaryColor || "#fff");

            ctx.fillStyle = jerseyColor;
            const padThickness = baseSize * heightScale;
            const padWidth = baseSize * 2.2 * weightScale;

            ctx.beginPath();
            ctx.roundRect(-padThickness / 2, -padWidth / 2, padThickness, padWidth, 4);
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.fillStyle = helmetColor;
            const helmetRadius = baseSize * 0.7 * (0.9 + (p.hgt || 70) / 150);
            ctx.beginPath();
            ctx.arc(padThickness * 0.2, 0, helmetRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#111";
            ctx.lineWidth = ppY * 0.18;
            ctx.beginPath();
            ctx.arc(padThickness * 0.2, 0, helmetRadius, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();

            if (!p.isStunned && p.number) {
                ctx.save();
                ctx.rotate(-p.angle);
                ctx.fillStyle = p.secondaryColor || "#fff";
                ctx.font = `bold ${ppY * 0.65 * weightScale}px Arial`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.number, 0, 0);
                ctx.restore();
            }
            ctx.restore();

            if (p.isStunned) {
                ctx.fillStyle = "white";
                ctx.font = `bold ${ppY * 0.6}px Arial`;
                ctx.textAlign = "center";
                ctx.fillText("X_X", 0, -baseSize * 2.5);
            }

            if (p.hasBall) {
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 3;
                ctx.setLineDash([4, 2]);
                ctx.beginPath();
                ctx.arc(0, 0, baseSize * 2.0 * weightScale, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
    }

    if (frameData.ball) {
        const bx = toScreenX(frameData.ball.y);
        const by = toScreenY(frameData.ball.x);
        const bz = frameData.ball.z || 0;
        const ballRadius = ppY * 0.35 * (1 + bz * 0.15);

        ctx.fillStyle = `rgba(0,0,0,${Math.max(0.15, 0.5 - bz * 0.1)})`;
        ctx.beginPath();
        ctx.ellipse(bx, by + (bz * ppY * 0.8), ballRadius * 1.2, ballRadius * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#8B4513";
        ctx.beginPath();
        ctx.ellipse(bx, by, ballRadius * 0.75, ballRadius, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(240, 240, 240, 1)";
        ctx.lineWidth = ppY * 0.1;
        ctx.beginPath();
        ctx.moveTo(bx - ballRadius * 0.08, by - ballRadius * 0.6);
        ctx.lineTo(bx - ballRadius * 0.08, by + ballRadius * 0.6);
        ctx.stroke();
    }
}
