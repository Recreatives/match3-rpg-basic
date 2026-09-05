// --- SOUND EFFECTS (synthesized, no audio asset files) ---
// The game shipped completely silent through every previous phase - this is
// deliberately the cheapest possible fix for that: short synthesized tones
// via the Web Audio API instead of sourcing/hosting real sample files (there
// are none available in this project, and adding a binary asset pipeline for
// a handful of blips would be a much bigger change than the payoff justifies
// right now). Every mode (solo/PvP/co-op) calls the same small set of named
// cues below - one shared sound vocabulary instead of three copies.
//
// Muted state persists in localStorage (per-device, no server round trip -
// this is a pure UI preference, not game state).
const SOUND_MUTE_KEY = 'pixelDungeonMuted';
let soundMuted = localStorage.getItem(SOUND_MUTE_KEY) === 'true';
let audioCtx = null;

function getAudioCtx() {
    // Created lazily, only on first real use (inside a user-gesture-
    // triggered call) - browsers refuse to auto-start an AudioContext
    // before any interaction, so constructing one at page load would just
    // sit "suspended" and could throw in stricter browsers anyway.
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

function toggleSoundMute() {
    soundMuted = !soundMuted;
    localStorage.setItem(SOUND_MUTE_KEY, String(soundMuted));
    updateSoundMuteUI();
    if (!soundMuted) playSound('click');
}

function updateSoundMuteUI() {
    let btn = document.getElementById('sound-mute-btn');
    if (btn) btn.innerText = soundMuted ? '🔇' : '🔊';
}

// One short tone. `type` is the oscillator waveform (sine=soft, square/
// sawtooth=harsher - used for hits/crits), the gain ramp is exponential so
// it decays like a real pluck instead of clicking off abruptly at the end.
function playTone(freq, duration, type, volume) {
    if (soundMuted) return;
    try {
        let ctx = getAudioCtx();
        if (!ctx) return;
        let osc = ctx.createOscillator();
        let gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(volume || 0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) { /* audio is a nice-to-have, never worth breaking gameplay over */ }
}

// A short sequence of tones, one after another - used for the bigger
// moments (victory/defeat) where a single blip doesn't feel like enough.
function playSequence(notes) {
    if (soundMuted) return;
    let t = 0;
    notes.forEach(n => {
        setTimeout(() => playTone(n.freq, n.duration, n.type, n.volume), t * 1000);
        t += n.duration * 0.8; // slight overlap reads as more musical than a hard gap
    });
}

const SOUNDS = {
    match: () => playTone(660, 0.12, 'sine', 0.12),
    match_big: () => playSequence([{ freq: 660, duration: 0.1 }, { freq: 880, duration: 0.14 }]),
    hit: () => playTone(180, 0.15, 'square', 0.12),
    crit: () => playSequence([{ freq: 220, duration: 0.08, type: 'square' }, { freq: 140, duration: 0.18, type: 'sawtooth' }]),
    heal: () => playSequence([{ freq: 520, duration: 0.1 }, { freq: 660, duration: 0.12 }]),
    shield: () => playTone(300, 0.14, 'triangle', 0.12),
    ult: () => playSequence([{ freq: 440, duration: 0.1 }, { freq: 660, duration: 0.1 }, { freq: 880, duration: 0.22 }]),
    victory: () => playSequence([{ freq: 523, duration: 0.14 }, { freq: 659, duration: 0.14 }, { freq: 784, duration: 0.14 }, { freq: 1047, duration: 0.3 }]),
    defeat: () => playSequence([{ freq: 392, duration: 0.2, type: 'sawtooth' }, { freq: 330, duration: 0.2, type: 'sawtooth' }, { freq: 262, duration: 0.4, type: 'sawtooth' }]),
    click: () => playTone(500, 0.06, 'sine', 0.08),
    dodge: () => playTone(880, 0.08, 'sine', 0.1),
    gold: () => playSequence([{ freq: 987, duration: 0.06 }, { freq: 1318, duration: 0.1 }])
};

function playSound(name) {
    if (SOUNDS[name]) SOUNDS[name]();
}

updateSoundMuteUI(); // reflect the stored preference on the button as soon as it exists

// One delegated listener instead of wiring a click sound into every button
// individually (there are dozens across class/mode select, rewards, shop,
// modals...) - anything that already looks like an actionable button gets
// the same soft confirm click, without having to touch each onclick.
document.addEventListener('click', e => {
    if (e.target.closest('.reward-btn, .overlay-btn, .action-btn, .loot-btn, .stats-peek-btn, .close-modal')) {
        playSound('click');
    }
});
