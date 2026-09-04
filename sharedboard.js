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
// first state - see each file's "who creates the board" comment.
function sbRandomizeBoard(tilesArray) {
    tilesArray.forEach(tile => {
        let t = tileTypes[Math.floor(Math.random() * tileTypes.length)];
        tile.dataset.type = t.type;
        tile.innerHTML = t.symbol;
    });
}

function sbBroadcastStep(channel, tilesArray) {
    channel.send({
        type: 'broadcast', event: 'board-sync',
        payload: { types: tilesArray.map(t => t.dataset.type), symbols: tilesArray.map(t => t.innerHTML) }
    });
}

// Applies a received snapshot to MY OWN board - only ever reached on the
// PASSIVE side (broadcast self:false means the sender never gets this back),
// which never runs its own match-detection for the turn in progress.
function sbApplySnapshot(tilesArray, payload) {
    payload.types.forEach((type, i) => {
        tilesArray[i].dataset.type = type;
        tilesArray[i].innerHTML = payload.symbols[i];
    });
}
