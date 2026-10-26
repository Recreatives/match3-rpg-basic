// --- SOCIAL ---------------------------------------------------------------------------
// Handles (Name#1234), friends, messages, the party and clans
// (supabase/schema.sql sections 35-40). The town's Post Tower opens the
// friends / messages window, the Clan Hall the clan window, the bell the
// notifications. Everything goes through the server's functions; this file
// only draws and polls.
//
// Live parts: new direct messages and clan chat arrive over Supabase
// Realtime (postgres_changes, filtered by RLS) - with a slow poll as a
// fallback - and presence (where my friends are) is a heartbeat the client
// sends about once a minute.

let socialMe = { handle: null, name: null, tag: null, changedAt: null, privacy: 'friends_clan', id: null };
let socialList = [];
let socialTab = 'friends';           // 'friends' | 'messages' | 'blocked'
let socialNotes = null;               // the last get_notifications()
let socialClan = null;                // the last get_my_clan()
let socialClanTab = 'members';
let socialParty = null;               // the last get_my_party()
let socialPartyCode = null;           // the co-op code we already joined
let socialActivity = 'town';
let socialTimers = [];
let socialLastSoldCheck = null;

const SOCIAL_ACTIVITY_LABEL = { town: 'Kasabada', pvp: 'PvP maçında', coop: 'Co-op zindanında' };
const CLAN_RANK_LABEL = { leader: 'Lider', officer: 'Subay', member: 'Üye', recruit: 'Acemi' };
const CLAN_SYMBOLS = ['lion', 'wolf', 'skull', 'star', 'tower', 'axe', 'eagle', 'moon'];
const CLAN_SYMBOL_LABEL = { lion: 'Aslan', wolf: 'Kurt', skull: 'Kafatası', star: 'Yıldız', tower: 'Kule', axe: 'Balta', eagle: 'Kartal', moon: 'Ay' };

function socialStatus(id, text, bad) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text || ''; el.style.color = bad ? '#f87171' : '#f1c40f'; }
}
function socialEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// "online" = seen in the last 2 minutes.
function socialOnline(lastSeen) { return !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 120000; }
function socialWhere(row) {
    if (!socialOnline(row.last_seen)) {
        if (!row.last_seen) return t('Çevrimdışı');
        const m = Math.floor((Date.now() - new Date(row.last_seen).getTime()) / 60000);
        return m < 60 ? tf('{m} dk önce görüldü', { m }) : m < 1440 ? tf('{h} sa önce görüldü', { h: Math.floor(m / 60) }) : tf('{d} gün önce görüldü', { d: Math.floor(m / 1440) });
    }
    const a = row.activity || 'town';
    if (a.indexOf('dungeon') === 0) { const f = a.split(':')[1]; return f ? tf('Zindanda, kat {n}', { n: f }) : t('Zindanda'); }
    return t(SOCIAL_ACTIVITY_LABEL[a] || 'Kasabada');
}
function socialDot(row) { return !socialOnline(row.last_seen) ? 'off' : (row.activity || 'town') === 'town' ? 'on' : 'busy'; }
function socialCharLine(row) {
    const d = row.char_class && typeof classDefFor === 'function' ? classDefFor(row.char_class) : null;
    return row.char_name ? `${d ? d.emoji + ' ' : ''}${socialEsc(row.char_name)} · ${tf('Sv. {n}', { n: row.char_level || 1 })}` : '';
}

// --- handle -----------------------------------------------------------------------------
async function socialFetchMe() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    socialMe.id = user.id;
    const { data, error } = await sb.from('players').select('handle_name, handle_tag, handle_changed_at, msg_privacy, display_name').eq('id', user.id).maybeSingle();
    if (error || !data) return null;
    socialMe.name = data.handle_name || null;
    socialMe.tag = data.handle_tag || null;
    socialMe.handle = data.handle_name ? `${data.handle_name}#${data.handle_tag}` : null;
    socialMe.changedAt = data.handle_changed_at || null;
    socialMe.privacy = data.msg_privacy || 'friends_clan';
    return socialMe;
}

function socialHandleNextFree() {
    if (!socialMe.changedAt) return null;
    const d = new Date(new Date(socialMe.changedAt).getTime() + 30 * 86400000);
    return d.getTime() > Date.now() ? d : null;
}

function openHandleModal(firstTime) {
    const m = document.getElementById('handle-modal');
    if (!m) return;
    const box = document.getElementById('handle-body');
    const next = socialHandleNextFree();
    box.innerHTML = `<p class="inv-muted">${firstTime ? t('Arkadaşlarının seni bulabilmesi için bir ad seç. Sonuna sunucu 4 haneli bir etiket ekler: Hakan#4821 gibi. Arkadaş eklemek için bu tam adı paylaşırsın.') : t('Adını değiştirince yeni bir etiket alırsın. Arkadaşlıkların, klanın ve mesajların aynen kalır.')}</p>
        ${socialMe.handle ? `<p class="handle-now">${t('Şu anki adın')}: <b>${socialEsc(socialMe.handle)}</b></p>` : ''}
        <input id="handle-input" type="text" maxlength="16" placeholder="${t('3-16 harf, rakam veya _')}" value="${socialEsc(socialMe.name || '')}">
        <p class="inv-muted">${next ? tf('Sonraki ücretsiz değişiklik: {d}. Daha önce değiştirmek 5.000 altın.', { d: next.toLocaleDateString() }) : t('Bu değişiklik ücretsiz.')}</p>
        <p id="handle-status" class="char-msg"></p>
        <button id="handle-save-btn" class="reward-btn rarity-legendary">${next ? t('5.000 altınla değiştir') : t('Kaydet')}</button>`;
    document.getElementById('handle-save-btn').onclick = () => socialSaveHandle(!!next);
    if (typeof cgAnimateModal === 'function') cgAnimateModal(m, true); else m.style.display = 'flex';
}
function closeHandleModal() {
    const m = document.getElementById('handle-modal');
    if (!m) return;
    if (typeof cgAnimateModal === 'function') cgAnimateModal(m, false); else m.style.display = 'none';
}

async function socialSaveHandle(pay) {
    const input = document.getElementById('handle-input');
    const name = (input && input.value || '').trim();
    if (!/^[A-Za-z0-9_ÇĞİÖŞÜçğıöşü]{3,16}$/.test(name)) { socialStatus('handle-status', t('Ad 3-16 harf, rakam veya _ olmalı.'), true); return; }
    if (pay && !confirm(t('Adını şimdi değiştirmek 5.000 altın tutar. Onaylıyor musun?'))) return;
    const { data, error } = await sb.rpc('set_handle', { p_name: name, p_pay: !!pay });
    if (error) {
        const m = error.message;
        socialStatus('handle-status', /insufficient gold/.test(m) ? t('Yeterli altının yok.') : /invalid/.test(m) ? t('Bu ad kullanılamaz.') : /full/.test(m) ? t('Bu ad dolmuş, başka bir ad dene.') : /next free/.test(m) ? t('Henüz ücretsiz değiştiremezsin.') : t('Ad kaydedilemedi.'), true);
        return;
    }
    await socialFetchMe();
    if (typeof fetchWallet === 'function') fetchWallet();
    closeHandleModal();
    if (typeof renderTown === 'function' && typeof townIsOpen === 'function' && townIsOpen()) renderTown();
    if (typeof renderSocial === 'function') renderSocial();
    socialToast('🏷️ ' + tf('Yeni adın: {h}', { h: data }));
}

function socialCopyHandle() {
    if (!socialMe.handle) return;
    try { navigator.clipboard.writeText(socialMe.handle); socialToast(t('Adın kopyalandı.')); } catch (e) { /* clipboard may be blocked */ }
}

function socialToast(text) {
    const el = document.createElement('div');
    el.className = 'achievement-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3200);
}

// --- presence --------------------------------------------------------------------------
async function socialTouch(activity) {
    if (activity) socialActivity = activity;
    if (typeof sb === 'undefined' || !socialMe.id) return;
    try { await sb.rpc('touch_presence', { p_activity: socialActivity }); } catch (e) { /* best effort */ }
}

// --- the Post Tower (friends / messages) -----------------------------------------------
async function socialFetchList() {
    const { data, error } = await sb.rpc('get_social_list');
    if (error) { console.warn('get_social_list:', error.message); return null; }
    socialList = data || [];
    return socialList;
}

function socialOpen(tab) {
    if (tab) socialTab = tab;
    const m = document.getElementById('friends-modal');
    if (!m || !m.classList.contains('visible')) { if (typeof toggleModal === 'function') toggleModal('friends-modal'); return; }
    renderSocial();
}

async function renderSocial() {
    const root = document.getElementById('friends-roster-view');
    if (!root) return;
    root.innerHTML = `<h2 class="modal-title">📮 ${t('POSTA KULESİ')}</h2>
        <div class="soc-me">${socialMe.handle ? `<span>${t('Sen')}: <b id="soc-my-handle">${socialEsc(socialMe.handle)}</b></span>
            <button class="soc-mini" id="soc-copy" title="${t('Kopyala')}">📋</button><button class="soc-mini" id="soc-rename" title="${t('Adını değiştir')}">✎</button>`
            : `<button class="action-btn" id="soc-rename">${t('Ad seç')}</button>`}</div>
        <div id="soc-party"></div>
        <div class="soc-add"><input id="friend-request-input" type="text" maxlength="21" placeholder="${t('Ad#1234 ile arkadaş ekle')}"><button class="action-btn" id="soc-add-btn">${t('Ekle')}</button></div>
        <p id="friends-status" class="soc-status"></p>
        <div class="inv-tabs soc-tabs">
            <button id="soc-tab-friends" class="inv-tab ${socialTab === 'friends' ? 'on' : ''}">${t('Arkadaşlar')}</button>
            <button id="soc-tab-messages" class="inv-tab ${socialTab === 'messages' ? 'on' : ''}">${t('Mesajlar')}</button>
            <button id="soc-tab-blocked" class="inv-tab ${socialTab === 'blocked' ? 'on' : ''}">${t('Engellenenler')}</button>
        </div>
        <div id="friends-list" class="soc-list"><p class="inv-muted">${t('Yükleniyor…')}</p></div>`;
    const copy = document.getElementById('soc-copy'); if (copy) copy.onclick = socialCopyHandle;
    document.getElementById('soc-rename').onclick = () => openHandleModal(!socialMe.handle);
    document.getElementById('soc-add-btn').onclick = socialAddFriend;
    document.getElementById('friend-request-input').onkeydown = ev => { if (ev.key === 'Enter') socialAddFriend(); };
    ['friends', 'messages', 'blocked'].forEach(k => { document.getElementById('soc-tab-' + k).onclick = () => { socialTab = k; renderSocial(); }; });
    renderSocialParty();
    if (socialTab === 'messages') return renderSocialMessages();
    if (socialTab === 'blocked') return renderSocialBlocked();
    return renderSocialFriends();
}

async function socialAddFriend() {
    const input = document.getElementById('friend-request-input');
    const v = (input && input.value || '').trim();
    if (!/^.{3,16}#\d{4}$/.test(v)) { socialStatus('friends-status', t('Tam adı yaz: Ad#1234'), true); return; }
    const { data, error } = await sb.rpc('send_friend_request', { p_display_name: v });
    if (error) { socialStatus('friends-status', t('İstek gönderilemedi.'), true); return; }
    const msg = { sent: t('İstek gönderildi.'), accepted: t('Artık arkadaşsınız!'), already_exists: t('Zaten arkadaşsınız ya da istek bekliyor.'), not_found: t('Bu adla bir oyuncu bulunamadı.'), full: t('Arkadaş listen dolu (100).'), self: t('Kendini ekleyemezsin.') }[data] || data;
    socialStatus('friends-status', msg, data !== 'sent' && data !== 'accepted');
    if (input && (data === 'sent' || data === 'accepted')) input.value = '';
    renderSocialFriends();
}

async function renderSocialFriends() {
    const box = document.getElementById('friends-list');
    if (!box) return;
    const list = await socialFetchList();
    if (!list) { box.innerHTML = `<p class="inv-muted">${t('Yüklenemedi.')}</p>`; return; }
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = `<p class="inv-muted">${t('Henüz arkadaşın yok. Bir arkadaşının Ad#1234 adını yazıp ekle.')}</p>`; return; }
    const inParty = socialParty && socialParty.members && socialParty.members.length >= 2;
    list.forEach(row => {
        const div = document.createElement('div');
        div.className = 'soc-row';
        div.dataset.friendId = row.friend_id;
        const tag = row.clan_tag ? `<span class="soc-tag">[${socialEsc(row.clan_tag)}]</span> ` : '';
        if (row.status === 'pending') {
            div.innerHTML = `<div class="soc-who"><b>${tag}${socialEsc(row.handle)}</b><small>${row.incoming ? t('Arkadaşlık isteği gönderdi') : t('İsteğin bekliyor')}</small></div><div class="soc-acts"></div>`;
            const acts = div.querySelector('.soc-acts');
            if (row.incoming) {
                acts.append(socialBtn('✔', t('Kabul et'), async () => { await sb.rpc('respond_friend_request', { p_requester_id: row.friend_id, p_accept: true }); renderSocialFriends(); socialPollNotes(); }, 'ok'),
                    socialBtn('✖', t('Reddet'), async () => { await sb.rpc('respond_friend_request', { p_requester_id: row.friend_id, p_accept: false }); renderSocialFriends(); socialPollNotes(); }));
            } else acts.append(socialBtn('✖', t('İsteği geri çek'), async () => { await sb.rpc('remove_friend', { p_friend_id: row.friend_id }); renderSocialFriends(); }));
        } else {
            div.innerHTML = `<span class="soc-dot ${socialDot(row)}"></span><div class="soc-who"><b>${tag}${socialEsc(row.handle)}${row.unread ? ` <span class="soc-badge">${row.unread}</span>` : ''}</b>
                <small>${socialEsc(socialWhere(row))}${row.char_name ? ' · ' + socialCharLine(row) : ''}</small></div><div class="soc-acts"></div>`;
            const acts = div.querySelector('.soc-acts');
            acts.append(socialBtn('💬', t('Mesaj'), () => socialOpenChat(row.friend_id, row.handle)));
            if (socialOnline(row.last_seen) && !inParty) acts.append(socialBtn('⚔️', t('Partiye davet et'), () => socialInviteParty(row.friend_id, row.handle)));
            acts.append(socialBtn('⋯', t('Diğer'), () => socialFriendMenu(row, div)));
        }
        box.appendChild(div);
    });
}

function socialBtn(icon, title, fn, cls) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'soc-mini' + (cls ? ' ' + cls : ''); b.textContent = icon; b.title = title; b.setAttribute('aria-label', title);
    b.onclick = ev => { ev.stopPropagation(); fn(); };
    return b;
}

// The "more" menu under a friend: trade, clan invite, remove, block, report.
function socialFriendMenu(row, div) {
    const old = document.getElementById('soc-menu');
    if (old) { const same = old.dataset.for === row.friend_id; old.remove(); if (same) return; }
    const menu = document.createElement('div');
    menu.id = 'soc-menu'; menu.className = 'soc-menu'; menu.dataset.for = row.friend_id;
    const add = (label, fn, cls) => { const b = document.createElement('button'); b.className = 'action-btn soc-menu-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; menu.appendChild(b); };
    if (typeof openTradeComposer === 'function') add('🔄 ' + t('Takas teklif et'), () => openTradeComposer(row.friend_id, row.handle));
    if (socialClan && socialClan.me && ['leader', 'officer', 'member'].indexOf(socialClan.me.rank) !== -1 && !row.clan_tag) add('🛡️ ' + t('Klana davet et'), async () => {
        const { error } = await sb.rpc('invite_to_clan', { p_player: row.friend_id });
        socialStatus('friends-status', error ? t('Klana davet edilemedi.') : t('Klan daveti gönderildi.'), !!error);
    });
    add('➖ ' + t('Arkadaşlıktan çıkar'), async () => { if (!confirm(tf('{h} arkadaş listenden çıkarılsın mı?', { h: row.handle }))) return; await sb.rpc('remove_friend', { p_friend_id: row.friend_id }); renderSocialFriends(); });
    add('🚫 ' + t('Engelle'), async () => { if (!confirm(tf('{h} engellensin mi? Sana yazamaz, davet gönderemez.', { h: row.handle }))) return; await sb.rpc('block_player', { p_target: row.friend_id }); renderSocialFriends(); }, 'danger');
    if (typeof openReportModal === 'function') add('🚩 ' + t('Şikayet et'), () => openReportModal(row.friend_id, row.handle, 'arkadaş'), 'danger');
    div.after(menu);
}

async function renderSocialMessages() {
    const box = document.getElementById('friends-list');
    if (!box) return;
    const { data, error } = await sb.rpc('get_conversations');
    box.innerHTML = '';
    const pr = document.createElement('div');
    pr.className = 'soc-privacy';
    pr.innerHTML = `<label>${t('Bana kimler yazabilir')}: <select id="soc-privacy"><option value="friends">${t('Arkadaşlarım')}</option><option value="friends_clan">${t('Arkadaşlarım ve klanım')}</option><option value="nobody">${t('Kimse')}</option></select></label>`;
    box.appendChild(pr);
    const sel = pr.querySelector('select');
    sel.value = socialMe.privacy;
    sel.onchange = async () => { const { error: e } = await sb.rpc('set_message_privacy', { p_mode: sel.value }); if (!e) socialMe.privacy = sel.value; };
    if (error) { box.insertAdjacentHTML('beforeend', `<p class="inv-muted">${t('Yüklenemedi.')}</p>`); return; }
    if (!data || !data.length) { box.insertAdjacentHTML('beforeend', `<p class="inv-muted">${t('Henüz mesajın yok.')}</p>`); return; }
    data.forEach(c => {
        const row = document.createElement('div');
        row.className = 'soc-row clickable';
        row.innerHTML = `<div class="soc-who"><b>${socialEsc(c.handle)}${c.unread ? ` <span class="soc-badge">${c.unread}</span>` : ''}</b><small>${c.last_from_me ? t('Sen') + ': ' : ''}${socialEsc(String(c.last_body).slice(0, 60))}</small></div>
            <small class="soc-time">${new Date(c.last_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</small>`;
        row.onclick = () => socialOpenChat(c.partner_id, c.handle);
        box.appendChild(row);
    });
}

async function renderSocialBlocked() {
    const box = document.getElementById('friends-list');
    if (!box) return;
    const { data, error } = await sb.rpc('get_blocked_list');
    box.innerHTML = '';
    if (error) { box.innerHTML = `<p class="inv-muted">${t('Yüklenemedi.')}</p>`; return; }
    if (!data || !data.length) { box.innerHTML = `<p class="inv-muted">${t('Engellediğin kimse yok.')}</p>`; return; }
    data.forEach(b => {
        const row = document.createElement('div');
        row.className = 'soc-row';
        row.innerHTML = `<div class="soc-who"><b>${socialEsc(b.handle)}</b></div><div class="soc-acts"></div>`;
        row.querySelector('.soc-acts').appendChild(socialBtn('↩', t('Engeli kaldır'), async () => { await sb.rpc('unblock_player', { p_target: b.player_id }); renderSocialBlocked(); }));
        box.appendChild(row);
    });
}

// The chat view (economy.js owns it: openConversation / renderConversation);
// here: mark read, and live delivery.
function socialOpenChat(friendId, handle) {
    if (typeof openConversation === 'function') openConversation(friendId, handle);
    sb.rpc('mark_conversation_read', { p_partner: friendId }).then(() => socialPollNotes(), () => {});
}

// --- party ------------------------------------------------------------------------------
async function socialFetchParty() {
    const { data, error } = await sb.rpc('get_my_party');
    if (error) return socialParty;
    socialParty = data || null;
    // the leader started co-op: everyone in the party joins the same room
    if (socialParty && socialParty.coop_code && socialParty.coop_code !== socialPartyCode && typeof townIsOpen === 'function' && townIsOpen()) socialJoinPartyCoop(socialParty.coop_code);
    return socialParty;
}

function renderSocialParty() {
    const box = document.getElementById('soc-party');
    if (!box) return;
    const p = socialParty;
    if (!p || !p.members || !p.members.length) { box.innerHTML = ''; return; }
    const lead = p.leader_id === socialMe.id;
    box.innerHTML = `<div class="soc-party-box"><b>⚔️ ${t('Partin')}</b>${p.members.map(m => `<span class="soc-party-m">${m.player_id === p.leader_id ? '👑 ' : ''}${socialEsc(m.handle)}${m.char_name ? ' · ' + socialCharLine(m) : ''}</span>`).join('')}
        <div class="soc-acts">${lead && p.members.length >= 2 ? `<button class="action-btn primary" id="soc-party-go">${t('Birlikte co-op zindanına gir')}</button>` : (!lead ? `<small>${t('Lider zindanı başlatınca otomatik katılacaksın.')}</small>` : `<small>${t('Bir arkadaşını davet et.')}</small>`)}
        <button class="action-btn" id="soc-party-leave">${t('Partiden ayrıl')}</button></div></div>`;
    const go = document.getElementById('soc-party-go');
    if (go) go.onclick = async () => {
        const { data, error } = await sb.rpc('party_start_coop');
        if (error) { socialStatus('friends-status', t('Başlatılamadı.'), true); return; }
        socialJoinPartyCoop(data);
    };
    document.getElementById('soc-party-leave').onclick = async () => { await sb.rpc('leave_party'); socialParty = null; renderSocial(); };
}

async function socialInviteParty(friendId, handle) {
    const { error } = await sb.rpc('invite_to_party', { p_player: friendId });
    socialStatus('friends-status', error ? (/full/.test(error.message) ? t('Parti dolu (2 kişi).') : t('Davet gönderilemedi.')) : tf('{h} partiye davet edildi (2 dakika geçerli).', { h: handle }), !!error);
    await socialFetchParty();
    renderSocialParty();
}

function socialJoinPartyCoop(code) {
    socialPartyCode = code;
    ['friends-modal', 'clan-modal'].forEach(id => { const m = document.getElementById(id); if (m && m.classList.contains('visible') && typeof toggleModal === 'function') toggleModal(id); });
    if (typeof townEnterMatch === 'function') townEnterMatch('coop-modal');
    const input = document.getElementById('coop-room-input');
    if (input) input.value = code;
    socialTouch('coop');
    if (typeof coopJoinRoom === 'function') coopJoinRoom();
}

// --- notifications (the town's bell) ------------------------------------------------------
async function socialPollNotes() {
    if (typeof sb === 'undefined' || !socialMe.id) return null;
    const { data, error } = await sb.rpc('get_notifications', { p_since: socialLastSoldCheck });
    if (error || !data) return null;
    socialNotes = data;
    const crestChanged = JSON.stringify(socialNotes.clan_crest || null) !== JSON.stringify(socialClanCrestCache);
    socialClanCrestCache = socialNotes.clan_crest || null;
    if (crestChanged && typeof refreshMyAvatar === 'function') refreshMyAvatar(true);
    socialUpdateBadges();
    if (typeof socialParty !== 'undefined') socialFetchParty();
    return data;
}
let socialClanCrestCache = null;

function socialNoteCount() {
    const n = socialNotes;
    if (!n) return 0;
    return (n.friend_requests | 0) + (n.unread_messages | 0) + (n.party_invites || []).length + (n.clan_invites || []).length + (n.clan_applications | 0) + (n.sold || []).length;
}

function socialUpdateBadges() {
    const total = socialNoteCount();
    const bell = document.getElementById('town-bell-count');
    if (bell) { bell.textContent = total > 9 ? '9+' : String(total); bell.style.display = total ? 'inline-block' : 'none'; }
    const n = socialNotes || {};
    const post = (n.friend_requests | 0) + (n.unread_messages | 0);
    const clan = (n.clan_invites || []).length + (n.clan_applications | 0);
    [['post', post], ['clan', clan]].forEach(([id, c]) => {
        const el = document.getElementById('town-badge-' + id);
        if (el) { el.style.display = c ? 'block' : 'none'; const tx = el.querySelector('text'); if (tx) tx.textContent = c > 9 ? '9+' : String(c); }
    });
}

function openNotifications() {
    const m = document.getElementById('notes-modal');
    if (!m) return;
    renderNotifications();
    if (typeof cgAnimateModal === 'function') cgAnimateModal(m, true); else m.style.display = 'flex';
    socialPollNotes().then(renderNotifications);
}
function closeNotifications() {
    const m = document.getElementById('notes-modal');
    if (m) { if (typeof cgAnimateModal === 'function') cgAnimateModal(m, false); else m.style.display = 'none'; }
}

function renderNotifications() {
    const box = document.getElementById('notes-body');
    if (!box) return;
    const n = socialNotes || {};
    box.innerHTML = '';
    const line = (icon, text, actions) => {
        const row = document.createElement('div'); row.className = 'soc-row';
        row.innerHTML = `<div class="soc-who"><b>${icon} ${text}</b></div><div class="soc-acts"></div>`;
        (actions || []).forEach(a => row.querySelector('.soc-acts').appendChild(a));
        box.appendChild(row);
    };
    (n.party_invites || []).forEach(inv => line('⚔️', tf('{h} seni partiye çağırıyor', { h: socialEsc(inv.from) }), [
        socialBtn('✔', t('Kabul et'), async () => { const { error } = await sb.rpc('respond_party_invite', { p_invite: inv.id, p_accept: true }); if (error) socialToast(/expired/.test(error.message) ? t('Davetin süresi dolmuş.') : t('Partiye katılınamadı.')); await socialPollNotes(); await socialFetchParty(); renderNotifications(); }, 'ok'),
        socialBtn('✖', t('Reddet'), async () => { await sb.rpc('respond_party_invite', { p_invite: inv.id, p_accept: false }); await socialPollNotes(); renderNotifications(); })]));
    (n.clan_invites || []).forEach(inv => line('🛡️', tf('[{tag}] {name} klanına davet ({h})', { tag: socialEsc(inv.tag), name: socialEsc(inv.name), h: socialEsc(inv.from || '?') }), [
        socialBtn('✔', t('Kabul et'), async () => { const { error } = await sb.rpc('respond_clan_invite', { p_clan_id: inv.clan_id, p_accept: true }); if (error) socialToast(t('Klana katılınamadı.')); await socialPollNotes(); renderNotifications(); }, 'ok'),
        socialBtn('✖', t('Reddet'), async () => { await sb.rpc('respond_clan_invite', { p_clan_id: inv.clan_id, p_accept: false }); await socialPollNotes(); renderNotifications(); })]));
    if (n.friend_requests) line('👥', tf('{n} arkadaşlık isteği', { n: n.friend_requests }), [socialBtn('➜', t('Aç'), () => { closeNotifications(); socialOpen('friends'); })]);
    if (n.unread_messages) line('💬', tf('{n} okunmamış mesaj', { n: n.unread_messages }), [socialBtn('➜', t('Aç'), () => { closeNotifications(); socialOpen('messages'); })]);
    if (n.clan_applications) line('📜', tf('{n} klan başvurusu', { n: n.clan_applications }), [socialBtn('➜', t('Aç'), () => { closeNotifications(); clanOpen('applications'); })]);
    (n.sold || []).forEach(s => line('💰', tf('Müzayedede bir eşyan satıldı: +{g} altın', { g: s.price - Math.floor(s.price * 0.05) })));
    if (!box.children.length) box.innerHTML = `<p class="inv-muted">${t('Yeni bir şey yok.')}</p>`;
    if ((n.sold || []).length) socialLastSoldCheck = new Date().toISOString();
}

// --- clans --------------------------------------------------------------------------------
async function clanFetch() {
    const { data, error } = await sb.rpc('get_my_clan');
    if (error) return socialClan;
    socialClan = data || null;
    return socialClan;
}

function clanOpen(tab) {
    if (tab) socialClanTab = tab;
    const m = document.getElementById('clan-modal');
    if (!m) return;
    if (!m.classList.contains('visible')) { if (typeof toggleModal === 'function') toggleModal('clan-modal'); return; }
    renderClan();
}

// A crest badge as inline SVG (also painted on capes / tabards / shields - avatar.js avCrest).
function clanCrestSvg(crest, size) {
    if (typeof avCrestSvg === 'function') return avCrestSvg(crest, size || 40);
    return '';
}

async function renderClan() {
    const box = document.getElementById('clan-body');
    if (!box) return;
    box.innerHTML = `<p class="inv-muted">${t('Yükleniyor…')}</p>`;
    const c = await clanFetch();
    if (!c) return renderClanless(box);
    const clan = c.clan, me = c.me, rank = me.rank, rv = { leader: 4, officer: 3, member: 2, recruit: 1 }[rank] || 0;
    const pct = clan.next_level_xp ? Math.min(100, Math.round(clan.xp / clan.next_level_xp * 100)) : 100;
    box.innerHTML = `<div class="clan-head">${clanCrestSvg(clan.crest, 54)}<div><b class="clan-name">[${socialEsc(clan.tag)}] ${socialEsc(clan.name)}</b>
            <small>${tf('Seviye {n}', { n: clan.level })} · ${tf('{m}/{cap} üye', { m: c.members.length, cap: clan.cap })} · ${t(CLAN_RANK_LABEL[rank])}</small>
            <div class="char-xp"><div style="width:${pct}%"></div></div></div></div>
        ${clan.motd ? `<p class="clan-motd">📣 ${socialEsc(clan.motd)}</p>` : ''}
        <div class="inv-tabs soc-tabs" id="clan-tabs"></div>
        <div id="clan-tab-body"></div>
        <p id="clan-status" class="soc-status"></p>
        <button class="action-btn danger" id="clan-leave">${rank === 'leader' && c.members.length === 1 ? t('Klanı dağıt') : t('Klandan ayrıl')}</button>`;
    const tabs = [['members', t('Üyeler')], ['chat', t('Sohbet')]];
    if (rv >= 3) tabs.push(['applications', t('Başvurular') + (c.applications.length ? ` (${c.applications.length})` : '')], ['settings', t('Ayarlar')]);
    tabs.push(['log', t('Kayıt')]);
    if (!tabs.some(x => x[0] === socialClanTab)) socialClanTab = 'members';
    const tb = document.getElementById('clan-tabs');
    tabs.forEach(([k, label]) => { const b = document.createElement('button'); b.id = 'clan-tab-' + k; b.className = 'inv-tab' + (socialClanTab === k ? ' on' : ''); b.textContent = label; b.onclick = () => { socialClanTab = k; renderClan(); }; tb.appendChild(b); });
    document.getElementById('clan-leave').onclick = async () => {
        if (!confirm(rank === 'leader' && c.members.length === 1 ? t('Klan tamamen kapanacak. Emin misin?') : t('Klandan ayrılmak istediğine emin misin?'))) return;
        const { error } = await sb.rpc('leave_clan');
        if (error) { socialStatus('clan-status', t('Ayrılınamadı.'), true); return; }
        socialClan = null; socialPollNotes(); renderClan();
    };
    const body = document.getElementById('clan-tab-body');
    if (socialClanTab === 'chat') return renderClanChat(body);
    if (socialClanTab === 'applications') return renderClanApplications(body, c);
    if (socialClanTab === 'settings') return renderClanSettings(body, c);
    if (socialClanTab === 'log') { body.innerHTML = c.log.map(l => `<div class="clan-log"><small>${new Date(l.at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small> ${socialEsc(l.text)}</div>`).join('') || `<p class="inv-muted">${t('Kayıt yok.')}</p>`; return; }
    // members
    c.members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'soc-row';
        row.innerHTML = `<span class="soc-dot ${socialDot(m)}"></span><div class="soc-who"><b>${socialEsc(m.handle)}</b><small>${t(CLAN_RANK_LABEL[m.rank])} · ${socialEsc(socialWhere(m))}${m.char_name ? ' · ' + socialCharLine(m) : ''}</small></div><div class="soc-acts"></div>`;
        const acts = row.querySelector('.soc-acts');
        if (m.player_id !== socialMe.id) {
            acts.appendChild(socialBtn('💬', t('Mesaj'), () => { toggleModal('clan-modal'); socialOpen('messages'); setTimeout(() => socialOpenChat(m.player_id, m.handle), 50); }));
            if (rank === 'leader') {
                const sel = document.createElement('select'); sel.className = 'clan-rank-sel'; sel.setAttribute('aria-label', t('Rütbe'));
                ['officer', 'member', 'recruit', 'leader'].forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r === 'leader' ? t('Liderliği devret') : t(CLAN_RANK_LABEL[r]); sel.appendChild(o); });
                sel.value = m.rank;
                sel.onchange = async () => {
                    if (sel.value === 'leader' && !confirm(tf('Liderliği {h} oyuncusuna devretmek istiyor musun?', { h: m.handle }))) { sel.value = m.rank; return; }
                    const { error } = await sb.rpc('set_clan_rank', { p_player: m.player_id, p_rank: sel.value });
                    socialStatus('clan-status', error ? t('Rütbe değiştirilemedi.') : t('Rütbe güncellendi.'), !!error); renderClan();
                };
                acts.appendChild(sel);
            }
            if (rank === 'leader' || (rank === 'officer' && ['member', 'recruit'].indexOf(m.rank) !== -1)) acts.appendChild(socialBtn('✖', t('Klandan çıkar'), async () => {
                if (!confirm(tf('{h} klandan çıkarılsın mı?', { h: m.handle }))) return;
                const { error } = await sb.rpc('kick_clan_member', { p_player: m.player_id });
                socialStatus('clan-status', error ? t('Çıkarılamadı.') : t('Üye çıkarıldı.'), !!error); renderClan();
            }));
        }
        body.appendChild(row);
    });
}

async function renderClanChat(body) {
    body.innerHTML = `<div id="clan-chat" class="clan-chat"></div><div class="soc-add"><input id="clan-chat-input" type="text" maxlength="300" placeholder="${t('Klana bir mesaj yaz…')}"><button class="action-btn" id="clan-chat-send">${t('Gönder')}</button></div>`;
    const send = async () => {
        const input = document.getElementById('clan-chat-input');
        const v = (input.value || '').trim();
        if (!v) return;
        const { error } = await sb.rpc('send_clan_message', { p_body: v });
        if (error) { socialStatus('clan-status', /slow/.test(error.message) ? t('Biraz yavaş, lütfen.') : /not allowed/.test(error.message) ? t('Bu mesaj gönderilemez.') : t('Gönderilemedi.'), true); return; }
        input.value = '';
        clanLoadChat();
    };
    document.getElementById('clan-chat-send').onclick = send;
    document.getElementById('clan-chat-input').onkeydown = ev => { if (ev.key === 'Enter') send(); };
    clanLoadChat();
}
async function clanLoadChat() {
    const box = document.getElementById('clan-chat');
    if (!box) return;
    const { data, error } = await sb.rpc('get_clan_messages', { p_limit: 80 });
    if (error) return;
    box.innerHTML = (data || []).map(m => `<div class="chat-line${m.sender_id === socialMe.id ? ' me' : ''}"><b>${socialEsc(m.sender || '?')}</b> ${socialEsc(m.body)}</div>`).join('') || `<p class="inv-muted">${t('Henüz mesaj yok.')}</p>`;
    box.scrollTop = box.scrollHeight;
}

function renderClanApplications(body, c) {
    if (!c.applications.length) { body.innerHTML = `<p class="inv-muted">${t('Bekleyen başvuru yok.')}</p>`; return; }
    c.applications.forEach(a => {
        const row = document.createElement('div'); row.className = 'soc-row';
        row.innerHTML = `<div class="soc-who"><b>${socialEsc(a.handle)}</b><small>${socialEsc(a.message || '')}</small></div><div class="soc-acts"></div>`;
        const acts = row.querySelector('.soc-acts');
        acts.append(socialBtn('✔', t('Kabul et'), async () => { const { error } = await sb.rpc('review_clan_application', { p_player: a.player_id, p_accept: true }); socialStatus('clan-status', error ? (/full/.test(error.message) ? t('Klan dolu.') : t('Kabul edilemedi.')) : t('Yeni üye katıldı!'), !!error); socialPollNotes(); renderClan(); }, 'ok'),
            socialBtn('✖', t('Reddet'), async () => { await sb.rpc('review_clan_application', { p_player: a.player_id, p_accept: false }); socialPollNotes(); renderClan(); }));
        body.appendChild(row);
    });
}

function renderClanSettings(body, c) {
    const clan = c.clan, leader = c.me.rank === 'leader';
    const crest = Object.assign({ c1: '#8e1b1b', c2: '#d4a84a', sym: 'lion' }, clan.crest || {});
    body.innerHTML = `<label class="clan-field">${t('Günün duyurusu')}<textarea id="clan-motd" maxlength="200" rows="2">${socialEsc(clan.motd)}</textarea></label>
        ${leader ? `<label class="clan-field">${t('Katılım')}<select id="clan-join"><option value="open">${t('Açık (herkes katılır)')}</option><option value="apply">${t('Başvuruyla')}</option><option value="invite">${t('Sadece davetle')}</option></select></label>
        <div class="clan-field">${t('Arma')}<div class="clan-crest-edit"><span id="clan-crest-preview">${clanCrestSvg(crest, 56)}</span>
            <label>${t('Zemin')} <input type="color" id="clan-c1" value="${crest.c1}"></label><label>${t('Simge')} <input type="color" id="clan-c2" value="${crest.c2}"></label>
            <select id="clan-sym">${CLAN_SYMBOLS.map(s => `<option value="${s}">${t(CLAN_SYMBOL_LABEL[s])}</option>`).join('')}</select></div></div>` : ''}
        <button class="action-btn primary" id="clan-save">${t('Kaydet')}</button>`;
    if (leader) {
        document.getElementById('clan-join').value = clan.join_mode;
        document.getElementById('clan-sym').value = crest.sym;
        const prev = () => { document.getElementById('clan-crest-preview').innerHTML = clanCrestSvg({ c1: document.getElementById('clan-c1').value, c2: document.getElementById('clan-c2').value, sym: document.getElementById('clan-sym').value }, 56); };
        ['clan-c1', 'clan-c2', 'clan-sym'].forEach(id => { document.getElementById(id).oninput = prev; document.getElementById(id).onchange = prev; });
    }
    document.getElementById('clan-save').onclick = async () => {
        const args = { p_motd: document.getElementById('clan-motd').value, p_join_mode: null, p_crest: null };
        if (leader) { args.p_join_mode = document.getElementById('clan-join').value; args.p_crest = { c1: document.getElementById('clan-c1').value, c2: document.getElementById('clan-c2').value, sym: document.getElementById('clan-sym').value }; }
        const { error } = await sb.rpc('set_clan_settings', args);
        socialStatus('clan-status', error ? t('Kaydedilemedi.') : t('Kaydedildi.'), !!error);
        if (!error) { await socialPollNotes(); renderClan(); }
    };
}

// No clan yet: find one, found one, or answer invites.
async function renderClanless(box) {
    const n = socialNotes || {};
    box.innerHTML = `<p class="inv-muted">${t('Bir klana katıl ya da kendi klanını kur. Klanlar sohbet eder, birlikte gelişir; klanın arması pelerininde ve kalkanında görünür.')}</p>
        ${(n.clan_invites || []).length ? `<div id="clan-invites"></div>` : ''}
        <div class="soc-add"><input id="clan-search" type="text" maxlength="24" placeholder="${t('Klan ara (ad ya da etiket)')}"><button class="action-btn" id="clan-search-btn">${t('Ara')}</button></div>
        <div id="clan-list" class="soc-list"></div>
        <h4>${t('Klan kur')}</h4>
        <p class="inv-muted">${t('Şart: seviye 20 bir karakter ve 5.000 altın.')}</p>
        <div class="clan-create"><input id="clan-new-name" maxlength="24" placeholder="${t('Klan adı (3-24)')}"><input id="clan-new-tag" maxlength="4" placeholder="${t('Etiket (2-4)')}" style="text-transform:uppercase"></div>
        <button class="action-btn primary" id="clan-create-btn">${t('Klanı kur (5.000 🪙)')}</button>
        <p id="clan-status" class="soc-status"></p>`;
    if ((n.clan_invites || []).length) {
        const ib = document.getElementById('clan-invites');
        n.clan_invites.forEach(inv => {
            const row = document.createElement('div'); row.className = 'soc-row';
            row.innerHTML = `<div class="soc-who"><b>🛡️ [${socialEsc(inv.tag)}] ${socialEsc(inv.name)}</b><small>${tf('{h} seni davet etti', { h: socialEsc(inv.from || '?') })}</small></div><div class="soc-acts"></div>`;
            row.querySelector('.soc-acts').append(socialBtn('✔', t('Kabul et'), async () => { const { error } = await sb.rpc('respond_clan_invite', { p_clan_id: inv.clan_id, p_accept: true }); if (error) socialStatus('clan-status', t('Klana katılınamadı.'), true); await socialPollNotes(); renderClan(); }, 'ok'),
                socialBtn('✖', t('Reddet'), async () => { await sb.rpc('respond_clan_invite', { p_clan_id: inv.clan_id, p_accept: false }); await socialPollNotes(); renderClan(); }));
            ib.appendChild(row);
        });
    }
    const search = async () => {
        const q = (document.getElementById('clan-search').value || '').trim();
        const { data, error } = await sb.rpc('get_clan_list', { p_search: q || null });
        const list = document.getElementById('clan-list');
        if (!list) return;
        list.innerHTML = '';
        if (error) { list.innerHTML = `<p class="inv-muted">${t('Yüklenemedi.')}</p>`; return; }
        if (!data || !data.length) { list.innerHTML = `<p class="inv-muted">${t('Klan bulunamadı.')}</p>`; return; }
        data.forEach(cl => {
            const row = document.createElement('div'); row.className = 'soc-row';
            const mode = { open: t('Açık'), apply: t('Başvuruyla'), invite: t('Davetle') }[cl.join_mode];
            row.innerHTML = `${clanCrestSvg(cl.crest, 34)}<div class="soc-who"><b>[${socialEsc(cl.tag)}] ${socialEsc(cl.name)}</b><small>${tf('Seviye {n}', { n: cl.level })} · ${cl.members}/${cl.cap} · ${mode}${cl.motd ? ' · ' + socialEsc(cl.motd.slice(0, 40)) : ''}</small></div><div class="soc-acts"></div>`;
            if (cl.join_mode !== 'invite') row.querySelector('.soc-acts').appendChild(socialBtn(cl.join_mode === 'open' ? '➕' : '📜', cl.join_mode === 'open' ? t('Katıl') : t('Başvur'), async () => {
                const msg = cl.join_mode === 'apply' ? (prompt(t('Başvuru notun (isteğe bağlı):')) || '') : '';
                const { data: r, error: e } = await sb.rpc('join_clan', { p_clan_id: cl.id, p_message: msg });
                if (e) { socialStatus('clan-status', /full/.test(e.message) ? t('Klan dolu.') : t('Katılınamadı.'), true); return; }
                socialStatus('clan-status', r === 'applied' ? t('Başvurun gönderildi.') : t('Klana katıldın!'));
                if (r === 'joined') { await socialPollNotes(); renderClan(); }
            }, 'ok'));
            list.appendChild(row);
        });
    };
    document.getElementById('clan-search-btn').onclick = search;
    document.getElementById('clan-search').onkeydown = ev => { if (ev.key === 'Enter') search(); };
    document.getElementById('clan-create-btn').onclick = async () => {
        const name = document.getElementById('clan-new-name').value.trim(), tag = document.getElementById('clan-new-tag').value.trim().toUpperCase();
        if (!/^[A-Za-z0-9ÇĞİÖŞÜçğıöşü ]{3,24}$/.test(name)) { socialStatus('clan-status', t('Klan adı 3-24 harf/rakam olmalı.'), true); return; }
        if (!/^[A-Z0-9]{2,4}$/.test(tag)) { socialStatus('clan-status', t('Etiket 2-4 harf/rakam olmalı.'), true); return; }
        if (!confirm(tf('[{tag}] {name} klanı 5.000 altına kurulsun mu?', { tag, name }))) return;
        const { error } = await sb.rpc('create_clan', { p_name: name, p_tag: tag });
        if (error) {
            const m = error.message;
            socialStatus('clan-status', /level 20/.test(m) ? t('Seviye 20 bir karakter gerekiyor.') : /insufficient/.test(m) ? t('Yeterli altının yok.') : /name taken/.test(m) ? t('Bu klan adı alınmış.') : /tag taken/.test(m) ? t('Bu etiket alınmış.') : /invalid/.test(m) ? t('Bu ad ya da etiket kullanılamaz.') : t('Klan kurulamadı.'), true);
            return;
        }
        if (typeof fetchWallet === 'function') fetchWallet();
        await socialPollNotes();
        socialToast('🛡️ ' + t('Klanın kuruldu!'));
        renderClan();
    };
    search();
}

// --- boot / live --------------------------------------------------------------------------
let socialRealtime = null;
function socialSubscribe() {
    if (socialRealtime || typeof sb === 'undefined' || !sb.channel || !socialMe.id) return;
    try {
        socialRealtime = sb.channel('social-' + socialMe.id)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: 'receiver_id=eq.' + socialMe.id }, payload => {
                const row = payload && payload.new;
                if (row && typeof dmActiveFriendId !== 'undefined' && dmActiveFriendId === row.sender_id) {
                    if (typeof renderConversation === 'function') renderConversation();
                    sb.rpc('mark_conversation_read', { p_partner: row.sender_id }).then(() => {}, () => {});
                } else if (row) socialToast('💬 ' + t('Yeni mesaj'));
                socialPollNotes();
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clan_messages' }, () => { clanLoadChat(); })
            .subscribe();
    } catch (e) { socialRealtime = null; }
}

// Called once the economy is up: who am I, a name if I have none, presence,
// notifications and live delivery.
async function socialInit() {
    if (typeof sb === 'undefined') return;
    const me = await socialFetchMe();
    if (!me) return;
    if (!me.handle) openHandleModal(true);
    socialTouch('town');
    socialPollNotes();
    clanFetch();
    socialSubscribe();
    socialTimers.forEach(clearInterval);
    socialTimers = [
        setInterval(() => socialTouch(), 60000),
        setInterval(() => { if (typeof townIsOpen === 'function' && townIsOpen()) socialPollNotes(); }, 20000),
    ];
}
