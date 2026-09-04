// --- SHARED BOARD (one visible board for PvP and co-op, not two separate ones) ---
// Both modes are already strictly turn-based - only one player can ever act
// at a time - so there's no real "conflict" to resolve between two writers.
// Only the ACTIVE player (the one whose turn it is - already gated by each
// mode's own pvpMyTurn/coopMyTurn checks before a tap does anything) ever
// runs match-detection or touches tileTypes' randomness. Every meaningful
// visual step of their turn - a swap, tiles clearing, the refill settling,
// each cascade repeat - gets broadcast as a full tile-array snapshot; the
// PASSIVE side just paints that snapshot onto its own identical grid and
// never recomputes anything itself. This is what makes "watch your teammate/
// opponent's moves happen live" possible without a real distributed-state
// conflict problem: there is exactly one writer at any given moment, and
// which client that is flips only when a turn actually changes.
//
// Board-CREATION authority is a separate, one-time question per match (PvP)
// or per level (co-op) - see each file's own comment on who randomizes the
// very first board. Once play is underway, "who's currently the writer" is
// just "whoever's turn it is," already tracked by each file's own state.

function sbCreateBoardDOM(gridId, idPrefix, tilesArray, tapHandler) {
    let grid = document.getElementById(gridId);
    grid.innerHTML = '';
    tilesArray.length = 0;
    for (let i = 0; i < 64; i++) {
        const tile = document.createElement('div');
        tile.setAttribute('id', idPrefix + i);
        tile.className = 'tile';
        grid.appendChild(tile);
        tilesArray.push(tile);
        tile.addEventListener('mousedown', () => tapHandler(tile));
        tile.addEventListener('touchstart', (e) => { e.preventDefault(); tapHandler(tile); }, { passive: false });
    }
}

// Only ever called by whichever side is authoritative for a board's very
// first state - see each file's "who creates the board" comment. `pool`
// defaults to the base tileTypes (game.js) - co-op passes its own extended
// pool (COOP_TILE_TYPES) so its teammate-heal tile never appears on a solo
// or PvP board.
function sbRandomizeBoard(tilesArray, pool) {
    pool = pool || tileTypes;
    tilesArray.forEach(tile => {
        let t = pool[Math.floor(Math.random() * pool.length)];
        tile.dataset.type = t.type;
        tile.innerHTML = t.symbol;
    });
}

// `action` says what kind of step this is - 'swap' | 'clear' | 'refill' -
// so the passive side can give it the same visual treatment the active
// side's own screen already has (see sbApplySnapshot), instead of every
// step just instantly overwriting the whole board with no transition at
// all, which is what made watching a teammate/opponent play feel like an
// unreadable blur of symbols.
function sbBroadcastStep(channel, tilesArray, action) {
    channel.send({
        type: 'broadcast', event: 'board-sync',
        payload: { action, types: tilesArray.map(t => t.dataset.type), symbols: tilesArray.map(t => t.innerHTML) }
    });
}

// Applies a received snapshot to MY OWN board - only ever reached on the
// PASSIVE side (broadcast self:false means the sender never gets this back),
// which never runs its own match-detection for the turn in progress.
//
// A 'clear' step only adds the same .matched pulse (style.css) the active
// side's own tiles play at this exact moment - it deliberately does NOT
// blank the tile yet, so there's something to actually watch pulse before
// it disappears. The empty type/symbol arrives moments later in the
// 'refill' step that always follows, timed by the same delay the active
// side already waits on its own screen (pvpDropAndRefill/coopDropAndRefill).
// Buckets a 0-100 HP percentage into a coarse, named condition instead of a
// number - "gizli can" (PvP) and "gizli takım arkadaşı canı" (co-op) were
// always about not exposing exact HP, not about reducing it to a flat
// alive/dead switch. Five visually distinct states read the way sizing up
// someone's condition in person would, without ever handing over the real
// number: barPct is one of 5 fixed steps (not the real, continuous %) so the
// bar's width itself can't be reverse-engineered into an exact HP guess.
function sbHealthTier(pct) {
    if (pct <= 0) return { text: 'BAYILDI', color: '#7f8c8d', barPct: 0 };
    if (pct <= 15) return { text: 'AĞIR YARALI', color: '#e74c3c', barPct: 15 };
    if (pct <= 40) return { text: 'YARALI', color: '#e67e22', barPct: 40 };
    if (pct <= 75) return { text: 'HAFİF YARALI', color: '#f1c40f', barPct: 75 };
    return { text: 'SAĞLAM', color: '#2ecc71', barPct: 100 };
}

function sbApplySnapshot(tilesArray, payload) {
    if (payload.action === 'clear') {
        payload.types.forEach((type, i) => { if (type === '') tilesArray[i].classList.add('matched'); });
        return;
    }
    payload.types.forEach((type, i) => {
        tilesArray[i].dataset.type = type;
        tilesArray[i].innerHTML = payload.symbols[i];
        tilesArray[i].classList.remove('matched');
    });
}
