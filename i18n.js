// --- LANGUAGE / TRANSLATION ENGINE ---------------------------------------------
// Loaded FIRST (before every other script) since everything else calls t()/tf()
// as soon as it renders anything. No build step in this project (see CLAUDE.md),
// so there's no compile-time string extraction - this is a runtime dictionary
// keyed by the ORIGINAL TURKISH TEXT itself, not by invented identifiers like
// "menu.play.button". That was a deliberate tradeoff: with ~8000 lines of
// already-written Turkish UI/log text across this codebase, inventing and
// wiring a unique key per string would have meant touching every call site
// twice (once to extract the string into a key, once to use the key) - keying
// on the Turkish source means every call site changes exactly once (wrap it in
// t(...)/tf(...)), and a missing translation harmlessly falls back to Turkish
// instead of showing a raw key like "menu.play.button" to a player.
//
// Two lookup functions:
//   t(str)              - exact string, no variables. Used for fixed UI text
//                          and log lines with no interpolation.
//   tf(template, vars)  - the ORIGINAL TURKISH TEMPLATE (with {name} style
//                          placeholders) is the dictionary key, e.g.
//                          tf("{user} Saldırı {val}", {user, val}) - looks up
//                          the TEMPLATE (not the already-substituted string,
//                          which would be different every call and could never
//                          match a fixed dictionary entry), then substitutes.
//
// Static HTML (index.html) uses a parallel mechanism: any element that should
// be translated carries a data-i18n-en="<English HTML>" attribute alongside
// its normal (Turkish) content - applyStaticTranslations() swaps
// el.innerHTML between the two, caching the original Turkish the first time
// it runs (data-i18n-tr) so switching back to Turkish is lossless. This keeps
// inline formatting (<b>, links, emoji) intact in both languages without a
// separate template file.
let currentLang = (function () {
    try { return localStorage.getItem('pd_lang') || 'tr'; } catch (e) { return 'tr'; }
})();

// The dictionary itself lives in i18n-dict.js (loaded right after this file) -
// kept separate purely so this file stays readable as "the engine" and the
// dictionary can grow to thousands of lines without burying the logic above.
// EN_DICT is declared there as `const EN_DICT = { ... }`.

function t(str) {
    if (currentLang !== 'en') return str;
    if (typeof EN_DICT === 'undefined') return str;
    return EN_DICT[str] !== undefined ? EN_DICT[str] : str;
}

function tf(template, vars) {
    let resolved = t(template);
    if (!vars) return resolved;
    Object.keys(vars).forEach(k => {
        resolved = resolved.split('{' + k + '}').join(vars[k]);
    });
    return resolved;
}

function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n-en]').forEach(el => {
        if (el.dataset.i18nTr === undefined) el.dataset.i18nTr = el.innerHTML;
        el.innerHTML = (currentLang === 'en') ? el.getAttribute('data-i18n-en') : el.dataset.i18nTr;
    });
    document.querySelectorAll('[data-i18n-placeholder-en]').forEach(el => {
        if (el.dataset.i18nPlaceholderTr === undefined) el.dataset.i18nPlaceholderTr = el.getAttribute('placeholder') || '';
        el.setAttribute('placeholder', (currentLang === 'en') ? el.getAttribute('data-i18n-placeholder-en') : el.dataset.i18nPlaceholderTr);
    });
    // Same idea as data-i18n-en, but for a `title` tooltip attribute rather
    // than innerHTML - needed for elements (like the wallet stat-item divs)
    // whose innerHTML holds a DYNAMIC child (a live gold/materials count)
    // that a full innerHTML swap would destroy.
    document.querySelectorAll('[data-i18n-title-en]').forEach(el => {
        if (el.dataset.i18nTitleTr === undefined) el.dataset.i18nTitleTr = el.getAttribute('title') || '';
        el.setAttribute('title', (currentLang === 'en') ? el.getAttribute('data-i18n-title-en') : el.dataset.i18nTitleTr);
    });
    document.documentElement.lang = currentLang;
}

// Re-renders whatever DYNAMIC (JS-generated, not static HTML) content is
// currently on screen so a language switch mid-game doesn't leave stale-
// language text sitting in an open modal until the next natural re-render.
// Every call defensively checks typeof - most of these functions come from
// files loaded after this one, and not every one is always relevant (e.g.
// no point re-rendering the shop if it's closed).
function refreshDynamicTranslations() {
    if (typeof updateUI === 'function') updateUI();
    if (typeof renderClassButtons === 'function') renderClassButtons();
    if (typeof renderModeButtons === 'function') renderModeButtons();
    if (typeof renderAccountStatus === 'function' && document.getElementById('account-modal') && document.getElementById('account-modal').style.display === 'flex') renderAccountStatus();
    if (typeof renderShop === 'function' && document.getElementById('shop-modal') && document.getElementById('shop-modal').style.display === 'flex') { renderShop(); renderInventory(); }
    if (typeof renderFriendsList === 'function' && document.getElementById('friends-modal') && document.getElementById('friends-modal').style.display === 'flex') renderFriendsList();
    if (typeof renderGuildPanel === 'function' && document.getElementById('guild-modal') && document.getElementById('guild-modal').style.display === 'flex') renderGuildPanel();
    if (typeof renderLeaderboard === 'function' && document.getElementById('leaderboard-modal') && document.getElementById('leaderboard-modal').style.display === 'flex') { renderLeaderboard(); renderPvpLeaderboard(); }
    if (typeof renderAchievements === 'function' && document.getElementById('achievements-modal') && document.getElementById('achievements-modal').style.display === 'flex') renderAchievements();
    if (typeof renderTitlesPanel === 'function' && document.getElementById('titles-modal') && document.getElementById('titles-modal').style.display === 'flex') renderTitlesPanel();
    if (typeof renderTalentsPanel === 'function' && document.getElementById('talents-modal') && document.getElementById('talents-modal').style.display === 'flex') renderTalentsPanel();
    if (typeof renderTradeOffers === 'function' && document.getElementById('trade-modal') && document.getElementById('trade-modal').style.display === 'flex') renderTradeOffers();
    if (typeof renderHistory === 'function' && document.getElementById('history-modal') && document.getElementById('history-modal').style.display === 'flex') renderHistory();
    if (typeof pvpUpdateUI === 'function' && document.getElementById('pvp-modal') && document.getElementById('pvp-modal').style.display === 'flex') pvpUpdateUI();
    if (typeof coopUpdateUI === 'function' && document.getElementById('coop-modal') && document.getElementById('coop-modal').style.display === 'flex') coopUpdateUI();
}

function updateLanguageToggleUI() {
    document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
        btn.innerText = currentLang === 'tr' ? '🇬🇧 EN' : '🇹🇷 TR';
    });
}

function setLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem('pd_lang', lang); } catch (e) {}
    applyStaticTranslations();
    refreshDynamicTranslations();
    updateLanguageToggleUI();
}

function toggleLanguage() {
    setLanguage(currentLang === 'tr' ? 'en' : 'tr');
}

document.addEventListener('DOMContentLoaded', () => {
    applyStaticTranslations();
    updateLanguageToggleUI();
});
