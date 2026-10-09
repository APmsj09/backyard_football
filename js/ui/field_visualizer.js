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

    // Dynamically match internal canvas resolution to full container display size
    if (canvas.clientWidth > 0 && (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight)) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    const FIELD_WIDTH_YARDS = 53.3;
    const FIELD_LENGTH_YARDS = 120;

    // =========================================================================
    // 1. ZOOM & TRACKING CAMERA MATH
    // =========================================================================
    // Zoom in drastically: Show 32 yards vertically instead of the full 53.3
    const ZOOM_VIEW_HEIGHT_YARDS = 32.0; 
    const ppY = h / ZOOM_VIEW_HEIGHT_YARDS; // Dramatically higher Pixels-Per-Yard
    const VIEW_LENGTH_YARDS = w / ppY;

    const ballY = frameData.ball ? frameData.ball.y : 60; // Field length axis
    const ballX = frameData.ball ? frameData.ball.x : 26.6; // Field width axis

    // Desired Camera Targets (Keep the ball at 35% of the screen horizontally)
    let targetCamLeft = ballY - (VIEW_LENGTH_YARDS * 0.35); 
    const maxCamLeft = FIELD_LENGTH_YARDS - VIEW_LENGTH_YARDS + 10;
    targetCamLeft = Math.max(-10, Math.min(maxCamLeft, targetCamLeft));

    // Vertical Camera Tracking (Follow the ball across the hashes)
    let targetCamTop = ballX - (ZOOM_VIEW_HEIGHT_YARDS / 2);
    const maxCamTop = FIELD_WIDTH_YARDS - ZOOM_VIEW_HEIGHT_YARDS + 5;
    targetCamTop = Math.max(-5, Math.min(maxCamTop, targetCamTop));

    // Initialize or smoothly interpolate camera (15% glide per frame)
    if (canvas._camLeft === undefined) canvas._camLeft = targetCamLeft;
    if (canvas._camTop === undefined) canvas._camTop = targetCamTop;

    // Teleport camera if distance is too far (e.g., turnover or deep pass snap)
    if (Math.abs(targetCamLeft - canvas._camLeft) > 30) canvas._camLeft = targetCamLeft;

    canvas._camLeft = (canvas._camLeft * 0.85) + (targetCamLeft * 0.15);
    canvas._camTop = (canvas._camTop * 0.85) + (targetCamTop * 0.15);

    // Map Field Yards -> Screen Pixels
    const toScreenX = (fieldY) => (fieldY - canvas._camLeft) * ppY;
    const toScreenY = (fieldX) => (fieldX - canvas._camTop) * ppY;


    // =========================================================================
    // 2. DRAW THE FIELD & GRASS
    // =========================================================================
    ctx.fillStyle = "#1a4d2e";
    ctx.fillRect(0, 0, w, h);

    // World-space Field Stripes (Alternating 5-yard shades that pan smoothly)
    ctx.fillStyle = "rgba(26, 77, 46, 0.4)";
    const startStripe = Math.floor(canvas._camLeft / 5) * 5;
    const endStripe = canvas._camLeft + VIEW_LENGTH_YARDS;
    for (let y = startStripe; y <= endStripe; y += 5) {
        if (Math.abs(y % 10) === 5) {
            const sx = toScreenX(y);
            ctx.fillRect(sx, 0, ppY * 5, h);
        }
    }

    ctx.lineWidth = Math.max(1, ppY * 0.03);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";

    const startYard = Math.floor(canvas._camLeft) - 1;
    const endYard = Math.ceil(canvas._camLeft + VIEW_LENGTH_YARDS) + 1;

    // Hash marks & Sideline ticks
    for (let y = startYard; y <= endYard; y++) {
        const sy = toScreenX(y);
        if (sy >= -10 && sy <= w + 10) {
            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(0) - ppY * 0.25);
            ctx.lineTo(sy, toScreenY(0));
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(FIELD_WIDTH_YARDS) + ppY * 0.25);
            ctx.lineTo(sy, toScreenY(FIELD_WIDTH_YARDS));
            ctx.stroke();
            
            // Left Hash
            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(18.0) - ppY * 0.2);
            ctx.lineTo(sy, toScreenY(18.0) + ppY * 0.2);
            ctx.stroke();

            // Right Hash
            ctx.beginPath();
            ctx.moveTo(sy, toScreenY(35.3) - ppY * 0.2);
            ctx.lineTo(sy, toScreenY(35.3) + ppY * 0.2);
            ctx.stroke();
        }
    }

    // Yard lines & Numbers
    const startYard10 = Math.floor(canvas._camLeft / 10) * 10;
    const endYard10 = Math.floor((canvas._camLeft + VIEW_LENGTH_YARDS) / 10) * 10 + 10;

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
        ctx.moveTo(sy, toScreenY(-5)); 
        ctx.lineTo(sy, toScreenY(FIELD_WIDTH_YARDS + 5));
        ctx.stroke();

        // Draw numbers
        if (y >= 10 && y < 110 && y % 10 === 0) {
            const num = y <= 50 ? y - 10 : 110 - y;
            if (num > 0) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
                ctx.font = `bold ${ppY * 1.5}px monospace`; 
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                
                ctx.save();
                ctx.translate(sy, toScreenY(8));
                ctx.rotate(Math.PI);
                ctx.fillText(num, 0, 0);
                ctx.restore();

                ctx.fillText(num, sy, toScreenY(FIELD_WIDTH_YARDS - 8));
            }
        }
    }

    // Endzones
    const drawEndzone = (yStart, yEnd, color, label) => {
        const sY = toScreenX(yStart);
        const eY = toScreenX(yEnd);
        const topY = Math.min(sY, eY);
        const heightPx = Math.abs(sY - eY);
        
        const fieldTop = toScreenY(0);
        const fieldBot = toScreenY(FIELD_WIDTH_YARDS);
        const fieldHeight = fieldBot - fieldTop;

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(topY, fieldTop, heightPx, fieldHeight);
        ctx.globalAlpha = 1.0;

        ctx.lineWidth = Math.max(2, ppY * 0.15);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.moveTo(topY, fieldTop);
        ctx.lineTo(topY, fieldBot);
        ctx.moveTo(topY + heightPx, fieldTop);
        ctx.lineTo(topY + heightPx, fieldBot);
        ctx.stroke();

        ctx.save();
        ctx.translate(topY + heightPx / 2, fieldTop + fieldHeight / 2);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = `bold ${ppY * 2.5}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
    };

    drawEndzone(0, 10, awayColor, awayName);
    drawEndzone(110, 120, homeColor, homeName);

    // Special Lines (LOS, 1ST DOWN)
    const drawSpecialLine = (lineY, color, label = null) => {
        if (typeof lineY !== 'number') return;
        const sy = toScreenX(lineY);
        if (sy < -20 || sy > w + 20) return;

        const lineTop = toScreenY(0);
        const lineBot = toScreenY(FIELD_WIDTH_YARDS);

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = ppY * 0.4;
        ctx.beginPath();
        ctx.moveTo(sy, lineTop);
        ctx.lineTo(sy, lineBot);
        ctx.lineWidth = ppY * 0.2;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();

        if (label) {
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = `black ${Math.max(10, ppY * 0.6)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillRect(sy - ppY * 1.0, lineTop - ppY * 1.0, ppY * 2.0, ppY * 0.8);
            ctx.fillRect(sy - ppY * 1.0, lineBot + ppY * 0.2, ppY * 2.0, ppY * 0.8);
            ctx.fillStyle = "#000000";
            ctx.fillText(label, sy, lineTop - ppY * 0.6);
            ctx.fillText(label, sy, lineBot + ppY * 0.6);
            ctx.restore();
        }
    };

    drawSpecialLine(frameData.lineOfScrimmage, "#38bdf8", "LOS");
    if (frameData.firstDownY) drawSpecialLine(frameData.firstDownY, "#fbbf24", "1ST");

    // PASSING TARGET RETICLE
    if (frameData.ball?.inAir && typeof frameData.ball.targetX === 'number' && typeof frameData.ball.targetY === 'number') {
        const retX = toScreenX(frameData.ball.targetY);
        const retY = toScreenY(frameData.ball.targetX);
        const retRadius = ppY * 1.2;

        ctx.save();
        ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
        ctx.fillStyle = "rgba(251, 191, 36, 0.25)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(retX, retY, retRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(retX - retRadius * 1.4, retY);
        ctx.lineTo(retX + retRadius * 1.4, retY);
        ctx.moveTo(retX, retY - retRadius * 1.4);
        ctx.lineTo(retX, retY + retRadius * 1.4);
        ctx.stroke();
        ctx.restore();
    }

    // Sideline boundaries
    ctx.lineWidth = ppY * 0.15;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(0, toScreenY(0));
    ctx.lineTo(w, toScreenY(0));
    ctx.moveTo(0, toScreenY(FIELD_WIDTH_YARDS));
    ctx.lineTo(w, toScreenY(FIELD_WIDTH_YARDS));
    ctx.stroke();

    // =========================================================================
    // 3. RENDER REALISTICALLY SCALED PLAYERS
    // =========================================================================
    if (frameData.players) {
        frameData.players.forEach(p => {
            const px = toScreenX(p.y);
            const py = toScreenY(p.x);
            
            // Culling: Don't draw if outside viewport
            if (px < -100 || px > w + 100 || py < -100 || py > h + 100) return;

            // REALISTIC SCALE: Match size to physical 1.3-yard hitboxes
            const baseSize = ppY * 0.55; 
            const weightScale = 0.80 + ((p.wgt || 200) / 500);
            const heightScale = 0.85 + ((p.hgt || 70) / 150);

            ctx.save();
            let jitterX = p.isStunned ? (Math.random() - 0.5) * 2.5 : 0;
            let jitterY = p.isStunned ? (Math.random() - 0.5) * 2.5 : 0;
            ctx.translate(px + jitterX, py + jitterY);

            ctx.save();
            ctx.rotate(p.angle);

            const jerseyColor = p.isStunned ? "#4b5563" : (p.primaryColor || "#333");
            const helmetColor = p.isStunned ? "#9ca3af" : (p.secondaryColor || "#fff");

            // Proportionate shoulder pads (~3 feet wide in game-world)
            ctx.fillStyle = jerseyColor;
            const padThickness = baseSize * 0.9 * heightScale;
            const padWidth = baseSize * 1.9 * weightScale;

            ctx.beginPath();
            ctx.roundRect(-padThickness / 2, -padWidth / 2, padThickness, padWidth, 4.0);
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.65)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Proportional helmet
            ctx.fillStyle = helmetColor;
            const helmetRadius = baseSize * 0.45 * (0.9 + (p.hgt || 70) / 160);
            ctx.beginPath();
            ctx.arc(padThickness * 0.15, 0, helmetRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#111";
            ctx.lineWidth = Math.max(1.5, ppY * 0.12);
            ctx.beginPath();
            ctx.arc(padThickness * 0.15, 0, helmetRadius, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();

            // Legible, proportionate jersey number
            if (!p.isStunned && p.number) {
                ctx.save();
                ctx.rotate(-p.angle);
                ctx.fillStyle = p.secondaryColor || "#fff";
                ctx.font = `bold ${Math.max(10, Math.round(baseSize * 0.85 * weightScale))}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.number, 0, 0);
                ctx.restore();
            }
            ctx.restore();

            if (p.isStunned) {
                ctx.fillStyle = "white";
                ctx.font = `bold ${ppY * 0.7}px Arial`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("X_X", 0, -baseSize * 2.0);
            }

            // High-visibility Ball Carrier Halo & Football icon
            if (p.hasBall) {
                ctx.save();
                // Glowing outer pulse ring
                ctx.shadowColor = "#f59e0b";
                ctx.shadowBlur = 12;
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(0, 0, baseSize * 1.6 * weightScale, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                // Football icon badge above helmet
                ctx.save();
                ctx.fillStyle = "#854d0e";
                ctx.strokeStyle = "#fef08a";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.ellipse(0, -baseSize * 2.2, ppY * 0.25, ppY * 0.15, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }

            // --- CRISP ON-FIELD POSITION & NAME BADGES ---
            if (!p.isStunned) {
                const posLabel = p.slot ? p.slot.replace(/\d+/g, '') : (p.isOffense ? 'OFF' : 'DEF');
                const badgeBg = p.isOffense ? 'rgba(30, 58, 138, 0.85)' : 'rgba(136, 19, 55, 0.85)';
                const badgeBorder = p.isOffense ? 'rgba(96, 165, 250, 0.6)' : 'rgba(251, 113, 133, 0.6)';
                const badgeY = -baseSize * 1.6;

                ctx.save();
                ctx.font = `bold ${Math.max(9, ppY * 0.4)}px monospace`;
                const posWidth = ctx.measureText(p.slot || posLabel).width + 8;
                
                ctx.fillStyle = badgeBg;
                ctx.strokeStyle = badgeBorder;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(-posWidth / 2, badgeY - 6, posWidth, 12, 3);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.slot || posLabel, 0, badgeY);
                ctx.restore();

                if (p.name) {
                    const lastName = p.name.split(' ').slice(-1)[0];
                    const nameY = baseSize * 1.6;

                    ctx.save();
                    ctx.font = `bold ${Math.max(9, ppY * 0.45)}px sans-serif`;
                    const nameWidth = ctx.measureText(lastName).width + 8;

                    ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
                    ctx.beginPath();
                    ctx.roundRect(-nameWidth / 2, nameY - 5, nameWidth, 11, 3);
                    ctx.fill();

                    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(lastName, 0, nameY);
                    ctx.restore();
                }
            }

            ctx.restore();
        });
    }

    // =========================================================================
    // 4. RENDER BALL
    // =========================================================================
    if (frameData.ball) {
        const bx = toScreenX(frameData.ball.y);
        const by = toScreenY(frameData.ball.x);
        const bz = frameData.ball.z || 0;
        
        // Scale ball size relative to ppY
        const ballRadius = ppY * 0.35 * (1 + bz * 0.2);

        // Shadow drops vertically based on Z height
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0.15, 0.6 - bz * 0.15)})`;
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
