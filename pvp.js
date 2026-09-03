// --- PVP PROTOTYPE (real-time 1v1) ---
// This validates the hardest technical piece of the betrayal system - two
// real browsers seeing each other's moves live - before the betrayal vote,
// Kibir Laneti, and currency stakes get layered on top (see the "İhanet
// Protokolü" design doc). Deliberately simpler than the single-player
// engine for now: no classes, no ultimates, no cascades beyond one resolve
// pass, no L/T-shape bonus. It has its own state and its own board,
// entirely separate from game.js's single-player globals - the two modes
// never touch the same variables, so nothing here can destabilize the
// existing single-player game.
//
// Networking model: each client is authoritative for its OWN hp/armor.
// "I matched sword tiles, here's how much damage that is" gets broadcast to
// the opponent; the RECEIVING client applies that amount to its own local
// hp/armor (using its own armor-absorption math) and reports back if it
// died. Nobody's client ever has to trust or replicate the other's board.
//
// Turn order: whoever's presence timestamp is earliest goes first.

const PVP_WIDTH = 8;
const PVP_MAX_HP = 100;

let pvpChannel = null;
let pvpRoomCode = null;
let pvpMyId = null;
let pvpTiles = [];
let pvpStarted = false;
let pvpMyTurn = false;
let pvpProcessing = false;
let pvpSelectedTile = null;
let pvpMyHP = PVP_MAX_HP;
let pvpMyArmor = 0;
let pvpMatchOver = false;

function pvpLog(msg) {
    let el = document.getElementById('pvp-log');
    if (!el) return;
    let div = document.createElement('div');
    div.innerText = msg;
    el.prepend(div);
}

function pvpSetStatus(text) {
    let el1 = document.getElementById('pvp-status');
    let el2 = document.getElementById('pvp-status-battle');
    if (el1) el1.innerText = text;
    if (el2) el2.innerText = text;
}

// --- ROOM JOINING -----------------------------------------------------------

async function pvpJoinRoom() {
    let input = document.getElementById('pvp-room-input');
    let code = input ? input.value.trim().toUpperCase() : '';
    if (!code) { pvpSetStatus('Önce bir oda kodu yaz.'); return; }

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { pvpSetStatus('Giriş yapılamadı, sayfayı yenile.'); return; }
    pvpMyId = user.id;
    pvpRoomCode = code;

    if (pvpChannel) await pvpChannel.unsubscribe();

    pvpChannel = sb.channel(`pvp-room-${pvpRoomCode}`, {
        config: { presence: { key: pvpMyId }, broadcast: { self: false } }
    });

    pvpChannel.on('broadcast', { event: 'attack' }, ({ payload }) => pvpReceiveAttack(payload));
    pvpChannel.on('broadcast', { event: 'defeated' }, () => pvpOnOpponentDefeated());
    pvpChannel.on('broadcast', { event: 'turn-end' }, () => pvpReceiveTurnEnd());
    pvpChannel.on('presence', { event: 'sync' }, () => pvpCheckPresence());

    pvpChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await pvpChannel.track({ joined_at: Date.now() });
            pvpSetStatus(`Oda "${pvpRoomCode}" - rakip bekleniyor…`);
        }
    });
}

function pvpCheckPresence() {
    if (pvpStarted) return;
    const state = pvpChannel.presenceState();
    const keys = Object.keys(state);
    if (keys.length < 2) return;

    let entries = keys.map(k => ({ key: k, joinedAt: state[k][0].joined_at }));
    entries.sort((a, b) => a.joinedAt - b.joinedAt);

    pvpStarted = true;
    pvpMyTurn = entries[0].key === pvpMyId;
    pvpStartMatch();
}

// --- MATCH LIFECYCLE ---------------------------------------------------------

function pvpStartMatch() {
    pvpMyHP = PVP_MAX_HP;
    pvpMyArmor = 0;
    pvpMatchOver = false;
    pvpProcessing = false;

    document.getElementById('pvp-setup').style.display = 'none';
    document.getElementById('pvp-battle').style.display = 'block';

    pvpCreateBoard();
    pvpUpdateUI();
    pvpSetStatus(pvpMyTurn ? 'Senin sıran!' : 'Rakibin sırası…');
    pvpLog('Eşleşme başladı.');
}

function pvpReceiveAttack(payload) {
    if (pvpMatchOver) return;
    let amount = payload.amount || 0;
    let before = pvpMyHP;
    if (pvpMyArmor >= amount) {
        pvpMyArmor -= amount;
    } else {
        let remainder = amount - pvpMyArmor;
        pvpMyArmor = 0;
        pvpMyHP -= remainder;
    }
    pvpLog(`Rakip ${payload.type || 'saldırı'} ile ${amount} hasar verdi.`);
    pvpUpdateUI();

    if (pvpMyHP <= 0 && before > 0) {
        pvpMatchOver = true;
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpLog('Yenildin.');
    }
    // Turn handoff does NOT happen here anymore - see pvpReceiveTurnEnd.
    // It used to be granted on taking damage, which meant a turn that only
    // matched shield/heart (no attack broadcast at all) never told the
    // opponent it was over - both sides ended up stuck waiting on each
    // other. Turn passing is now its own explicit, unconditional message.
}

function pvpReceiveTurnEnd() {
    if (pvpMatchOver) return;
    pvpMyTurn = true;
    pvpSetStatus('Senin sıran!');
    pvpUpdateUI();
}

function pvpOnOpponentDefeated() {
    if (pvpMatchOver) return;
    pvpMatchOver = true;
    pvpSetStatus('KAZANDIN!');
    pvpLog('Rakip yenildi - kazandın!');
    pvpUpdateUI();
}

// --- BOARD (simplified: match-3/4/5+, no shapes, no cascades beyond one pass) ---

function pvpCreateBoard() {
    let grid = document.getElementById('pvp-grid');
    grid.innerHTML = '';
    pvpTiles.length = 0;
    pvpSelectedTile = null;

    for (let i = 0; i < PVP_WIDTH * PVP_WIDTH; i++) {
        const tile = document.createElement('div');
        tile.setAttribute('id', 'pvp-tile-' + i);
        tile.className = 'tile';
        let randomType = Math.floor(Math.random() * tileTypes.length);
        tile.dataset.type = tileTypes[randomType].type;
        tile.innerHTML = tileTypes[randomType].symbol;
        grid.appendChild(tile);
        pvpTiles.push(tile);

        tile.addEventListener('mousedown', () => pvpHandleTap(tile));
        tile.addEventListener('touchstart', (e) => { e.preventDefault(); pvpHandleTap(tile); }, { passive: false });
    }
    pvpResolveMatches(true);
}

function pvpHandleTap(tile) {
    if (pvpMatchOver || pvpProcessing || !pvpMyTurn) return;
    if (!pvpSelectedTile) {
        pvpSelectedTile = tile;
        tile.classList.add('selected');
        return;
    }
    if (tile === pvpSelectedTile) {
        tile.classList.remove('selected');
        pvpSelectedTile = null;
        return;
    }
    let id1 = parseInt(pvpSelectedTile.id.replace('pvp-tile-', ''));
    let id2 = parseInt(tile.id.replace('pvp-tile-', ''));
    let r1 = Math.floor(id1 / PVP_WIDTH), c1 = id1 % PVP_WIDTH;
    let r2 = Math.floor(id2 / PVP_WIDTH), c2 = id2 % PVP_WIDTH;
    let adjacent = (r1 === r2 && Math.abs(c1 - c2) === 1) || (c1 === c2 && Math.abs(r1 - r2) === 1);

    if (adjacent) {
        pvpAttemptSwap(pvpSelectedTile, tile);
        pvpSelectedTile.classList.remove('selected');
        pvpSelectedTile = null;
    } else {
        pvpSelectedTile.classList.remove('selected');
        pvpSelectedTile = tile;
        tile.classList.add('selected');
    }
}

function pvpAttemptSwap(tile1, tile2) {
    pvpProcessing = true;
    let t = tile1.dataset.type, h = tile1.innerHTML;
    tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
    tile2.dataset.type = t; tile2.innerHTML = h;

    let matched = pvpResolveMatches(false);
    if (!matched) {
        setTimeout(() => {
            let t2 = tile1.dataset.type, h2 = tile1.innerHTML;
            tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
            tile2.dataset.type = t2; tile2.innerHTML = h2;
            pvpProcessing = false;
        }, 150);
    }
}

function pvpResolveMatches(isInitial) {
    let types = pvpTiles.map(t => t.dataset.type);
    let groups = pvpFindMatchGroups(types);
    if (groups.length === 0) {
        if (!isInitial) pvpProcessing = false;
        return false;
    }

    groups.forEach(g => pvpApplyGroupEffect(g, isInitial));
    setTimeout(() => pvpDropAndRefill(isInitial), isInitial ? 0 : 350);
    return true;
}

function pvpFindMatchGroups(types) {
    let groups = [];
    for (let r = 0; r < PVP_WIDTH; r++) {
        let count = 1;
        for (let c = 0; c < PVP_WIDTH; c++) {
            let i = r * PVP_WIDTH + c;
            if (c < PVP_WIDTH - 1 && types[i] !== '' && types[i] === types[i + 1]) count++;
            else {
                if (count >= 3) groups.push({ type: types[i], indices: Array.from({length: count}, (_, k) => i - k) });
                count = 1;
            }
        }
    }
    for (let c = 0; c < PVP_WIDTH; c++) {
        let count = 1;
        for (let r = 0; r < PVP_WIDTH; r++) {
            let i = r * PVP_WIDTH + c;
            if (r < PVP_WIDTH - 1 && types[i] !== '' && types[i] === types[i + PVP_WIDTH]) count++;
            else {
                if (count >= 3) groups.push({ type: types[i], indices: Array.from({length: count}, (_, k) => i - k * PVP_WIDTH) });
                count = 1;
            }
        }
    }
    return groups;
}

function pvpApplyGroupEffect(group, isInitial) {
    let count = group.indices.length;
    let multiplier = count >= 5 ? 3 : count === 4 ? 2 : 1;

    group.indices.forEach(i => {
        if (!isInitial) pvpTiles[i].classList.add('matched');
        else pvpTiles[i].innerHTML = '';
        pvpTiles[i].dataset.type = '';
    });

    if (isInitial) return;

    if (group.type === 'sword' || group.type === 'skull') {
        let base = group.type === 'sword' ? TILE_STATS.sword : TILE_STATS.skull_dmg;
        let amount = Math.floor(base * multiplier);
        pvpLog(`${group.type === 'sword' ? 'Kılıç' : 'Kafatası'} eşleşti - rakibe ${amount} hasar.`);
        pvpChannel.send({ type: 'broadcast', event: 'attack', payload: { amount, type: group.type } });
        if (group.type === 'skull') {
            let recoil = Math.floor(TILE_STATS.skull_self_dmg * multiplier);
            if (pvpMyArmor >= recoil) pvpMyArmor -= recoil; else { pvpMyHP -= (recoil - pvpMyArmor); pvpMyArmor = 0; }
            pvpLog(`Kafatası geri tepmesi: kendine ${recoil} hasar.`);
        }
    } else if (group.type === 'heart') {
        let heal = Math.floor(TILE_STATS.heart * multiplier);
        pvpMyHP = Math.min(pvpMyHP + heal, PVP_MAX_HP);
        pvpLog(`Kalp eşleşti - +${heal} can.`);
    } else if (group.type === 'shield') {
        let gain = Math.floor(TILE_STATS.shield * multiplier);
        pvpMyArmor += gain;
        pvpLog(`Kalkan eşleşti - +${gain} zırh.`);
    }
    // energy: no effect yet in the prototype - ult mechanics land in a later pass.

    pvpUpdateUI();

    if (pvpMyHP <= 0) {
        pvpMatchOver = true;
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpLog('Kendi hasarınla yenildin.');
    }
}

function pvpDropAndRefill(isInitial) {
    for (let col = 0; col < PVP_WIDTH; col++) {
        let colTiles = [];
        for (let row = 0; row < PVP_WIDTH; row++) {
            let i = col + row * PVP_WIDTH;
            if (pvpTiles[i].dataset.type !== '') colTiles.push({ type: pvpTiles[i].dataset.type, html: pvpTiles[i].innerHTML });
        }
        let missing = PVP_WIDTH - colTiles.length;
        for (let i = 0; i < missing; i++) {
            let rt = tileTypes[Math.floor(Math.random() * tileTypes.length)];
            colTiles.unshift({ type: rt.type, html: rt.symbol });
        }
        for (let row = 0; row < PVP_WIDTH; row++) {
            let i = col + row * PVP_WIDTH;
            pvpTiles[i].dataset.type = colTiles[row].type;
            pvpTiles[i].innerHTML = colTiles[row].html;
            pvpTiles[i].classList.remove('matched');
        }
    }
    let chained = pvpResolveMatches(isInitial);
    if (!chained && !isInitial && !pvpMatchOver) {
        pvpMyTurn = false;
        pvpProcessing = false;
        pvpSetStatus('Rakibin sırası…');
        pvpUpdateUI();
        // Unconditional - sent whether or not this turn dealt any damage, so
        // a shield/heart-only turn still hands control back to the opponent.
        pvpChannel.send({ type: 'broadcast', event: 'turn-end', payload: {} });
    }
}

function pvpUpdateUI() {
    let hpPct = Math.max(0, (pvpMyHP / PVP_MAX_HP) * 100);
    let hpBar = document.getElementById('pvp-my-hp-bar');
    let hpText = document.getElementById('pvp-my-hp-text');
    if (hpBar) hpBar.style.width = hpPct + '%';
    if (hpText) hpText.innerText = `${Math.max(0, Math.floor(pvpMyHP))}/${PVP_MAX_HP}` + (pvpMyArmor > 0 ? ` [+${pvpMyArmor}]` : '');
    let grid = document.getElementById('pvp-grid');
    if (grid) grid.classList.toggle('locked', !pvpMyTurn || pvpMatchOver);
}
