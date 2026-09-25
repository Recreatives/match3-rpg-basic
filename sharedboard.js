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
function sbBroadcastStep(channel, tilesArray, action, extra) {
    if (!channel) return;
    channel.send({
        type: 'broadcast', event: 'board-sync',
        payload: Object.assign({ action, types: tilesArray.map(t => t.dataset.type), symbols: tilesArray.map(t => t.innerHTML) }, extra || {})
    });
}

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
//
// G1 (graphics roadmap v2): the passive side animates the same motion the
// active side sees - a swap slides (payload.pair), a refill drops each tile
// the exact number of rows it fell (payload.falls), instead of snapping.
function sbApplySnapshot(tilesArray, payload) {
    if (payload.action === 'clear') {
        payload.types.forEach((type, i) => { if (type === '') tilesArray[i].classList.add('matched'); });
        return;
    }
    const paint = () => {
        const animate = [];
        payload.types.forEach((type, i) => {
            const tile = tilesArray[i];
            tile.dataset.type = type;
            tile.innerHTML = payload.symbols[i];
            tile.classList.remove('matched', 'matched-big', 'falling', 'hint');
            if (payload.falls && payload.falls[i] > 0) { sbSetFall(tile, payload.falls[i], i % 8); animate.push(tile); }
        });
        if (animate.length) {
            void tilesArray[0].offsetWidth;
            animate.forEach(t => t.classList.add('falling'));
        }
    };
    if (payload.action === 'swap' && payload.pair) {
        const a = tilesArray[payload.pair[0]], b = tilesArray[payload.pair[1]];
        if (a && b) { sbAnimateSwap(a, b, paint); return; }
    }
    paint();
}

// --- BOARD ENGINE (solo, PvP and co-op) ------------------------------------------
// There used to be three hand-kept copies of "clear the matched tiles, wait,
// drop + refill, check for a chain, reshuffle a dead board, end the turn":
// game.js's checkForMatches/processMatch/fillBoard, pvp.js's
// pvpResolveMatches/pvpApplyGroupEffect/pvpDropAndRefill and coop.js's twins.
// They had already drifted (the matched-big fix had to land three times;
// PvP/co-op never sent a match-free opening board to the other player and
// never checked it for a valid move; only solo animated the fall). This is
// the one copy now. A mode describes its board once:
//
//   {
//     tiles, width, pool,          the live tile elements + refill pool
//     gridEl(),                    grid element (impact shake, KOMBO text)
//     clearDelayMs,                pop -> gravity pause for a real move
//     initialDelayMs,              same, for the opening deal's cleanup
//     channel(),                   PvP/co-op realtime channel (null = solo)
//     isLive(),                    false once the fight is over - the board
//                                  still refills, but nothing else resolves
//     applyGroup(group, shape, isInitial, validTiles)
//                                  the mode's own game effects for one group
//     onChainEnd(),                the whole move (incl. cascades) is done
//     onNoMatch(),                 (optional) a real resolve found nothing
//     onReshuffle(),               (optional) a dead board was reshuffled
//     setBusy(bool),               (optional) lock/unlock input during a
//                                  rejected swap's bounce-back
//   }
//
// and calls sbDealBoard / sbTrySwap / sbResolveMatches / sbDropAndRefill.
// The mode keeps everything that is genuinely different: what a sword
// match DOES (hit the AI, broadcast an attack, damage the shared enemy),
// who is allowed to move, and what "turn over" means.

function sbTileIndex(board, tile) { return board.tiles.indexOf(tile); }

// Low-graphics mode and prefers-reduced-motion both collapse board motion
// to "just happen" - same gating graphics.js uses for its own effects.
function sbMotionMs(ms) {
    if (typeof cgEffectsEnabled === 'function' && !cgEffectsEnabled()) return 0;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    return ms;
}

// G1 - slides two adjacent tiles into each other's place (a FLIP-style
// transform on the real elements, no clones), then calls `then` once the
// motion is done so the caller can commit the actual data swap. Purely
// visual: the tiles' dataset/content never change here.
const SB_SWAP_MS = 140;
function sbAnimateSwap(t1, t2, then) {
    const ms = sbMotionMs(SB_SWAP_MS);
    if (!ms || !t1.offsetParent) { then(); return; }
    const dx = t2.offsetLeft - t1.offsetLeft, dy = t2.offsetTop - t1.offsetTop;
    [t1, t2].forEach(t => { t.style.transition = `transform ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`; t.style.zIndex = '3'; });
    t1.style.transform = `translate(${dx}px, ${dy}px)`;
    t2.style.transform = `translate(${-dx}px, ${-dy}px)`;
    setTimeout(() => {
        [t1, t2].forEach(t => { t.style.transition = 'none'; t.style.transform = ''; t.style.zIndex = ''; });
        void t1.offsetWidth;
        [t1, t2].forEach(t => { t.style.transition = ''; });
        then();
    }, ms);
}

function sbSwapData(t1, t2) {
    const ty = t1.dataset.type, html = t1.innerHTML;
    t1.dataset.type = t2.dataset.type; t1.innerHTML = t2.innerHTML;
    t2.dataset.type = ty; t2.innerHTML = html;
}

// G1 - how far a tile fell, as CSS custom properties the .falling keyframes
// read (style.css): distance scales with rows fallen, and each column
// starts a few ms after the one to its left so a refill cascades across
// the board instead of every tile landing on the same frame.
function sbSetFall(tile, rows, col) {
    tile.style.setProperty('--fall-rows', rows);
    tile.style.setProperty('--fall-col', col);
}

function sbBroadcast(board, action, extra) {
    const ch = board.channel ? board.channel() : null;
    if (ch) sbBroadcastStep(ch, board.tiles, action, extra);
}

// Resolves every current match once: pops the tiles, applies each group's
// effects, then schedules gravity. Returns whether anything matched.
function sbResolveMatches(board, isInitial) {
    if (!isInitial && !board.isLive()) return false;
    const groups = findMatchGroups(board.tiles, board.width);
    if (groups.length === 0) {
        if (!isInitial) {
            board.cascadeDepth = 0;
            if (board.onNoMatch) board.onNoMatch();
        }
        return false;
    }

    if (!isInitial) {
        board.cascadeDepth = (board.cascadeDepth || 0) + 1;
        const grid = board.gridEl();
        const maxMultiplier = Math.max(...groups.map(g => getMatchShapeInfo(g.indices.length, g.subShape === 'cross').multiplier));
        if (typeof cgBoardImpact === 'function') cgBoardImpact(grid, maxMultiplier);
        if (board.cascadeDepth >= 2 && typeof showFloatingText === 'function') showFloatingText(`KOMBO x${board.cascadeDepth}`, grid, '#ff9f1c');
    }

    groups.forEach(group => {
        const shape = getMatchShapeInfo(group.indices.length, group.subShape === 'cross');
        let validTiles = 0;
        group.indices.forEach(i => {
            const tile = board.tiles[i];
            // A tile shared by two groups (a vertical run crossing two
            // horizontal ones) only pops once.
            if (tile.dataset.type === '') return;
            if (!isInitial) {
                tile.classList.add('matched');
                // A 4+/cross match pops bigger/brighter (matched-big,
                // style.css) ON TOP OF .matched rather than instead of it.
                if (shape.multiplier >= 2) tile.classList.add('matched-big');
                if (typeof cgTileBurst === 'function') cgTileBurst(tile, group.type);
            } else {
                tile.innerHTML = '';
            }
            tile.dataset.type = '';
            validTiles++;
        });
        board.applyGroup(group, shape, isInitial, validTiles);
    });

    sbBroadcast(board, 'clear');
    setTimeout(() => sbDropAndRefill(board, isInitial), isInitial ? (board.initialDelayMs || 0) : board.clearDelayMs);
    return true;
}

// Gravity + refill, then: chain -> resolve again; dead board -> reshuffle;
// otherwise the move is over (onChainEnd).
function sbDropAndRefill(board, isInitial) {
    const live = isInitial || board.isLive();
    const w = board.width, tiles = board.tiles;
    const falls = new Array(tiles.length).fill(0);
    const animate = [];
    for (let col = 0; col < w; col++) {
        const column = [];
        for (let row = 0; row < w; row++) {
            const t = tiles[col + row * w];
            if (t.dataset.type !== '') column.push({ type: t.dataset.type, html: t.innerHTML, fromRow: row });
        }
        const missing = w - column.length;
        for (let k = 0; k < missing; k++) {
            const rt = board.pool[Math.floor(Math.random() * board.pool.length)];
            column.unshift({ type: rt.type, html: rt.symbol, isNew: true });
        }
        for (let row = 0; row < w; row++) {
            const idx = col + row * w, tile = tiles[idx], data = column[row];
            const fell = data.isNew ? missing : row - data.fromRow;
            tile.dataset.type = data.type;
            tile.innerHTML = data.html;
            // matched-big's animation ends (forwards) at scale(0)/opacity:0
            // and tiles are a reused fixed pool - it MUST be cleared along
            // with 'matched' or the new tile landing here stays invisible.
            tile.classList.remove('matched', 'matched-big', 'hint');
            if (fell > 0 && !isInitial) {
                tile.classList.remove('falling');
                sbSetFall(tile, fell, col);
                falls[idx] = fell;
                animate.push(tile);
            }
        }
    }
    if (animate.length) {
        void board.gridEl().offsetWidth; // one batched reflow, not one per tile
        animate.forEach(t => t.classList.add('falling'));
    }
    sbBroadcast(board, 'refill', { falls });
    if (!live) return; // the fight ended mid-chain - refilled, nothing more resolves

    let chained = sbResolveMatches(board, isInitial);
    if (!chained && (isInitial || board.isLive()) && !boardHasValidMove(tiles, w)) {
        reshuffleBoard(tiles, w, board.pool);
        sbBroadcast(board, 'refill');
        if (board.onReshuffle) board.onReshuffle();
        chained = sbResolveMatches(board, isInitial);
    }
    if (chained || isInitial) return;
    if (board.isLive()) board.onChainEnd();
}

// A fresh board for a new level/match: random deal, then the same settle
// path as any refill - initial matches cleaned up silently, a dead board
// reshuffled, and (PvP/co-op) the result broadcast to the other player
// even when there was nothing to clean up.
function sbDealBoard(board) {
    sbRandomizeBoard(board.tiles, board.pool);
    sbDropAndRefill(board, true);
}

// A player's (or the solo AI's) swap attempt: slide, commit, resolve. A
// swap that makes no match slides back (with a little shake) and costs
// nothing - onInvalid lets the mode restart its speed-bonus window etc.
function sbTrySwap(board, t1, t2, onInvalid) {
    sbClearHint(board);
    const pair = [sbTileIndex(board, t1), sbTileIndex(board, t2)];
    sbAnimateSwap(t1, t2, () => {
        sbSwapData(t1, t2);
        sbBroadcast(board, 'swap', { pair });
        if (sbResolveMatches(board, false)) return;
        if (board.setBusy) board.setBusy(true);
        t1.classList.add('invalid-swap'); t2.classList.add('invalid-swap');
        sbAnimateSwap(t1, t2, () => {
            sbSwapData(t1, t2);
            t1.classList.remove('invalid-swap'); t2.classList.remove('invalid-swap');
            sbBroadcast(board, 'swap', { pair });
            if (board.setBusy) board.setBusy(false);
            if (onInvalid) onInvalid();
        });
    });
}

// --- HINT (G1) -----------------------------------------------------------------
// After a few idle seconds on your own turn, two tiles that would make a
// match pulse gently. Driven from each mode's existing 100ms speed-bonus
// ticker (no timer of its own), cleared by any input or turn change.
const SB_HINT_DELAY_MS = 6000;

function sbFindValidMove(tileArray, w) {
    for (let i = 0; i < tileArray.length; i++) {
        const r = Math.floor(i / w), c = i % w;
        const neighbors = [];
        if (c < w - 1) neighbors.push(i + 1);
        if (r < w - 1) neighbors.push(i + w);
        for (const j of neighbors) {
            const t1 = tileArray[i].dataset.type, t2 = tileArray[j].dataset.type;
            tileArray[i].dataset.type = t2; tileArray[j].dataset.type = t1;
            const hasMatch = findMatchGroups(tileArray, w).length > 0;
            tileArray[i].dataset.type = t1; tileArray[j].dataset.type = t2;
            if (hasMatch) return [i, j];
        }
    }
    return null;
}

function sbMaybeShowHint(board, elapsedMs) {
    if (board.hintShown || elapsedMs < SB_HINT_DELAY_MS) return;
    board.hintShown = true;
    const move = sbFindValidMove(board.tiles, board.width);
    if (!move) return;
    move.forEach(i => board.tiles[i].classList.add('hint'));
}

function sbClearHint(board) {
    board.hintShown = false;
    board.tiles.forEach(t => t.classList.remove('hint'));
}
