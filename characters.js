// --- CHARACTERS -----------------------------------------------------------------------
// A player owns up to 6 characters (supabase/schema.sql, section 30). Each
// has its own class, look, level / xp, gold and gear; the shared stash
// holds items with no character. `activeCharacter` is the one being
// played - the server's wallets view, loot, shop, talents and equip all
// act on it.
//
// The start screen (#class-selection) lists the characters: pick one and
// play, make a new one, or finish setting up a migrated one. Without a
// server (offline, or the fetch failed) the old plain class picker is used.

let activeCharacter = null;
let myCharacters = [];
let charactersLoaded = false;
const MAX_CHARACTERS = 6;
const CHAR_CLASS_KEYS = ['warrior', 'paladin', 'berserker', 'rogue', 'archer', 'mage', 'necromancer'];

// Total xp to reach a level - the same curve as schema.sql's xp_total_for.
function xpTotalFor(level) {
    let sum = 0;
    for (let i = 1; i < Math.max(1, level); i++) sum += Math.round(80 * Math.pow(i, 1.6));
    return sum;
}
// Where a character is inside its current level: { level, into, need, pct }.
function characterLevelProgress(c) {
    const level = c ? c.level : 1;
    if (level >= MAX_CHARACTER_LEVEL) return { level, into: 0, need: 0, pct: 100 };
    const base = xpTotalFor(level), next = xpTotalFor(level + 1);
    const into = Math.max(0, (c ? c.xp : 0) - base), need = next - base;
    return { level, into, need, pct: Math.min(100, Math.round(into / need * 100)) };
}

function classDefFor(key) { return (typeof CLASSES !== 'undefined' && key) ? CLASSES[String(key).toUpperCase()] : null; }

async function fetchCharacters() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const [chars, me] = await Promise.all([
        sb.from('characters').select('*').eq('player_id', user.id),
        sb.from('players').select('active_character_id').eq('id', user.id).maybeSingle()
    ]);
    if (chars.error) { console.error('Characters fetch failed:', chars.error.message); return null; }
    myCharacters = (chars.data || []).slice().sort((a, b) => String(b.last_played_at || '').localeCompare(String(a.last_played_at || '')));
    const activeId = me && me.data ? me.data.active_character_id : null;
    activeCharacter = myCharacters.find(c => c.id === activeId) || null;
    charactersLoaded = true;
    return myCharacters;
}

// Replaces one character row in the local list (after an RPC returns it).
function charactersUpsertLocal(row) {
    if (!row) return;
    const i = myCharacters.findIndex(c => c.id === row.id);
    if (i === -1) myCharacters.unshift(row); else myCharacters[i] = Object.assign({}, myCharacters[i], row);
    if (activeCharacter && activeCharacter.id === row.id) activeCharacter = myCharacters.find(c => c.id === row.id);
}

// Everything that belongs to "the active character" is re-read after a switch.
async function charactersReloadActive() {
    if (typeof fetchWallet === 'function') await fetchWallet();
    if (typeof fetchOwnedItems === 'function') await fetchOwnedItems();
    if (typeof fetchTalentStatus === 'function') fetchTalentStatus();
    if (typeof refreshMyAvatar === 'function') refreshMyAvatar(true);
}

async function selectCharacter(id) {
    const { data, error } = await sb.rpc('select_character', { p_id: id });
    if (error) { console.error('select_character failed:', error.message); return false; }
    charactersUpsertLocal(data);
    activeCharacter = myCharacters.find(c => c.id === id) || data;
    await charactersReloadActive();
    return true;
}

async function createCharacter(name, cls, gender, appearance) {
    const { data, error } = await sb.rpc('create_character', { p_name: name, p_class: cls, p_gender: gender, p_appearance: appearance });
    if (error) return { error: error.message };
    charactersUpsertLocal(data);
    activeCharacter = myCharacters.find(c => c.id === data.id) || data;
    if (typeof trackEvent === 'function') trackEvent('character_created', { class: cls, gender });
    await charactersReloadActive();
    return { ok: true };
}

async function setupCharacter(id, name, cls, gender, appearance) {
    const { data, error } = await sb.rpc('setup_character', { p_id: id, p_name: name, p_class: cls, p_gender: gender, p_appearance: appearance });
    if (error) return { error: error.message };
    charactersUpsertLocal(data);
    await charactersReloadActive();
    return { ok: true };
}

async function deleteCharacter(id, confirmName) {
    const { error } = await sb.rpc('delete_character', { p_id: id, p_confirm_name: confirmName });
    if (error) return { error: error.message };
    myCharacters = myCharacters.filter(c => c.id !== id);
    if (activeCharacter && activeCharacter.id === id) activeCharacter = null;
    if (typeof fetchOwnedItems === 'function') fetchOwnedItems();
    return { ok: true };
}

// Experience for a cleared dungeon level / won match (server-bounded).
// Shows the gain and a level-up banner; returns the new {level, xp}.
async function awardRunXp(floor, kills) {
    if (!activeCharacter || typeof sb === 'undefined') return null;
    const { data, error } = await sb.rpc('award_run_xp', { p_floor: Math.max(1, Math.min(500, floor | 0)), p_kills: Math.max(0, Math.min(50, kills | 0)) });
    if (error || !data || !data[0]) { if (error) console.warn('award_run_xp:', error.message); return null; }
    const r = data[0], before = activeCharacter.xp || 0, oldLevel = activeCharacter.level;
    activeCharacter = Object.assign(activeCharacter, { level: r.level, xp: r.xp, mastery: r.mastery });
    charactersUpsertLocal(activeCharacter);
    const gained = r.xp - before;
    if (typeof log === 'function' && gained > 0) log(tf('✨ +{xp} tecrübe', { xp: gained }), 'log-heal');
    if (r.level > oldLevel) {
        if (typeof log === 'function') log(tf('🎉 SEVİYE ATLADIN! Artık seviye {n}.', { n: r.level }), 'log-hit');
        charLevelUpToast(r.level);
        if (typeof fetchTalentStatus === 'function') fetchTalentStatus();
    }
    charUpdateHudLabel();
    return r;
}

function charLevelUpToast(lvl) {
    const el = document.createElement('div');
    el.className = 'achievement-toast';
    const b = document.createElement('b');
    b.textContent = '⭐ ' + tf('SEVİYE {n}!', { n: lvl });
    el.append(b, document.createElement('br'), document.createTextNode(lvl % 5 === 0 ? t('Yeni bir yetenek puanın var.') : t('Daha güçlü eşyalar düşmeye başladı.')));
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3500);
    if (typeof playSound === 'function') playSound('gold');
}

// "🛡️ BORIN · Sv. 7" on the HUD (or just the class when there's no character).
function charUpdateHudLabel() {
    const el = document.getElementById('player-class-label');
    if (!el || typeof selectedClass === 'undefined' || !selectedClass) return;
    el.style.color = 'var(--accent)';
    if (activeCharacter) el.textContent = `${selectedClass.emoji} ${activeCharacter.name.toUpperCase()} · ${tf('Sv. {n}', { n: activeCharacter.level })}`
        + (typeof dungeonRun !== 'undefined' && dungeonRun && dungeonRun.pending ? ` · ✨${dungeonRun.pending}` : '');
    else el.textContent = `${selectedClass.emoji} ${selectedClass.name.toUpperCase()}`;
}

// --- dungeon runs (schema.sql section 32) -------------------------------------------
// A solo run banks its experience floor by floor; it's paid out when the
// run ends - all of it when leaving right after a boss, half on death
// (which also costs 10% of the gold and one worn item). A run left open
// counts as a death when the next one starts.
let dungeonRun = null; // { id, floor, pending }
// run calls go out one after another (a floor must land before the run ends)
let runQueue = Promise.resolve();
function runQueued(fn) { const p = runQueue.then(fn, fn); runQueue = p.catch(() => {}); return p; }

function runStart() { return runQueued(runStartNow); }
async function runStartNow() {
    dungeonRun = null;
    if (!activeCharacter || typeof sb === 'undefined') return null;
    const { data, error } = await sb.rpc('start_run');
    if (error || !data) { if (error) console.warn('start_run:', error.message); return null; }
    dungeonRun = { id: data.run_id, floor: 0, pending: 0 };
    if (data.abandoned) runShowResult(data.abandoned, true);
    charUpdateHudLabel();
    return dungeonRun;
}

// A cleared floor: banks its experience (falls back to paying it at once
// when there's no run - offline, or the run couldn't start).
function runRecordFloor(floor, kills) { return runQueued(() => runRecordFloorNow(floor, kills)); }
async function runRecordFloorNow(floor, kills) {
    if (!dungeonRun) return typeof awardRunXp === 'function' ? awardRunXp(floor, kills) : null;
    const { data, error } = await sb.rpc('record_floor', { p_run: dungeonRun.id, p_floor: floor, p_kills: kills });
    if (error || !data || !data[0]) { if (error) console.warn('record_floor:', error.message); return null; }
    dungeonRun.floor = data[0].floor; dungeonRun.pending = data[0].pending_xp;
    if (typeof log === 'function') log(tf('✨ +{xp} tecrübe birikti (koşuda toplam {total})', { xp: data[0].gain, total: data[0].pending_xp }), 'log-heal');
    charUpdateHudLabel();
    return data[0];
}

// Ends the run: 'exit' (after a boss) or 'death'.
function runEnd(outcome) { return runQueued(() => runEndNow(outcome)); }
async function runEndNow(outcome) {
    const run = dungeonRun;
    dungeonRun = null;
    charUpdateHudLabel();
    if (!run || typeof sb === 'undefined') return null;
    const { data, error } = await sb.rpc('end_run', { p_run: run.id, p_outcome: outcome });
    if (error || !data) { if (error) console.warn('end_run:', error.message); return null; }
    runShowResult(data, false);
    return data;
}

// Applies an ended run's result locally and tells the player what it cost.
function runShowResult(r, wasAbandoned) {
    if (activeCharacter && r.level) {
        const oldLevel = activeCharacter.level;
        Object.assign(activeCharacter, { level: r.level, xp: r.xp, mastery: r.mastery || 0 });
        charactersUpsertLocal(activeCharacter);
        if (r.level > oldLevel) charLevelUpToast(r.level);
    }
    const lines = [];
    if (wasAbandoned) lines.push(t('Yarıda bırakılan önceki koşu ölüm sayıldı.'));
    if (r.outcome === 'exit') lines.push(tf('🏆 Zindandan sağ çıktın: {xp} tecrübenin tamamını aldın.', { xp: r.xp_granted }));
    else lines.push(tf('💀 Ölümün bedeli: biriken {banked} tecrübenin yarısını ({xp}) aldın.', { banked: r.banked_xp, xp: r.xp_granted }));
    if (r.lost_gold) lines.push(tf('🪙 Yanındaki altının %10\'u ({gold}) kayboldu.', { gold: r.lost_gold }));
    if (r.lost_item && typeof currentOwnedItems !== 'undefined') {
        const lost = currentOwnedItems.find(it => it.id === r.lost_item.id) || r.lost_item;
        currentOwnedItems = currentOwnedItems.filter(it => it.id !== r.lost_item.id);
        const info = typeof itemDisplayInfo === 'function' ? itemDisplayInfo(lost) : { name: lost.base_id, emoji: '' };
        lines.push(tf('💀 {emoji} {name} kayboldu.', { emoji: info.emoji, name: info.name }));
        if (typeof refreshMyAvatar === 'function') refreshMyAvatar();
        if (typeof syncLegendaryAura === 'function') syncLegendaryAura();
    }
    if (typeof log === 'function') lines.forEach(l => log(l, r.outcome === 'exit' ? 'log-heal' : 'log-hit'));
    if (typeof fetchWallet === 'function') fetchWallet();
    if (typeof fetchTalentStatus === 'function') fetchTalentStatus();
    charUpdateHudLabel();
    const el = document.createElement('div');
    el.className = 'achievement-toast';
    const b = document.createElement('b');
    b.textContent = r.outcome === 'exit' ? t('🏆 KOŞU TAMAMLANDI') : t('💀 KOŞU BİTTİ');
    el.appendChild(b);
    lines.forEach(l => { el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(l)); });
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 5500);
}

// --- growth -----------------------------------------------------------------------------
// A character grows with its level along its class's lines (per level,
// fractional - a level 50 warrior has +5 shield, +3 sword, +1 heart over a
// level 1 one), on top of the class passive and before gear. Solo runs
// also get +2 max HP per level (+1 per mastery point); PvP / co-op keep the
// shared 100 HP both sides see.
const CLASS_GROWTH = {
    warrior: { shield: 0.12, sword: 0.08, heart: 0.04 },
    paladin: { heart: 0.1, shield: 0.1, teamHeal: 0.04 },
    berserker: { sword: 0.12, skull_dmg: 0.3 },
    rogue: { energy: 0.1, sword: 0.1 },
    archer: { sword: 0.1, energy: 0.08, ult_dmg: 0.1 },
    mage: { ult_dmg: 0.3, energy: 0.08 },
    necromancer: { skull_dmg: 0.25, heart: 0.06, ult_dmg: 0.1 },
};
function characterLevel() { return (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.level : 1; }
function applyCharacterLevelBonuses(stats, classKey, level) {
    const L = Math.max(1, level || characterLevel()), g = CLASS_GROWTH[classKey] || {};
    Object.keys(g).forEach(k => { stats[k] = (stats[k] || 0) + Math.floor((L - 1) * g[k]); });
    return stats;
}
function characterMaxHpBonus() {
    return (characterLevel() - 1) * 2 + ((typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.mastery || 0 : 0);
}

// --- the look (portrait images) ------------------------------------------------------

function charLookOf(c) {
    const a = (c && c.appearance) || {};
    return { gender: c && c.gender === 'f' ? 'f' : 'm', skin: a.skin | 0, hair: a.hair || 'short', hairColor: a.hairColor | 0, beard: a.beard || 'none' };
}
const CHAR_PORTRAIT_CACHE = new Map();
// A standalone <img> of a hero (its own document, so painter ids never clash).
function charPortraitImg(cls, look, items, cssClass) {
    const img = document.createElement('img');
    img.className = cssClass || 'char-portrait';
    img.alt = '';
    if (typeof avPaint === 'function' && typeof heroSpecFor === 'function') {
        try {
            // painting a hero is the costly part - the inventory redraws its
            // figure on every tap, so each look is painted once
            const bust = cssClass !== 'char-preview-img' && cssClass !== 'inv-figure-img' && cssClass !== 'inv-tryon-img';
            const spec = heroSpecFor(cls, look, items || []);
            const key = (bust ? 'b|' : 'f|') + JSON.stringify(spec);
            let src = CHAR_PORTRAIT_CACHE.get(key);
            if (!src) {
                let svg = avPaint(spec).portrait;
                // list cards show head and shoulders (the body box is 0 0 200 250)
                if (bust) svg = svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/, 'viewBox="5 -5 190 190" width="190" height="190"');
                src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
                if (CHAR_PORTRAIT_CACHE.size > 80) CHAR_PORTRAIT_CACHE.delete(CHAR_PORTRAIT_CACHE.keys().next().value);
                CHAR_PORTRAIT_CACHE.set(key, src);
            }
            img.src = src;
        } catch (e) { console.warn('portrait:', e); }
    }
    return img;
}
function charEquippedOf(c) {
    if (typeof currentOwnedItems === 'undefined' || !Array.isArray(currentOwnedItems)) return [];
    return currentOwnedItems.filter(it => it.equipped_slot && it.character_id === c.id);
}

// --- the start screen ------------------------------------------------------------------

// Draws the character list into #class-selection. Each card is a button
// that plays that character (so the first child is "play my last hero").
function renderCharacterSelect() {
    const container = document.getElementById('class-selection');
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'flex';
    if (typeof overlayBtn !== 'undefined' && overlayBtn) overlayBtn.style.display = 'none';
    if (typeof overlayTitle !== 'undefined' && overlayTitle) overlayTitle.innerText = myCharacters.length ? t('KAHRAMANINI SEÇ') : t('İLK KAHRAMANINI YARAT');

    const list = document.createElement('div');
    list.id = 'char-list';
    list.className = 'char-list';
    myCharacters.forEach(c => {
        const def = classDefFor(c.class_key);
        const card = document.createElement('button');
        card.className = 'char-card' + (activeCharacter && activeCharacter.id === c.id ? ' active' : '') + (c.needs_setup ? ' needs-setup' : '');
        card.appendChild(charPortraitImg(c.class_key, charLookOf(c), charEquippedOf(c)));
        const info = document.createElement('div');
        info.className = 'char-info';
        const prog = characterLevelProgress(c);
        const name = document.createElement('b');
        name.textContent = c.name;
        const sub = document.createElement('small');
        sub.textContent = c.needs_setup ? t('Kurulum gerekli - sınıfını ve görünüşünü seç') : `${def ? def.emoji + ' ' + def.name : c.class_key} · ${tf('Sv. {n}', { n: c.level })}${c.mastery ? ' · ★' + c.mastery : ''} · ${c.gold} 🪙`;
        const bar = document.createElement('div');
        bar.className = 'char-xp';
        const fill = document.createElement('div');
        fill.style.width = prog.pct + '%';
        bar.appendChild(fill);
        info.append(name, sub, bar);
        card.appendChild(info);
        const del = document.createElement('span');
        del.className = 'char-delete';
        del.title = t('Karakteri sil');
        del.textContent = '✕';
        del.onclick = ev => { ev.stopPropagation(); charConfirmDelete(c); };
        card.appendChild(del);
        card.onclick = () => charPlay(c);
        list.appendChild(card);
    });
    container.appendChild(list);

    if (myCharacters.length < MAX_CHARACTERS) {
        const add = document.createElement('button');
        add.id = 'char-new-btn';
        add.className = 'reward-btn rarity-rare char-new';
        add.innerHTML = `<b>＋ ${t('Yeni Karakter')}</b><small>${t('Sıfırdan başlar: kendi seviyesi, altını ve eşyaları olur.')}</small>`;
        add.onclick = () => openCharacterCreator();
        container.appendChild(add);
    }
}

async function charPlay(c) {
    if (c.needs_setup) { openCharacterCreator(c); return; }
    if (!activeCharacter || activeCharacter.id !== c.id) {
        if (!(await selectCharacter(c.id))) return;
    }
    const def = classDefFor(c.class_key);
    if (def && typeof pickClass === 'function') pickClass(def);
}

async function charConfirmDelete(c) {
    const typed = prompt(tf('"{name}" KALICI olarak silinecek (çantası ve kuşandıkları dahil; ortak depo kalır). Onaylamak için adını yaz:', { name: c.name }));
    if (typed === null) return;
    const r = await deleteCharacter(c.id, typed);
    if (r.error) { alert(t('Silinemedi: ad eşleşmedi.')); return; }
    renderCharacterSelect();
}

// --- the creator -------------------------------------------------------------------------

let charDraft = null;

function openCharacterCreator(setupOf) {
    const cls = 'warrior';
    charDraft = {
        setupId: setupOf ? setupOf.id : null,
        name: setupOf ? setupOf.name : '',
        cls, gender: 'm', skin: 1, hair: 'short', hairColor: 1, beard: 'full'
    };
    renderCharacterCreator();
    const m = document.getElementById('character-modal');
    if (!m) return;
    if (typeof cgAnimateModal === 'function') cgAnimateModal(m, true); else m.style.display = 'flex';
}
function closeCharacterCreator() {
    const m = document.getElementById('character-modal');
    if (!m) return;
    if (typeof cgAnimateModal === 'function') cgAnimateModal(m, false); else m.style.display = 'none';
}

function charOptionRow(label, options, current, onPick, render) {
    const row = document.createElement('div');
    row.className = 'char-row';
    const lab = document.createElement('span');
    lab.className = 'char-row-label';
    lab.textContent = label;
    const opts = document.createElement('div');
    opts.className = 'char-opts';
    options.forEach(o => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'char-opt' + (o === current ? ' on' : '');
        render(b, o);
        b.onclick = () => { onPick(o); renderCharacterCreator(); };
        opts.appendChild(b);
    });
    row.append(lab, opts);
    return row;
}

const CHAR_HAIR_LABELS = { short: 'Kısa', long: 'Uzun', topknot: 'Topuz', shaved: 'Kazınmış', braid: 'Örgü', bun: 'Topuz', bob: 'Kaküllü' };
const CHAR_BEARD_LABELS = { none: 'Yok', stubble: 'Kirli sakal', full: 'Gür', braided: 'Örgülü' };

function renderCharacterCreator() {
    const box = document.getElementById('character-creator');
    if (!box || !charDraft) return;
    const d = charDraft;
    const hairs = (typeof AV_HAIR !== 'undefined' && AV_HAIR[d.gender]) || ['short'];
    if (hairs.indexOf(d.hair) === -1) d.hair = hairs[0];
    if (d.gender === 'f') d.beard = 'none';
    box.innerHTML = '';

    const title = document.getElementById('character-modal-title');
    if (title) title.textContent = d.setupId ? t('KAHRAMANINI TAMAMLA') : t('YENİ KAHRAMAN');

    const preview = document.createElement('div');
    preview.id = 'char-preview';
    preview.className = 'char-preview';
    preview.appendChild(charPortraitImg(d.cls, d, [], 'char-preview-img'));
    const def = classDefFor(d.cls);
    const blurb = document.createElement('p');
    blurb.className = 'char-blurb';
    blurb.textContent = def ? `${def.emoji} ${def.name} - ${t(def.desc).replace(/<[^>]*>/g, '')}` : '';
    preview.appendChild(blurb);
    box.appendChild(preview);

    const form = document.createElement('div');
    form.className = 'char-form';
    form.appendChild(charOptionRow(t('Sınıf'), CHAR_CLASS_KEYS, d.cls, v => { d.cls = v; }, (b, v) => {
        const c = classDefFor(v);
        b.textContent = c ? c.emoji + ' ' + c.name : v;
    }));
    form.appendChild(charOptionRow(t('Beden'), ['m', 'f'], d.gender, v => { d.gender = v; if (v === 'm' && d.beard === 'none') d.beard = 'full'; }, (b, v) => { b.textContent = v === 'm' ? t('Erkek') : t('Kadın'); }));
    form.appendChild(charOptionRow(t('Ten'), [0, 1, 2, 3, 4], d.skin, v => { d.skin = v; }, (b, v) => {
        b.classList.add('swatch');
        b.style.background = typeof AV_SKINS !== 'undefined' ? AV_SKINS[v][0] : '#c98c5e';
        b.setAttribute('aria-label', t('Ten') + ' ' + (v + 1));
    }));
    form.appendChild(charOptionRow(t('Saç'), hairs, d.hair, v => { d.hair = v; }, (b, v) => { b.textContent = t(CHAR_HAIR_LABELS[v] || v); }));
    form.appendChild(charOptionRow(t('Saç rengi'), [0, 1, 2, 3, 4, 5], d.hairColor, v => { d.hairColor = v; }, (b, v) => {
        b.classList.add('swatch');
        b.style.background = typeof AV_HAIR_COLORS !== 'undefined' ? AV_HAIR_COLORS[v] : '#4a2e1a';
        b.setAttribute('aria-label', t('Saç rengi') + ' ' + (v + 1));
    }));
    if (d.gender === 'm') {
        form.appendChild(charOptionRow(t('Sakal'), ['none', 'stubble', 'full', 'braided'], d.beard, v => { d.beard = v; }, (b, v) => { b.textContent = t(CHAR_BEARD_LABELS[v] || v); }));
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'char-row';
    const nameLab = document.createElement('span');
    nameLab.className = 'char-row-label';
    nameLab.textContent = t('Ad');
    const name = document.createElement('input');
    name.id = 'char-name-input';
    name.maxLength = 16;
    name.placeholder = t('2-16 harf');
    name.value = d.name;
    name.oninput = () => { d.name = name.value; };
    nameRow.append(nameLab, name);
    form.appendChild(nameRow);

    const msg = document.createElement('div');
    msg.id = 'char-create-msg';
    msg.className = 'char-msg';
    form.appendChild(msg);

    const go = document.createElement('button');
    go.id = 'char-create-btn';
    go.className = 'reward-btn rarity-legendary';
    go.textContent = d.setupId ? t('Kaydet ve oyna') : t('Yarat ve oyna');
    go.onclick = () => charSubmit();
    form.appendChild(go);
    box.appendChild(form);
}

async function charSubmit() {
    const d = charDraft;
    const msg = document.getElementById('char-create-msg');
    const name = (d.name || '').trim();
    if (name.length < 2 || name.length > 16) { if (msg) msg.textContent = t('Ad 2-16 karakter olmalı.'); return; }
    const look = { skin: d.skin, hair: d.hair, hairColor: d.hairColor, beard: d.beard };
    const btn = document.getElementById('char-create-btn');
    if (btn) btn.disabled = true;
    const r = d.setupId ? await setupCharacter(d.setupId, name, d.cls, d.gender, look) : await createCharacter(name, d.cls, d.gender, look);
    if (btn) btn.disabled = false;
    if (r.error) {
        const m = r.error;
        if (msg) msg.textContent = /already have/.test(m) ? t('Bu adda bir karakterin zaten var.') : /not allowed/.test(m) ? t('Bu ad kullanılamaz.') : /limit/.test(m) ? t('En fazla 6 karakterin olabilir.') : t('Karakter kaydedilemedi.');
        return;
    }
    closeCharacterCreator();
    const c = activeCharacter;
    if (c && typeof pickClass === 'function') pickClass(classDefFor(c.class_key));
}

// After the economy boots: load the characters and put them on the start
// screen (if it's still showing). A brand new player goes straight to the
// creator.
async function initCharacters() {
    const list = await fetchCharacters();
    if (!list) return;
    if (typeof selectedClass !== 'undefined' && selectedClass && activeCharacter && selectedClass.name.toLowerCase() === activeCharacter.class_key) {
        charUpdateHudLabel();
        if (typeof refreshMyAvatar === 'function') refreshMyAvatar(true);
    }
    const sel = document.getElementById('class-selection');
    if (sel && sel.style.display !== 'none' && (typeof selectedClass === 'undefined' || !selectedClass)) {
        renderCharacterSelect();
        if (!myCharacters.length) openCharacterCreator();
    }
}
