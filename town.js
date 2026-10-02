// --- THE TOWN ---------------------------------------------------------------------------
// The hub between adventures: a painted night square (style C) with the
// active hero standing in the middle and a building for everything that
// isn't fighting - the smithy (shop), the storehouse (bag / stash), the
// auction hall, the tavern (co-op), the arena (PvP), the sage's tower
// (talents), the hall of fame (profile), a treasure chest (daily reward)
// and the dungeon gate (a solo run).
//
// Everything that changes gear, gold or progress is only reachable here:
// while a dungeon run or a PvP / co-op match is on, those windows stay
// shut (see townModalAllowed / toggleModal) - no shopping, re-gearing or
// trading in the middle of a fight.

const TOWN_ONLY_MODALS = ['shop-modal', 'daily-login-modal', 'profile-modal', 'leaderboard-modal', 'friends-modal', 'trade-modal',
    'guild-modal', 'titles-modal', 'talents-modal', 'achievements-modal', 'history-modal', 'auction-modal', 'account-modal'];

// The town's buildings: where they stand in the 400 x 620 scene (x, y),
// their tap area (w, h), where the sign hangs (lx, ly) and what they open.
const TOWN_BUILDINGS = [
    { id: 'tower', label: 'Bilge Kulesi', sub: 'Yetenekler', x: 14, y: 70, w: 100, h: 170, lx: 50, ly: 158, open: () => toggleModal('talents-modal') },
    { id: 'auction', label: 'Müzayede Salonu', sub: 'Al - Sat', x: 134, y: 64, w: 132, h: 176, lx: 65, ly: 160, open: () => toggleModal('auction-modal') },
    { id: 'arena', label: 'Arena', sub: 'PvP', x: 282, y: 86, w: 112, h: 154, lx: 55, ly: 138, open: () => townEnterMatch('pvp-modal') },
    { id: 'smithy', label: 'Demirci', sub: 'Dükkan', x: 6, y: 268, w: 128, h: 160, lx: 62, ly: 136, open: () => { toggleModal('shop-modal'); if (typeof switchShopTab === 'function') switchShopTab('shop'); } },
    { id: 'tavern', label: 'Meyhane', sub: 'Co-op', x: 248, y: 268, w: 140, h: 160, lx: 65, ly: 136, open: () => townEnterMatch('coop-modal') },
    { id: 'store', label: 'Ambar', sub: 'Çanta & Depo', x: 8, y: 470, w: 122, h: 136, lx: 58, ly: 112, open: () => { toggleModal('shop-modal'); if (typeof switchShopTab === 'function') switchShopTab('inventory'); } },
    { id: 'fame', label: 'Şöhret Panosu', sub: 'Profil', x: 128, y: 500, w: 74, h: 100, lx: 36, ly: 84, open: () => toggleModal('profile-modal') },
    { id: 'chest', label: 'Hazine', sub: 'Günlük Ödül', x: 214, y: 530, w: 64, h: 70, lx: 31, ly: 56, open: () => toggleModal('daily-login-modal') },
    { id: 'gate', label: 'Zindan Kapısı', sub: 'Solo', x: 266, y: 456, w: 134, h: 150, lx: 66, ly: 124, open: () => townEnterDungeon() },
];

const TINK = '#0b0d12';
function tPath(d, fill, w) { return `<path d="${d}" fill="${fill}" stroke="${TINK}" stroke-width="${w === undefined ? 2 : w}" stroke-linejoin="round"/>`; }
function tWin(x, y, w, h) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#tg-window)" stroke="${TINK}" stroke-width="1.5"/>`; }

// The buildings, each drawn around its own (0, 0) - the top-left of its spot.
const TOWN_ART = {
    tower: () => tPath('M20 170 L24 40 L76 40 L80 170 Z', 'url(#tg-stone)') + tPath('M14 44 L50 -18 L86 44 Z', 'url(#tg-roof-blue)')
        + `<circle cx="50" cy="-22" r="7" fill="#9adfff"/><circle cx="50" cy="-22" r="18" fill="#5fd8ff" opacity=".25" class="town-glow"/>`
        + tWin(42, 64, 16, 24) + tWin(42, 108, 16, 22) + tPath('M40 170 L40 146 Q50 134 60 146 L60 170 Z', '#3a2616'),
    auction: () => tPath('M0 170 L0 70 L130 70 L130 170 Z', 'url(#tg-plaster)') + tPath('M-8 74 L65 20 L138 74 Z', 'url(#tg-roof-red)')
        + tPath('M44 34 Q65 4 86 34 Z', '#c9a24a', 1.5) + [14, 44, 74, 104].map(x => tWin(x, 88, 14, 22)).join('')
        + tPath('M50 170 L50 132 Q65 118 80 132 L80 170 Z', '#4a2a16')
        + `<path d="M8 76 L8 118 L20 110 L32 118 L32 76 Z" fill="#8e1b1b" stroke="${TINK}" stroke-width="1.5"/><path d="M98 76 L98 118 L110 110 L122 118 L122 76 Z" fill="#1a3a7a" stroke="${TINK}" stroke-width="1.5"/>`
        + `<circle cx="65" cy="52" r="7" fill="#ffd24a" stroke="${TINK}" stroke-width="1.5"/>`,
    arena: () => tPath('M0 150 L0 60 Q55 30 110 60 L110 150 Z', 'url(#tg-stone)')
        + [8, 34, 60, 86].map(x => tPath(`M${x} 150 L${x} 108 Q${x + 9} 94 ${x + 18} 108 L${x + 18} 150 Z`, '#1a1418', 1.5)).join('')
        + [14, 40, 66].map(x => tPath(`M${x + 6} 88 L${x + 6} 72 Q${x + 12} 64 ${x + 18} 72 L${x + 18} 88 Z`, '#1a1418', 1.2)).join('')
        + `<line x1="55" y1="38" x2="55" y2="8" stroke="${TINK}" stroke-width="2"/><path d="M55 8 L80 14 L55 21 Z" fill="#b3261e" stroke="${TINK}" stroke-width="1.5"/>`
        + `<path d="M40 128 L70 128 M55 113 L55 143" stroke="#c9a24a" stroke-width="3" opacity=".7"/>`,
    smithy: () => tPath('M6 150 L6 60 L118 60 L118 150 Z', 'url(#tg-wood)') + tPath('M-4 64 L62 18 L128 64 Z', 'url(#tg-roof-brown)')
        + tPath('M88 40 L88 2 L104 2 L104 52 Z', 'url(#tg-stone)') + `<circle cx="96" cy="-10" r="9" fill="#5a5a66" opacity=".55" class="town-smoke"/><circle cx="104" cy="-26" r="12" fill="#5a5a66" opacity=".35" class="town-smoke"/>`
        + `<rect x="18" y="94" width="40" height="56" fill="#ff8a2a" opacity=".85" stroke="${TINK}" stroke-width="1.5"/><rect x="18" y="94" width="40" height="56" fill="url(#tg-fire)"/>`
        + tWin(72, 86, 30, 22) + tPath('M28 140 L50 140 L46 132 L32 132 Z', '#3a3a44', 1.5)
        + `<g transform="translate(66,118)">${tPath('M0 0 L28 0 L28 14 L0 14 Z', '#5a3a22', 1.5)}<path d="M4 7 L24 7 M14 2 L14 12" stroke="#d4a84a" stroke-width="2.4"/></g>`,
    tavern: () => tPath('M6 150 L6 56 L124 56 L124 150 Z', 'url(#tg-plaster)') + tPath('M-4 60 L65 12 L134 60 Z', 'url(#tg-roof-red)')
        + `<path d="M6 92 L124 92" stroke="#5a3a22" stroke-width="4"/>` + [16, 50, 88].map(x => tWin(x, 66, 22, 20)).join('') + [16, 88].map(x => tWin(x, 104, 22, 22)).join('')
        + tPath('M52 150 L52 110 Q65 98 78 110 L78 150 Z', '#4a2a16')
        + `<line x1="124" y1="74" x2="146" y2="74" stroke="${TINK}" stroke-width="2.5"/><g transform="translate(132,78)">${tPath('M0 0 L18 0 L18 22 L0 22 Z', '#7a5230', 1.5)}<path d="M4 6 L12 6 L12 17 L4 17 Z M12 9 Q17 11 12 15" fill="#ffd24a" stroke="${TINK}" stroke-width="1"/></g>`,
    store: () => tPath('M4 128 L4 50 L112 50 L112 128 Z', 'url(#tg-wood)') + tPath('M-6 54 L58 14 L122 54 Z', 'url(#tg-roof-brown)')
        + tPath('M34 128 L34 74 L82 74 L82 128 Z', '#3a2616') + `<path d="M34 74 L82 128 M82 74 L34 128" stroke="#7a5230" stroke-width="3"/>`
        + [[10, 104], [92, 108]].map(([x, y]) => tPath(`M${x} ${y} L${x + 18} ${y} L${x + 18} ${y + 20} L${x} ${y + 20} Z`, '#8a6038', 1.5)).join(''),
    fame: () => tPath('M10 92 L10 30 L60 30 L60 92', 'none', 4) + tPath('M4 24 L66 24 L66 66 L4 66 Z', '#5a3a22')
        + [[10, 30], [32, 32], [16, 46], [40, 48]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="${18 - (i % 2) * 4}" height="13" fill="#eae0c8" stroke="${TINK}" stroke-width="1" transform="rotate(${(i % 2 ? 4 : -5)} ${x} ${y})"/>`).join('')
        + `<circle cx="35" cy="22" r="7" fill="#ffd24a" stroke="${TINK}" stroke-width="1.5"/>`,
    chest: () => tPath('M6 58 L6 34 L56 34 L56 58 Z', '#7a4a20') + tPath('M6 34 Q31 14 56 34 Z', '#8a5a2a') + `<path d="M6 40 L56 40 M31 18 L31 58" stroke="#d4a84a" stroke-width="3"/>`
        + `<rect x="27" y="36" width="8" height="10" fill="#ffd24a" stroke="${TINK}" stroke-width="1.2"/><circle cx="31" cy="30" r="22" fill="#ffd24a" opacity=".18" class="town-glow"/>`,
    gate: () => tPath('M0 140 L0 60 Q66 -10 132 60 L132 140 Z', 'url(#tg-rock)') + tPath('M26 140 L26 82 Q66 34 106 82 L106 140 Z', '#07080c')
        + [38, 54, 70, 86].map(x => `<line x1="${x + 6}" y1="74" x2="${x + 6}" y2="140" stroke="#3a3a44" stroke-width="3"/>`).join('')
        + `<path d="M30 92 L102 92" stroke="#3a3a44" stroke-width="3"/>`
        + [[8, 80], [114, 80]].map(([x, y]) => `<rect x="${x + 2}" y="${y}" width="6" height="18" fill="#3a2616" stroke="${TINK}" stroke-width="1"/><path d="M${x + 5} ${y - 16} Q${x - 2} ${y - 4} ${x + 5} ${y} Q${x + 12} ${y - 4} ${x + 5} ${y - 16} Z" fill="#ffb04a" class="town-flame"/><circle cx="${x + 5}" cy="${y - 6}" r="16" fill="#ff8a2a" opacity=".25" class="town-glow"/>`).join('')
        + `<g transform="translate(52,40)"><circle cx="14" cy="10" r="11" fill="#eae0c8" stroke="${TINK}" stroke-width="1.5"/><circle cx="10" cy="9" r="3" fill="${TINK}"/><circle cx="18" cy="9" r="3" fill="${TINK}"/></g>`,
};

function townDefs() {
    const lin = (id, a, b, vert) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vert === false ? 1 : 0}" y2="${vert === false ? 0 : 1}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    return `<defs>${lin('tg-sky', '#0d1426', '#3a2f4a')}${lin('tg-ground', '#3a3640', '#1e1c22')}${lin('tg-stone', '#7a7480', '#3e3a44')}${lin('tg-rock', '#5a5460', '#25222a')}
        ${lin('tg-plaster', '#c9b48a', '#7a6a4e')}${lin('tg-wood', '#7a5230', '#3e2616')}${lin('tg-roof-red', '#9a3a2a', '#4a160e')}${lin('tg-roof-blue', '#3a5a9a', '#1a2448')}
        ${lin('tg-roof-brown', '#6a4a2a', '#2e1e10')}${lin('tg-window', '#ffe08a', '#ff9a3a')}${lin('tg-fire', '#ffd24a', '#c2362a')}
        <radialGradient id="tg-moon" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#e8dfb8"/></radialGradient>
        <radialGradient id="tg-plaza" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffb04a" stop-opacity=".22"/><stop offset="1" stop-color="#ffb04a" stop-opacity="0"/></radialGradient></defs>`;
}

// The whole scene as SVG markup (the hero is an <image> of its portrait).
function townSceneSvg(heroSrc) {
    let stars = '';
    for (let i = 0; i < 40; i++) { const x = (i * 97) % 400, y = (i * 53) % 150, r = (i % 3) * 0.4 + 0.5; stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.3 + (i % 5) * 0.12}"/>`; }
    const mountains = `<path d="M0 215 L40 160 L80 190 L130 130 L180 180 L230 140 L280 185 L330 138 L370 170 L400 150 L400 240 L0 240 Z" fill="#1c1a28" opacity=".9"/>`;
    const ground = `<path d="M0 236 Q200 214 400 236 L400 620 L0 620 Z" fill="url(#tg-ground)"/>`;
    let cobbles = '';
    for (let r = 0; r < 12; r++) for (let c = 0; c < 10; c++) { const x = 122 + c * 16 + (r % 2) * 8 - r * 3, y = 290 + r * 15; cobbles += `<ellipse cx="${x}" cy="${y}" rx="7" ry="4" fill="#4a4652" opacity=".55"/>`; }
    const plaza = `<ellipse cx="200" cy="380" rx="130" ry="90" fill="url(#tg-plaza)"/>` + cobbles
        + `<path d="M200 470 Q230 520 300 540" stroke="#5a5460" stroke-width="18" fill="none" opacity=".5"/>`;
    const buildings = TOWN_BUILDINGS.map(b => `<g class="town-bldg" id="town-b-${b.id}" data-b="${b.id}" role="button" tabindex="0" transform="translate(${b.x},${b.y})" aria-label="${t(b.label)}">`
        + `<rect class="town-hit" x="-6" y="-24" width="${b.w}" height="${b.h}" fill="transparent"/>`
        + TOWN_ART[b.id]() + `</g>`).join('');
    const hero = heroSrc ? `<ellipse cx="200" cy="446" rx="44" ry="9" fill="#000" opacity=".45"/><image id="town-hero" href="${heroSrc}" x="128" y="296" width="144" height="150"/>` : '';
    const labels = TOWN_BUILDINGS.map(b => { const lx = b.x + b.lx, ly = b.y + b.ly, wide = Math.max(t(b.label).length * 6.1, t(b.sub).length * 5.1) + 14;
        return `<g class="town-label" pointer-events="none"><rect x="${lx - wide / 2}" y="${ly - 12}" width="${wide}" height="27" rx="6" fill="#0b0d12" opacity=".78" stroke="#c9a24a" stroke-opacity=".5"/>`
            + `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#e8c35a">${t(b.label)}</text>`
            + `<text x="${lx}" y="${ly + 11}" text-anchor="middle" font-size="8.5" fill="#cfd8e0">${t(b.sub)}</text></g>`; }).join('');    return `<svg id="town-svg" viewBox="0 0 400 620" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${townDefs()}`
        + `<rect width="400" height="620" fill="url(#tg-sky)"/>${stars}<circle cx="335" cy="56" r="20" fill="url(#tg-moon)"/><circle cx="335" cy="56" r="34" fill="#fffbe8" opacity=".08"/>`
        + mountains + ground + plaza + buildings + hero + labels + `</svg>`;
}

function townIsOpen() { const el = document.getElementById('town-screen'); return !!el && el.style.display !== 'none' && el.style.display !== ''; }

// Gear / gold / progress windows only open outside of a fight: not during
// a dungeon run (playing, picking a reward, at the boss checkpoint), and
// not while a PvP or co-op match is on.
function townInFight() {
    if (typeof currentState !== 'undefined' && typeof STATE !== 'undefined' && (currentState === STATE.PLAYING || currentState === STATE.REWARD)) return true;
    if (typeof dungeonRun !== 'undefined' && dungeonRun) return true;
    const pb = document.getElementById('pvp-battle'), cb = document.getElementById('coop-battle');
    return !!((pb && pb.style.display === 'block') || (cb && cb.style.display === 'block'));
}
function townModalAllowed(modalId) { return TOWN_ONLY_MODALS.indexOf(modalId) === -1 || !townInFight(); }

function renderTown() {
    const root = document.getElementById('town-screen');
    if (!root) return;
    const c = typeof activeCharacter !== 'undefined' ? activeCharacter : null;
    let heroSrc = null;
    if (typeof charPortraitImg === 'function') {
        const cls = (typeof selectedClass !== 'undefined' && selectedClass) ? selectedClass.name.toLowerCase() : (c ? c.class_key : 'warrior');
        const worn = typeof heroEquippedItems === 'function' ? heroEquippedItems() : [];
        heroSrc = charPortraitImg(cls, typeof heroCurrentLook === 'function' ? heroCurrentLook() : null, worn, 'char-preview-img').getAttribute('src');
    }
    const prog = c && typeof characterLevelProgress === 'function' ? characterLevelProgress(c) : null;
    const gold = typeof currentWallet !== 'undefined' && currentWallet ? currentWallet.gold : 0;
    root.innerHTML = `<div class="town-head">
            <div class="town-who"><b id="town-name">${c ? c.name : t('Kahraman')}</b><span>${c ? tf('Sv. {n}', { n: c.level }) : ''} · 🪙 <span id="town-gold">${gold}</span></span>
                ${prog ? `<div class="town-xp"><i style="width:${prog.pct}%"></i></div>` : ''}</div>
            <div class="town-tools">
                <button class="help-btn" id="town-chars-btn" title="${t('Karakterler')}">👥</button>
                <button class="help-btn" onclick="toggleSoundMute()" title="${t('Ses')}">🔊</button>
                <button class="help-btn" onclick="toggleLanguage()">🌐</button>
                <button class="help-btn" onclick="toggleModal('info-modal')">?</button>
            </div>
        </div>
        <div class="town-scene" id="town-scene">${townSceneSvg(heroSrc)}</div>
        <p class="town-hint">${t('Bir binaya dokun. Zindanda ve maçlarda dükkan, envanter ve takas kapalıdır.')}</p>`;
    TOWN_BUILDINGS.forEach(b => {
        const el = document.getElementById('town-b-' + b.id);
        if (!el) return;
        const go = () => { if (typeof playSound === 'function') playSound('click'); b.open(); };
        el.addEventListener('click', go);
        el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
    const cb = document.getElementById('town-chars-btn');
    if (cb) cb.onclick = () => townToCharacters();
}

function showTown() {
    const root = document.getElementById('town-screen');
    if (!root) return;
    if (typeof currentState !== 'undefined' && typeof STATE !== 'undefined') currentState = STATE.START;
    renderTown();
    root.style.display = 'flex';
    document.body.classList.add('in-town');
}
function hideTown() {
    const root = document.getElementById('town-screen');
    if (root) root.style.display = 'none';
    document.body.classList.remove('in-town');
}

// The dungeon gate: a fresh solo run.
function townEnterDungeon() {
    hideTown();
    const ov = document.getElementById('game-overlay');
    if (ov) ov.classList.remove('visible');
    ['class-selection', 'mode-selection', 'reward-area', 'boss-checkpoint'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (typeof resetGame === 'function') resetGame();
    if (typeof startLevel === 'function') startLevel();
    if (typeof runStart === 'function') runStart();
}

// The arena / the tavern: the PvP or co-op window over the game (the town
// comes back when it closes - toggleModal).
function townEnterMatch(modalId) {
    hideTown();
    toggleModal(modalId);
}

// Back to the character list (switch hero).
function townToCharacters() {
    hideTown();
    if (typeof selectedClass !== 'undefined') selectedClass = null;
    const ov = document.getElementById('game-overlay');
    if (ov) ov.classList.add('visible');
    ['mode-selection', 'reward-area', 'boss-checkpoint'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (typeof renderClassButtons === 'function') renderClassButtons();
}
