// --- THE PLAYER'S OWN HERO (avatar glue) -------------------------------------------
// Builds the painted avatar spec (avatar.js) for "me" - class, body,
// appearance and what I'm wearing - puts it on every one of my fighter
// slots (solo / PvP / co-op), and hands a compact copy to the other side of
// a PvP / co-op match so they see my actual gear. Remote fighters sent by
// an older client (no avatar in their presence) fall back to a starter
// look for their class.

// What a class wears when a slot is empty: plain class clothing and a
// starter weapon (not an item - it has no stats), so a new hero still
// looks like who they are.
const HERO_STARTER = {
    warrior: { chest: ['leather', '#6b4a30'], legs: ['cloth', '#4e4234'], boots: ['leather', '#5a3a22'], belt: ['leather', '#4a3020'], weapon: ['sword', '#c9d2dc'], offhand: ['kite', '#7a5a3a'] },
    paladin: { chest: ['leather', '#8a8272'], legs: ['cloth', '#5e584e'], boots: ['leather', '#5a3a22'], belt: ['leather', '#4a3020'], weapon: ['hammer', '#b8a070'], offhand: ['kite', '#d8d2c0'] },
    berserker: { chest: ['leather', '#5a3a22'], legs: ['leather', '#3a2a1a'], boots: ['leather', '#3a2616'], belt: ['leather', '#4a3020'], weapon: ['axe', '#b8c0c8'] },
    rogue: { chest: ['leather', '#3a3242'], legs: ['leather', '#2a2430'], boots: ['leather', '#2a2020'], belt: ['sash', '#4a2a2a'], weapon: ['dagger', '#c9d2dc'], offhand: ['dagger', '#c9d2dc'] },
    archer: { chest: ['leather', '#3e4a2a'], legs: ['leather', '#33301e'], boots: ['leather', '#4a3020'], belt: ['leather', '#4a3020'], weapon: ['bow', '#7a5230'], offhand: ['quiver', '#5a3a22'] },
    mage: { chest: ['robe', '#5a4a6a'], boots: ['cloth', '#3a2a1a'], belt: ['sash', '#6a4a2a'], weapon: ['staff', '#7a5230'] },
    necromancer: { chest: ['robe', '#2e3428'], boots: ['cloth', '#2a2020'], belt: ['sash', '#3a3a2a'], weapon: ['scythe', '#9aa0a8'], offhand: ['lantern', '#5a5f66'] },
};
const HERO_CLASS_GLOW = { warrior: '#ff7a2a', paladin: '#ffe08a', berserker: '#ff4a1a', rogue: '#b05cff', archer: '#9aff6a', mage: '#5fd8ff', necromancer: '#7dff7a' };

// rarity -> how ornate the piece looks, and the color its gems/eyes glow
const HERO_RARITY_LOOK = {
    grey: { tier: 1 }, white: { tier: 1 }, blue: { tier: 2, glow: '#5fa8ff' }, yellow: { tier: 2, glow: '#ffd24a' },
    green: { tier: 3, glow: '#3dff8a' }, orange: { tier: 3, glow: '#ff8a2a' }, red: { tier: 3, glow: '#ff3a2a' }, teal: { tier: 3, glow: '#3fe0c0' },
};

// How an owned item looks when worn: its avatar slot, painter style and
// colors. The catalog (catalog.js) describes this per base; anything it
// doesn't know falls back to a sensible look for the slot.
function heroItemVisual(item) {
    if (!item) return null;
    const vis = (typeof catalogVisual === 'function') ? catalogVisual(item) : null;
    if (!vis) return null;
    const look = HERO_RARITY_LOOK[item.rarity] || HERO_RARITY_LOOK.white;
    return Object.assign({ tier: look.tier, glow: look.glow }, vis);
}

// My appearance until characters carry their own (then the active
// character's appearance wins - see characters.js's heroLook).
function heroLookDefault() {
    return { gender: 'm', skin: 1, hair: 'short', hairColor: 1, beard: 'full' };
}
function heroCurrentLook() {
    if (typeof activeCharacter !== 'undefined' && activeCharacter && activeCharacter.appearance) {
        const a = activeCharacter.appearance;
        return Object.assign(heroLookDefault(), a, { gender: activeCharacter.gender || a.gender || 'm' });
    }
    return heroLookDefault();
}

// The avatar spec for a class wearing a set of item rows. Empty slots show
// the class's starter clothing / weapon.
function heroSpecFor(cls, look, equippedItems) {
    const gear = {};
    const starter = HERO_STARTER[cls] || HERO_STARTER.warrior;
    Object.keys(starter).forEach(slot => {
        const [style, color] = starter[slot];
        gear[slot] = { slot, style, tier: 1, color, trim: '#8a7a5a' };
    });
    (equippedItems || []).forEach(it => {
        const v = heroItemVisual(it);
        if (v && v.slot) gear[v.slot] = v;
    });
    // an off-hand that doesn't fit the weapon (a shield with a bow, anything
    // with a two-handed axe) is simply not shown
    const w = gear.weapon && gear.weapon.style;
    if (w === 'bow' && gear.offhand && gear.offhand.style !== 'quiver') delete gear.offhand;
    if (w === 'axe' && cls === 'berserker') delete gear.offhand;
    const lk = look || heroLookDefault();
    return { cls, gender: lk.gender === 'f' ? 'f' : 'm', skin: lk.skin | 0, hair: lk.hair, hairColor: lk.hairColor | 0, beard: lk.beard || 'none', gear };
}

function heroEquippedItems() {
    if (typeof currentOwnedItems === 'undefined' || !Array.isArray(currentOwnedItems)) return [];
    const activeId = (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.id : null;
    return currentOwnedItems.filter(it => it.equipped_slot && (!activeId || !('character_id' in it) || it.character_id === activeId));
}

function myAvatarSpec() {
    const cls = selectedClass ? selectedClass.name.toLowerCase() : ((typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.class_key : 'warrior');
    return heroSpecFor(cls, heroCurrentLook(), heroEquippedItems());
}

const HERO_MY_SLOTS = ['player-sprite', 'pvp-my-sprite', 'coop-my-sprite'];
let heroLastSpecJson = null;
// Repaints my hero everywhere (class pick, equip / unequip, appearance).
function refreshMyAvatar(force) {
    if (typeof cgGetStage !== 'function' || typeof avPaint !== 'function') return;
    const spec = myAvatarSpec();
    const json = JSON.stringify(spec);
    if (!force && json === heroLastSpecJson) return;
    heroLastSpecJson = json;
    HERO_MY_SLOTS.forEach(id => {
        const stage = cgGetStage(id);
        if (stage) stage.setAvatar(spec);
    });
}

// A remote fighter's look: their own spec if their client sent one,
// otherwise a starter look for their class.
function heroRemoteSpec(payload, clsFallback) {
    const cls = (payload && payload.cls) || clsFallback || 'warrior';
    if (payload && payload.gear && typeof payload.gear === 'object') {
        // only keep fields the painter understands (it's another client's data)
        const gear = {};
        Object.keys(payload.gear).forEach(slot => {
            const g = payload.gear[slot];
            if (!g || typeof g !== 'object' || typeof AV_PAINT === 'undefined' || !AV_PAINT[slot]) return;
            gear[slot] = { slot, style: String(g.style || ''), tier: Math.max(1, Math.min(3, g.tier | 0)), color: heroSafeColor(g.color), trim: heroSafeColor(g.trim), glow: g.glow ? heroSafeColor(g.glow) : undefined,
                cape: g.cape ? heroSafeColor(g.cape) : undefined, tabard: g.tabard ? heroSafeColor(g.tabard) : undefined, plume: g.plume ? heroSafeColor(g.plume) : undefined, double: !!g.double, feathers: !!g.feathers, pouch: !!g.pouch };
        });
        return { cls, gender: payload.gender === 'f' ? 'f' : 'm', skin: Math.max(0, Math.min(4, payload.skin | 0)), hair: String(payload.hair || 'short'), hairColor: Math.max(0, Math.min(5, payload.hairColor | 0)), beard: String(payload.beard || 'none'), gear };
    }
    return heroSpecFor(cls, heroLookDefault(), []);
}
function heroSafeColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#888888'; }

// The copy of my look that rides along on PvP / co-op presence.
function myAvatarPayload() { return myAvatarSpec(); }
