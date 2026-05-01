// Nick's Robot Biscuit — frontend logic
// Voice in/out via Web Speech API; UI state machine; bridge to Python via pywebview.

(function () {
  'use strict';

  // Mouth coords match the new full-body SVG: snout cy=200, mouth around y=215-240.
  const MOUTH_CLOSED = 'M 178 215 Q 188 225 200 222 Q 212 225 222 215';
  const MOUTH_OPEN_SHAPE = 'M 176 213 Q 200 245 224 213 Q 215 235 200 236 Q 185 235 176 213 Z';
  const TONGUE_SHAPE = 'M 184 222 Q 200 240 216 222 Q 210 235 200 236 Q 190 235 184 222 Z';

  // ----- Biscuit avatar instances -----
  function mountBiscuit(containerId) {
    const tpl = document.getElementById('buddy-template');
    const node = tpl.content.cloneNode(true);
    const root = document.getElementById(containerId);
    if (!root) return null;
    root.innerHTML = '';
    root.appendChild(node);
    return root.querySelector('svg.buddy-svg');
  }

  const buddies = {
    picker: mountBiscuit('buddy-picker'),
    chat: mountBiscuit('buddy-chat'),
    robot: mountBiscuit('buddy-robot'),
    twenty_questions: mountBiscuit('buddy-twenty_questions'),
    story_time: mountBiscuit('buddy-story_time'),
    curiosity: mountBiscuit('buddy-curiosity'),
    dance: mountBiscuit('buddy-dance'),
    notebook: mountBiscuit('buddy-notebook'),
    photobooth: mountBiscuit('buddy-photobooth'),
  };

  function setMouth(buddy, open) {
    if (!buddy) return;
    const path = buddy.querySelector('.mouth-path');
    const tongue = buddy.querySelector('.mouth-tongue');
    if (open) {
      path.setAttribute('d', MOUTH_OPEN_SHAPE);
      path.setAttribute('fill', '#1a1a1a');
      tongue.setAttribute('d', TONGUE_SHAPE);
      tongue.setAttribute('opacity', '1');
    } else {
      path.setAttribute('d', MOUTH_CLOSED);
      path.setAttribute('fill', 'none');
      tongue.setAttribute('opacity', '0');
    }
  }

  function setSpeaking(buddy, speaking) {
    if (!buddy) return;
    buddy.classList.toggle('speaking', speaking);
  }

  // ----- View routing -----
  const views = document.querySelectorAll('.view');
  function showView(id) {
    views.forEach(v => v.classList.toggle('active', v.id === id));
    document.dispatchEvent(new CustomEvent('viewchange', { detail: { id } }));
    // Walk-in animation: when entering a view, the visible Biscuit walks in.
    requestAnimationFrame(() => {
      const view = document.getElementById(id);
      if (!view) return;
      const svg = view.querySelector('.buddy-svg');
      if (!svg) return;
      svg.classList.remove('walking-in');
      void svg.offsetWidth;
      svg.classList.add('walking-in');
    });
  }

  // ----- TRICKS -----
  const TRICKS = ['sit', 'jump', 'spin', 'wiggle', 'rollover', 'laydown',
                  'shake', 'beg', 'playdead', 'speak'];
  const TRICK_DURATIONS = {
    sit: 1400, jump: 900, spin: 1100, wiggle: 900, rollover: 1400, laydown: 1600,
    shake: 1200, beg: 1600, playdead: 2000, speak: 1000,
  };

  function performTrick(buddy, trick) {
    if (!buddy) return;
    if (!trick) trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
    // Don't stack tricks
    for (const t of TRICKS) buddy.classList.remove('trick-' + t);
    void buddy.offsetWidth;
    buddy.classList.add('trick-' + trick);
    const dur = TRICK_DURATIONS[trick] || 1200;
    setTimeout(() => buddy.classList.remove('trick-' + trick), dur + 50);
  }

  // Click on Biscuit himself = trick on demand
  document.addEventListener('click', (e) => {
    const svg = e.target.closest('.buddy-svg');
    if (!svg) return;
    if (svg.classList.contains('thinking')) return;  // don't interrupt thinking
    if (svg.classList.contains('speaking')) return;  // don't interrupt speech
    performTrick(svg);
  });

  // ----- VOICE/TEXT TRICK COMMANDS -----
  // If Nick says/types a trick word ("sit", "jump", "spin"...), short-circuit
  // the AI roundtrip and just perform the trick. Plays a bark for fun.
  const TRICK_TRIGGERS = {
    'sit': 'sit', 'sit down': 'sit', 'good sit': 'sit',
    'jump': 'jump', 'jump up': 'jump',
    'spin': 'spin', 'spin around': 'spin', 'twirl': 'spin',
    'wiggle': 'wiggle', 'wiggle butt': 'wiggle',
    'roll over': 'rollover', 'rollover': 'rollover',
    'lay down': 'laydown', 'lie down': 'laydown', 'lay': 'laydown', 'down': 'laydown',
    'dance': 'wiggle',
    'shake': 'shake', 'shake hand': 'shake', 'shake paw': 'shake', 'paw': 'shake',
    'beg': 'beg', 'sit pretty': 'beg',
    'play dead': 'playdead', 'playdead': 'playdead', 'bang': 'playdead',
    'speak': 'speak', 'bark': 'speak', 'howl': 'speak', 'sing': 'speak',
    'hide': 'hide', 'hide and seek': 'hide', 'hide-and-seek': 'hide', 'hide and go seek': 'hide',
    'go hide': 'hide',
  };
  const TRICK_VERBS = {
    sit: 'Biscuit sits',
    jump: 'Biscuit jumps',
    spin: 'Biscuit spins',
    wiggle: 'Biscuit wiggles',
    rollover: 'Biscuit rolls over',
    laydown: 'Biscuit lies down',
    shake: 'Biscuit shakes!',
    beg: 'Biscuit begs',
    playdead: 'Biscuit plays dead!',
    speak: 'Biscuit speaks!',
    hide: 'Biscuit hides! Find him!',
  };

  function tryTrickCommand(text, buddy, statusEl) {
    if (!text) return false;
    let lower = text.toLowerCase().trim();
    // Strip trailing punctuation
    lower = lower.replace(/[.!?,]+$/, '');
    // Strip "(hey/hi/please) biscuit(,)" prefix
    lower = lower.replace(/^(hey |hi |please )?biscuit[,!.]?\s*/i, '');
    lower = lower.replace(/^please[,!.]?\s+/i, '');
    lower = lower.trim();

    const trick = TRICK_TRIGGERS[lower];
    if (!trick) return false;

    if (trick === 'hide') {
      startHideAndSeek(buddy);
    } else if (trick === 'speak') {
      // Trigger the head-tilt animation AND play multiple barks
      performTrick(buddy, 'speak');
      for (let i = 0; i < 3; i++) playBark({ delay: i * 0.22 });
    } else {
      performTrick(buddy, trick);
      playBark();
    }
    if (statusEl) {
      statusEl.textContent = `🐾 ${TRICK_VERBS[trick]}`;
      setTimeout(() => { if (statusEl.textContent.startsWith('🐾')) statusEl.textContent = ''; }, 1800);
    }
    return true;
  }

  // ----- HIDE AND SEEK -----
  let _hideState = null;

  function startHideAndSeek(buddy) {
    if (!buddy) return;
    if (_hideState) return;  // already hiding

    // Hide Biscuit
    buddy.classList.remove('coming-back');
    buddy.classList.add('hiding');

    // Show banner
    const banner = document.createElement('div');
    banner.className = 'hide-banner';
    banner.textContent = '🔍 Biscuit is hiding! Find the peek and tap it!';
    document.body.appendChild(banner);

    // Spawn peek emoji at a random screen edge after a short delay
    const peekDelay = 1100 + Math.random() * 1200;
    const giveUpAt = peekDelay + 9000;
    let peek = null;

    const peekTimeout = setTimeout(() => {
      const corners = [
        { left: 'auto', right: '8px', top: 'auto', bottom: '20vh' },
        { left: '8px', right: 'auto', top: 'auto', bottom: '30vh' },
        { left: 'auto', right: '5vw', top: '90px', bottom: 'auto' },
        { left: '12vw', right: 'auto', top: '95px', bottom: 'auto' },
      ];
      const pick = corners[Math.floor(Math.random() * corners.length)];
      peek = document.createElement('div');
      peek.className = 'hide-peek';
      peek.textContent = ['👀', '🐾', '👂', '🐶'][Math.floor(Math.random() * 4)];
      Object.assign(peek.style, pick);
      peek.addEventListener('click', () => endHideAndSeek(buddy, true));
      document.body.appendChild(peek);
    }, peekDelay);

    const giveUpTimeout = setTimeout(() => endHideAndSeek(buddy, false), giveUpAt);

    _hideState = { buddy, banner, peek, peekTimeout, giveUpTimeout, getPeek: () => peek };
  }

  function endHideAndSeek(buddy, found) {
    if (!_hideState) return;
    clearTimeout(_hideState.peekTimeout);
    clearTimeout(_hideState.giveUpTimeout);
    _hideState.banner?.remove();
    const peek = _hideState.getPeek?.();
    if (peek) peek.remove();
    _hideState = null;

    buddy.classList.remove('hiding');
    buddy.classList.add('coming-back');
    setTimeout(() => buddy.classList.remove('coming-back'), 750);

    // Celebrate + bark
    if (found) {
      setTimeout(() => {
        for (let i = 0; i < 2; i++) playBark({ delay: i * 0.18 });
        performTrick(buddy, 'wiggle');
      }, 450);
      const banner = document.createElement('div');
      banner.className = 'hide-banner';
      banner.textContent = '🎉 You found Biscuit!';
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 2200);
    } else {
      const banner = document.createElement('div');
      banner.className = 'hide-banner';
      banner.textContent = "🐶 Biscuit got lonely and came back!";
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 2200);
    }
  }

  // ----- CURSOR TRACKING -----
  // Eyes follow the cursor via CSS variables (composes with the blink keyframe).
  let _lastEyeUpdate = 0;
  document.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - _lastEyeUpdate < 33) return;  // throttle to ~30fps
    _lastEyeUpdate = now;

    const view = document.querySelector('.view.active');
    if (!view) return;
    const svg = view.querySelector('.buddy-svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));

    // Eye-pupil offsets in SVG coords (viewBox 0-400). Small range so eyes
    // don't pop out of the head.
    const maxDx = 4, maxDy = 3;
    svg.style.setProperty('--eye-x', `${(dx * maxDx).toFixed(2)}px`);
    svg.style.setProperty('--eye-y', `${(dy * maxDy).toFixed(2)}px`);
    // The CSS variable lives on each .eye, but we set on the SVG and let
    // it inherit. Set explicitly on each eye too in case inheritance
    // doesn't pick up via the keyframe re-bind:
    svg.querySelectorAll('.eye').forEach(eye => {
      eye.style.setProperty('--eye-x', `${(dx * maxDx).toFixed(2)}px`);
      eye.style.setProperty('--eye-y', `${(dy * maxDy).toFixed(2)}px`);
    });
  });

  // ============================================================
  // EASTER EGGS — surprises throughout the app for an 8-year-old
  // ============================================================

  // 1) NOSE BOOP — click Biscuit's nose 5 times rapid → bonus barks + flash
  let _noseBoops = 0;
  let _noseBoopTimer = null;
  document.addEventListener('click', (e) => {
    const nose = e.target.closest('.nose');
    if (!nose) return;
    nose.classList.remove('booped');
    void nose.offsetWidth;
    nose.classList.add('booped');
    setTimeout(() => nose.classList.remove('booped'), 500);
    playBark();
    _noseBoops++;
    clearTimeout(_noseBoopTimer);
    _noseBoopTimer = setTimeout(() => { _noseBoops = 0; }, 2500);
    if (_noseBoops >= 5) {
      _noseBoops = 0;
      // Boop reward: spin trick + a confetti shower
      const buddy = nose.closest('.buddy-svg');
      if (buddy) performTrick(buddy, 'spin');
      launchConfetti();
    }
  });

  // 2) COLLAR TAG — click the "B" tag → mini stats flash
  document.addEventListener('click', async (e) => {
    const tag = e.target.closest('.collar text');
    if (!tag) return;
    const mem = await callApi('get_memory');
    if (!mem) return;
    const stats = mem.stats || {};
    const banner = document.createElement('div');
    banner.className = 'hide-banner';
    banner.style.background = '#FBBF24';
    banner.innerHTML = `🦴 You and Biscuit have played <strong>${stats.total_sessions || 0}</strong> times,
      sent <strong>${stats.total_messages || 0}</strong> messages,
      and snapped <strong>${stats.photos_taken || 0}</strong> photos!`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  });

  // 3) MAGIC WORDS in any text input — typing certain words triggers effects
  function checkMagicWord(text) {
    if (!text) return false;
    const lower = text.toLowerCase().trim().replace(/[!.?,]+$/, '');

    // Rainbow background flash
    if (/\b(rainbow|skittles)\b/.test(lower)) {
      document.body.classList.remove('rainbow-mode');
      void document.body.offsetWidth;
      document.body.classList.add('rainbow-mode');
      setTimeout(() => document.body.classList.remove('rainbow-mode'), 4500);
      return true;
    }
    // Dream mode: floating Z's
    if (/\b(pizza|bacon|treat|treats|snack|cookie|donut|donuts)\b/.test(lower)) {
      launchDreamZs();
      return true;
    }
    // Fart joke (kids love them)
    if (/\b(fart|farts|toot|burp|burps|stinky)\b/.test(lower)) {
      // Triple bark + wiggle (closest stand-in for an 8yo-friendly comedy reaction)
      for (let i = 0; i < 3; i++) playBark({ delay: i * 0.12 });
      const view = document.querySelector('.view.active');
      const svg = view?.querySelector('.buddy-svg');
      if (svg) performTrick(svg, 'wiggle');
      flashBanner('💨 BISCUIT IS SHOCKED!');
      return true;
    }
    // Magic word
    if (/\b(abracadabra|alakazam|magic)\b/.test(lower)) {
      launchConfetti();
      flashBanner('✨ Magic! ✨');
      return true;
    }
    return false;
  }

  function flashBanner(text) {
    const banner = document.createElement('div');
    banner.className = 'hide-banner';
    banner.textContent = text;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2400);
  }

  function launchConfetti(n = 60) {
    const colors = ['#FBBF24', '#3B82F6', '#22C55E', '#E66D7A', '#A855F7', '#F97316'];
    for (let i = 0; i < n; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.4) + 's';
      piece.style.animationDuration = (1.8 + Math.random() * 1.2) + 's';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3500);
    }
  }

  function launchDreamZs() {
    const view = document.querySelector('.view.active');
    const svg = view?.querySelector('.buddy-svg');
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    for (let i = 0; i < 6; i++) {
      const z = document.createElement('div');
      z.className = 'dream-z';
      z.textContent = ['💤', 'Z', 'Z', '💭'][Math.floor(Math.random() * 4)];
      z.style.left = (rect.left + rect.width * 0.5 + (Math.random() - 0.5) * 80) + 'px';
      z.style.top = (rect.top + rect.height * 0.2) + 'px';
      z.style.animationDelay = (i * 0.2) + 's';
      document.body.appendChild(z);
      setTimeout(() => z.remove(), 3500);
    }
  }

  // 4) KONAMI CODE → super spin + confetti
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let _konamiPos = 0;
  document.addEventListener('keydown', (e) => {
    const expected = KONAMI[_konamiPos];
    const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (got === expected.toLowerCase()) {
      _konamiPos++;
      if (_konamiPos === KONAMI.length) {
        _konamiPos = 0;
        flashBanner('🎮 SUPER BISCUIT MODE! 🎮');
        launchConfetti(120);
        const view = document.querySelector('.view.active');
        const svg = view?.querySelector('.buddy-svg');
        if (svg) {
          performTrick(svg, 'spin');
          setTimeout(() => performTrick(svg, 'jump'), 1100);
          setTimeout(() => performTrick(svg, 'wiggle'), 2000);
        }
        for (let i = 0; i < 4; i++) playBark({ delay: i * 0.2 });
      }
    } else {
      _konamiPos = 0;
    }
  });

  // Wire magic words into all text inputs (chat, story, curiosity, 20Q, robot)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target;
    if (!target || target.tagName !== 'INPUT' || target.type !== 'text') return;
    // Magic word doesn't suppress the actual chat — just adds the effect
    checkMagicWord(target.value);
  });

  // ============================================================

  // Random idle tricks every 22-40 seconds while the app is open
  setInterval(() => {
    const view = document.querySelector('.view.active');
    if (!view) return;
    const svg = view.querySelector('.buddy-svg');
    if (!svg) return;
    if (svg.classList.contains('thinking')) return;
    if (svg.classList.contains('speaking')) return;
    if (svg.classList.contains('listening')) return;
    // Skip if any trick is currently in progress
    if (TRICKS.some(t => svg.classList.contains('trick-' + t))) return;
    performTrick(svg);
  }, 28000);

  // Use document-level delegation so handlers can't be missed by timing or
  // re-renders. Keep the per-element listeners as a belt-and-suspenders backup.
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('.skill-tile');
    if (tile) {
      const skill = tile.dataset.skill;
      console.log('[buddy] tile click:', skill);
      switch (skill) {
        case 'chat':              showView('view-chat'); break;
        case 'twenty_questions':  showView('view-twenty_questions'); break;
        case 'story_time':        showView('view-story_time'); break;
        case 'curiosity':         showView('view-curiosity'); break;
        case 'robot':             showView('view-robot'); refreshPorts(); break;
        case 'dance':             showView('view-dance'); break;
        case 'notebook':          showView('view-notebook'); loadNotebook(); break;
        case 'photobooth':        showView('view-photobooth'); openPhotobooth(); break;
      }
      return;
    }
    const backBtn = e.target.closest('.back-btn');
    if (backBtn) {
      console.log('[buddy] back click');
      stopSpeaking();
      showView('view-picker');
      return;
    }
  });

  // ----- Bark sound synthesis (Web Audio API) -----
  // We don't bundle audio files. A bark is short enough that we can
  // synthesize a believable one with an oscillator + filtered noise burst.
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[buddy] Web Audio not available:', e);
        return null;
      }
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
    return _audioCtx;
  }

  // Bark variations — each is a different "voice" of a bark. We pick one
  // at random per call so successive barks don't sound identical.
  const BARK_VARIATIONS = [
    // Standard bark — mid-pitched, classic
    { startFreq: [310, 360], endFreq: 170, dur: 0.30, q: 1.3,
      formant1: [880, 480], formant2: [1850, 1200], gain: 0.55, noiseGain: 0.32 },
    // Sharp/excited — higher pitch, faster decay
    { startFreq: [380, 460], endFreq: 230, dur: 0.22, q: 1.6,
      formant1: [1100, 600], formant2: [2400, 1500], gain: 0.52, noiseGain: 0.28 },
    // Low woof — bigger dog feel, slower
    { startFreq: [190, 240], endFreq: 110, dur: 0.42, q: 0.9,
      formant1: [620, 340], formant2: [1300, 850], gain: 0.62, noiseGain: 0.40 },
    // Tiny yip — quick high
    { startFreq: [520, 600], endFreq: 380, dur: 0.16, q: 1.8,
      formant1: [1450, 850], formant2: [2900, 1900], gain: 0.45, noiseGain: 0.22 },
  ];

  function playBark(opts) {
    opts = opts || {};
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + (opts.delay || 0);
    const variation = opts.variation || BARK_VARIATIONS[Math.floor(Math.random() * BARK_VARIATIONS.length)];

    const dur = variation.dur * (0.92 + Math.random() * 0.16);
    const startFreq = variation.startFreq[0] + Math.random() * (variation.startFreq[1] - variation.startFreq[0]);
    const endFreq = variation.endFreq;

    // ---- Voiced source: stack of sawtooth oscillators (richer harmonics) ----
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(startFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
    osc2.frequency.setValueAtTime(startFreq * 0.5, now);
    osc2.frequency.exponentialRampToValueAtTime(endFreq * 0.5, now + dur);

    // ---- Noise source: gives breathiness and a chesty rasp ----
    const sr = ctx.sampleRate;
    const noiseBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const noiseData = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < noiseData.length; i++) {
      // 1-pole lowpass for pink-ish noise (more body than white)
      const w = Math.random() * 2 - 1;
      last = last * 0.78 + w * 0.22;
      noiseData[i] = last;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // ---- Two bandpass filters in parallel — formants F1 (chest/throat) and F2 (mouth) ----
    function makeFormant(centerStart, centerEnd, q) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(centerStart, now);
      f.frequency.exponentialRampToValueAtTime(centerEnd, now + dur);
      return f;
    }
    const f1 = makeFormant(variation.formant1[0], variation.formant1[1], variation.q + 0.4);
    const f2 = makeFormant(variation.formant2[0], variation.formant2[1], variation.q);

    const f1Gain = ctx.createGain();  f1Gain.gain.value = 1.0;
    const f2Gain = ctx.createGain();  f2Gain.gain.value = 0.55;

    // ---- Master envelope ----
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(variation.gain, now + 0.014);
    env.gain.setValueAtTime(variation.gain, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // ---- Wire it up: oscillators + noise -> formants -> env -> destination ----
    const oscMix = ctx.createGain();   oscMix.gain.value = 0.65;
    const noiseMix = ctx.createGain(); noiseMix.gain.value = variation.noiseGain;

    osc1.connect(oscMix);
    osc2.connect(oscMix);
    oscMix.connect(f1);
    oscMix.connect(f2);
    noise.connect(noiseMix);
    noiseMix.connect(f1);
    noiseMix.connect(f2);
    f1.connect(f1Gain).connect(env);
    f2.connect(f2Gain).connect(env);
    env.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    noise.start(now);
    osc1.stop(now + dur + 0.05);
    osc2.stop(now + dur + 0.05);
    noise.stop(now + dur + 0.05);
  }

  function detectDogNoises(text) {
    return /\b(woo+f+|ruf+f*|bar+k|ar+f|yi+p|yap+|grr+r*)/i.test(text || '');
  }

  // Bundled barks: real audio files generated via ElevenLabs SFX API. If the
  // assets/sounds/ folder has them, we play those instead of synthesizing.
  // Loaded once at boot; cached as Audio elements for instant playback.
  let _bundledBarks = [];
  async function preloadBundledBarks() {
    try {
      const result = await callApi('list_bark_sounds');
      if (result && result.ok && result.sounds && result.sounds.length) {
        _bundledBarks = result.sounds.map(s => ({ name: s.name, dataUrl: s.data_url }));
        console.log(`[buddy] preloaded ${_bundledBarks.length} real bark samples`);
      }
    } catch (e) { /* fall back to synth */ }
  }

  function playBundledBark(opts) {
    if (!_bundledBarks.length) return false;
    opts = opts || {};
    const pick = _bundledBarks[Math.floor(Math.random() * _bundledBarks.length)];
    const audio = new Audio(pick.dataUrl);
    audio.volume = 0.85;
    if (opts.delay && opts.delay > 0) {
      setTimeout(() => audio.play().catch(() => {}), opts.delay * 1000);
    } else {
      audio.play().catch(() => {});
    }
    return true;
  }

  function playBarksForText(text) {
    if (!text) return;
    const matches = text.match(/\b(woo+f+|ruf+f*|bar+k|ar+f|yi+p|yap+|grr+r*)/gi) || [];
    const count = Math.min(matches.length || 0, 3);
    for (let i = 0; i < count; i++) {
      // Real audio if available, synth otherwise. Same path either way.
      if (!playBundledBark({ delay: i * 0.28 })) {
        playBark({ delay: i * 0.28 });
      }
    }
  }

  // ----- Speech synthesis (Biscuit talking) -----
  // Two paths:
  //   1. ElevenLabs (when ELEVENLABS_API_KEY is set on the backend) — high
  //      quality, character-shaped voice. Audio comes back as a data URL,
  //      played via HTMLAudioElement. This is the production path.
  //   2. Web Speech (fallback) — browser SpeechSynthesis. Free, works
  //      offline, but generic-sounding. Used when no key or on API errors.
  // Mouth sync is identical in both paths via startMouthSync/stopMouthSync.
  let currentUtterance = null;
  let currentAudio = null;
  let mouthInterval = null;
  let elevenReady = false;            // mirrors backend get_status().eleven_ready
  let _activeBuddyForMouth = null;

  // Voice selection priority: Microsoft "Online (Natural)" neural voices sound
  // dramatically better than the legacy ones. Aria/Jenny/Sara are warm, kid-
  // friendly female voices. Ana is specifically tagged for kids.
  // User-selected voice (persisted in localStorage) overrides the tier ranking.
  const SAVED_VOICE_KEY = 'buddy.voice.name';            // Web Speech voice name
  const SAVED_ELEVEN_VOICE_KEY = 'buddy.eleven.voice.id'; // ElevenLabs voice id

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    const saved = localStorage.getItem(SAVED_VOICE_KEY);
    if (saved) {
      const found = voices.find(v => v.name === saved);
      if (found) return found;
    }
    const tiers = [
      // Tier 1: Azure neural voices — best quality, internet required
      v => /Microsoft\s+(Ana|Aria|Jenny|Sara)\s+Online/i.test(v.name),
      // Tier 2: any Microsoft "Online (Natural)" voice
      v => /Microsoft.*Online.*Natural/i.test(v.name),
      // Tier 3: any female English voice
      v => v.lang && v.lang.startsWith('en') && /female|zira|hazel|samantha|aria|jenny/i.test(v.name),
      // Tier 4: any English voice
      v => v.lang && v.lang.startsWith('en'),
    ];
    for (const matcher of tiers) {
      const found = voices.find(matcher);
      if (found) return found;
    }
    return voices[0];
  }

  // Strip non-speech text (dog noises, asterisk actions, emojis) before TTS.
  // The text in the bubble keeps them — Nick still SEES the puppy energy.
  function cleanForTTS(text) {
    if (!text) return '';
    let t = text;
    // *...* asterisk-wrapped actions like "*wags tail*" or "*tilts head*"
    t = t.replace(/\*[^*]+\*/g, ' ');
    // _..._ underscore actions (rarer but possible)
    t = t.replace(/_[^_]+_/g, ' ');
    // Standalone dog noises with optional repetition and punctuation
    t = t.replace(/\b(woo+f+|ruf+|bar+k|ar+f|yi+p|yap+|grr+|grrr+)+[!.?]*/gi, ' ');
    // Strip emojis (Unicode emoji ranges + variation selectors)
    t = t.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]/gu, '');
    // Collapse whitespace and clean up dangling punctuation
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/\s+([.!?,])/g, '$1');
    t = t.replace(/^[\s.,!?]+/, '').replace(/[\s.,!?]+$/, m => m.trim() ? m : '');
    return t.trim();
  }

  function startMouthSync(buddy) {
    _activeBuddyForMouth = buddy;
    setSpeaking(buddy, true);
    let open = false;
    if (mouthInterval) clearInterval(mouthInterval);
    mouthInterval = setInterval(() => {
      open = !open;
      setMouth(buddy, open);
    }, 130);
  }

  function stopMouthSync() {
    if (mouthInterval) { clearInterval(mouthInterval); mouthInterval = null; }
    if (_activeBuddyForMouth) {
      setMouth(_activeBuddyForMouth, false);
      setSpeaking(_activeBuddyForMouth, false);
      _activeBuddyForMouth = null;
    } else {
      Object.values(buddies).forEach(b => { setMouth(b, false); setSpeaking(b, false); });
    }
  }

  async function speak(text, buddy) {
    stopSpeaking();
    if (!text) return;
    // Real bark audio for any "woof"/"ruff"/"bark" tokens, regardless of
    // which TTS engine handles the rest.
    playBarksForText(text);
    const cleaned = cleanForTTS(text);
    if (!cleaned) return;

    // Prefer ElevenLabs when the key is configured on the backend.
    if (elevenReady) {
      try {
        const voiceId = localStorage.getItem(SAVED_ELEVEN_VOICE_KEY) || '';
        // with_timestamps=true gives us character-level alignment for real lip sync
        const result = await callApi('synthesize_speech', cleaned, voiceId, true);
        if (result && result.ok && !result.fallback && result.data_url) {
          await playElevenAudio(result.data_url, buddy, result.alignment);
          return;
        }
        if (result && result.fallback) {
          console.warn('[buddy] ElevenLabs fallback:', result.reason);
        }
      } catch (e) {
        console.warn('[buddy] ElevenLabs error, falling back:', e);
      }
    }

    // Fallback path: Web Speech API
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.voice = pickVoice();
    utter.pitch = 1.05;
    utter.rate = 0.95;
    utter.volume = 1.0;
    utter.onstart = () => startMouthSync(buddy);
    utter.onend = utter.onerror = () => stopMouthSync();
    currentUtterance = utter;
    window.speechSynthesis.speak(utter);
  }

  // Real lip-sync from ElevenLabs alignment data.
  // Mouth shapes by character class:
  //   open   = vowels + open consonants (a, e, i, o, u, w, h)
  //   closed = consonants and pauses
  // We sample at ~33 Hz (rAF on a throttle) and pick the active char by
  // currentTime, then set the mouth shape accordingly.
  const VOWEL_RE = /[aeiouwAEIOUW]/;

  function alignmentMouthAt(alignment, t) {
    if (!alignment || !alignment.character_start_times_seconds) return false;
    const starts = alignment.character_start_times_seconds;
    const ends = alignment.character_end_times_seconds;
    const chars = alignment.characters;
    if (!starts || !ends || !chars) return false;
    // Binary search for the active character at time t
    let lo = 0, hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < starts[mid]) hi = mid - 1;
      else if (t > ends[mid]) lo = mid + 1;
      else return VOWEL_RE.test(chars[mid] || '');
    }
    return false;
  }

  function playElevenAudio(dataUrl, buddy, alignment) {
    return new Promise((resolve) => {
      const audio = new Audio(dataUrl);
      currentAudio = audio;
      let rafId = null;

      function startSync() {
        setSpeaking(buddy, true);
        let lastShape = null;
        const tick = () => {
          if (!currentAudio || currentAudio !== audio) return;
          const open = alignmentMouthAt(alignment, audio.currentTime);
          if (open !== lastShape) {
            setMouth(buddy, open);
            lastShape = open;
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      }
      function stopSync() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        setMouth(buddy, false);
        setSpeaking(buddy, false);
      }

      audio.addEventListener('play', () => {
        if (alignment && alignment.character_start_times_seconds) {
          startSync();
        } else {
          // No alignment data — fall back to the timer-based toggle
          startMouthSync(buddy);
        }
      });
      const cleanup = () => {
        if (currentAudio === audio) currentAudio = null;
        if (rafId) cancelAnimationFrame(rafId);
        if (alignment && alignment.character_start_times_seconds) {
          stopSync();
        } else {
          stopMouthSync();
        }
        resolve();
      };
      audio.addEventListener('ended', cleanup);
      audio.addEventListener('error', cleanup);
      audio.play().catch((e) => {
        console.warn('[buddy] audio.play failed:', e);
        cleanup();
      });
    });
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) { /* ignore */ }
      currentAudio = null;
    }
    stopMouthSync();
    currentUtterance = null;
  }

  // Voices may load async on some browsers; pre-warm.
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
    window.speechSynthesis.getVoices();
  }

  // ----- Settings modal (voice picker) -----
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const voiceSelect = document.getElementById('voice-select');
  const voiceTestBtn = document.getElementById('voice-test');
  const settingsCloseBtn = document.getElementById('settings-close');

  async function refreshVoiceList() {
    voiceSelect.innerHTML = '';

    if (elevenReady) {
      // Premium path: ElevenLabs voices
      const result = await callApi('list_eleven_voices');
      const voices = (result && result.ok && result.voices) || [];
      const current = localStorage.getItem(SAVED_ELEVEN_VOICE_KEY) || '';
      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `🎙 ${v.name} — ${v.blurb || ''}`;
        if (v.id === current) opt.selected = true;
        voiceSelect.appendChild(opt);
      });
      // Mark the select so submit-handlers know which key to write
      voiceSelect.dataset.mode = 'eleven';
      return;
    }

    // Fallback path: system Web Speech voices
    const voices = window.speechSynthesis.getVoices()
      .filter(v => v.lang && v.lang.startsWith('en'))
      .sort((a, b) => {
        const aOnline = /Online|Natural/i.test(a.name) ? 0 : 1;
        const bOnline = /Online|Natural/i.test(b.name) ? 0 : 1;
        if (aOnline !== bOnline) return aOnline - bOnline;
        return a.name.localeCompare(b.name);
      });
    const current = pickVoice();
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      const tag = /Online|Natural/i.test(v.name) ? '✨ ' : '   ';
      opt.textContent = tag + v.name;
      if (current && v.name === current.name) opt.selected = true;
      voiceSelect.appendChild(opt);
    });
    voiceSelect.dataset.mode = 'web';
  }

  settingsBtn.addEventListener('click', () => {
    refreshVoiceList();
    refreshDiagnostics();
    settingsModal.classList.remove('hidden');
  });

  async function refreshDiagnostics() {
    const body = document.getElementById('diagnostics-body');
    if (!body) return;
    body.textContent = 'loading...';
    const info = await callApi('get_version_info');
    if (!info) { body.textContent = '(unavailable)'; return; }

    const yesno = (b) => b ? '<span class="diag-val ok">yes</span>' : '<span class="diag-val bad">NO</span>';
    const val = (v) => `<span class="diag-val">${String(v).replace(/[<>&]/g, '')}</span>`;
    const row = (k, v) => `<div class="diag-row"><span class="diag-key">${k}</span>${v}</div>`;

    body.innerHTML = [
      row('build commit', val(info.commit + (info.branch ? ` (${info.branch})` : ''))),
      row('JS bundle ver', val(window.BUDDY_VERSION || '?')),
      row('python', val(info.python)),
      row('anthropic ready', yesno(info.anthropic_ready)),
      row('anthropic SDK', val(info.anthropic_version)),
      row('ElevenLabs key', yesno(info.eleven_ready)),
      row('Whisper installed', yesno(info.whisper_installed)),
      row('Whisper loaded', yesno(info.whisper_loaded)),
      info.whisper_error ? row('Whisper error', `<span class="diag-val bad">${info.whisper_error}</span>`) : '',
      row('Mic (PyAudio)', yesno(info.voice_pyaudio)),
      row('bundled barks', val(info.bundled_barks + ' files')),
    ].join('');
  }

  function persistVoiceChoice(value) {
    if (!value) return;
    if (voiceSelect.dataset.mode === 'eleven') {
      localStorage.setItem(SAVED_ELEVEN_VOICE_KEY, value);
      callApi('update_preferences', { eleven_voice_id: value });
    } else {
      localStorage.setItem(SAVED_VOICE_KEY, value);
      callApi('update_preferences', { voice_name: value });
    }
  }

  settingsCloseBtn.addEventListener('click', () => {
    persistVoiceChoice(voiceSelect.value);
    settingsModal.classList.add('hidden');
  });

  voiceTestBtn.addEventListener('click', () => {
    persistVoiceChoice(voiceSelect.value);
    const target = buddies.chat || buddies.picker;
    speak("Woof woof! Hi Nick, it's me Biscuit! Wanna play?", target);
  });

  // Click outside the modal content closes it
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      persistVoiceChoice(voiceSelect.value);
      settingsModal.classList.add('hidden');
    }
  });

  // ----- Speech recognition (Nick talking) -----
  // We can NOT use window.SpeechRecognition here — WebView2 (which pywebview
  // uses on Windows) doesn't enable the API even though it exists. Instead,
  // we call the Python backend's listen() which records with PyAudio and
  // transcribes with Google's free recognition endpoint.
  let voiceAvailable = false;
  let voiceListening = false;

  function attachMic(micBtn, input, statusEl, onFinal, buddy) {
    if (!voiceAvailable) {
      micBtn.disabled = true;
      micBtn.title = 'Voice not supported on this device — use the keyboard';
      micBtn.style.opacity = '0.4';
      return;
    }

    // Local listening state — each mic gets its own.
    let listening = false;

    micBtn.addEventListener('click', async () => {
      if (!listening) {
        // ---- START ----
        // Flip UI state IMMEDIATELY so click feels instant.
        listening = true;
        stopSpeaking();
        micBtn.classList.add('listening');
        if (buddy) {
          buddy.classList.remove('listening');
          void buddy.offsetWidth;
          buddy.classList.add('listening');
        }
        if (statusEl) statusEl.textContent = '🎤 Listening... press the mic again when you\'re done!';

        const result = await callApi('start_listening');
        if (!result || !result.ok) {
          // Roll back the UI state if backend refused
          listening = false;
          micBtn.classList.remove('listening');
          if (statusEl) statusEl.textContent = (result && result.error) || 'Voice unavailable';
        }
      } else {
        // ---- STOP ----
        // Flip UI state IMMEDIATELY so the second click feels instant too.
        listening = false;
        micBtn.classList.remove('listening');
        if (statusEl) statusEl.textContent = '✏️ Writing it down...';

        let result;
        try {
          result = await callApi('stop_listening');
        } catch (e) {
          result = { ok: false, error: String(e) };
        }

        if (result && result.ok && result.text) {
          input.value = result.text;
          if (statusEl) statusEl.textContent = '';
          if (onFinal) onFinal(result.text);
        } else {
          if (statusEl) statusEl.textContent = (result && result.error) || 'Try again?';
        }
      }
    });
  }

  // ----- Python bridge helpers -----
  function api() {
    return (window.pywebview && window.pywebview.api) || null;
  }

  async function callApi(name, ...args) {
    const a = api();
    if (!a || !a[name]) {
      return { ok: false, error: 'Backend not ready' };
    }
    try {
      return await a[name](...args);
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ----- Chat skill -----
  const chatLog = document.getElementById('chat-log');
  const chatInput = document.getElementById('chat-text');
  const chatSend = document.getElementById('chat-send');
  const chatMic = document.getElementById('chat-mic');
  const chatStatus = document.getElementById('chat-status');

  function appendBubble(who, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + who;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    // Short-circuit single-word trick commands (no AI roundtrip)
    if (tryTrickCommand(text, buddies.chat, chatStatus)) {
      chatInput.value = '';
      return;
    }
    chatInput.value = '';
    appendBubble('you', text);
    chatStatus.textContent = '🦴 Biscuit is thinking...';
    chatSend.disabled = true;
    if (buddies.chat) buddies.chat.classList.add('thinking');

    const result = await callApi('chat', text);
    chatSend.disabled = false;
    chatStatus.textContent = '';
    if (buddies.chat) buddies.chat.classList.remove('thinking');

    if (!result.ok) {
      appendBubble('buddy', '*tilts head* Biscuit got confused: ' + (result.error || 'unknown'));
      return;
    }
    appendBubble('buddy', result.text);
    speak(result.text, buddies.chat);
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  function setupMics() {
    attachMic(chatMic, chatInput, chatStatus, () => sendChat(), buddies.chat);
    attachMic(robotMic, robotInput, null, () => sendRobotCommand(), buddies.robot);
    // New chat-like skills use data-* attributes for their controls
    setupChatLikeSkill('twenty_questions');
    setupChatLikeSkill('story_time');
    setupChatLikeSkill('curiosity');
  }

  // Generic setup for chat-like skills (20 Questions, Story Time, Curiosity).
  // Each uses data-skill-* attributes to find its input/send/mic/log/status.
  const skillSetupCalled = new Set();
  function setupChatLikeSkill(skillId) {
    if (skillSetupCalled.has(skillId)) return;
    skillSetupCalled.add(skillId);

    const log = document.getElementById('log-' + skillId);
    const input = document.querySelector(`[data-skill-input="${skillId}"]`);
    const send = document.querySelector(`[data-skill-send="${skillId}"]`);
    const mic = document.querySelector(`[data-skill-mic="${skillId}"]`);
    const status = document.querySelector(`[data-skill-status="${skillId}"]`);
    const buddy = buddies[skillId];

    if (!log || !input || !send) {
      console.warn('[buddy] skill controls missing for', skillId);
      return;
    }

    function appendBubble(who, text) {
      const div = document.createElement('div');
      div.className = 'bubble ' + who;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    let firstMessageSent = false;

    async function sendMessage(text) {
      if (!text) text = input.value.trim();
      if (!text) return;
      // Short-circuit trick commands across all skill views
      if (tryTrickCommand(text, buddy, status)) {
        input.value = '';
        return;
      }
      input.value = '';
      appendBubble('you', text);
      status.textContent = '🦴 Biscuit is thinking...';
      send.disabled = true;
      if (buddy) buddy.classList.add('thinking');

      const result = await callApi(skillId, text);
      send.disabled = false;
      status.textContent = '';
      if (buddy) buddy.classList.remove('thinking');

      if (!result.ok) {
        appendBubble('buddy', '*tilts head* ' + (result.error || 'Biscuit got confused'));
        return;
      }
      appendBubble('buddy', result.text);
      speak(result.text, buddy);
      firstMessageSent = true;
    }

    send.addEventListener('click', () => sendMessage());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    if (mic) attachMic(mic, input, status, () => sendMessage(), buddy);

    // Auto-greet when entering this view for the first time. We skip
    // story_time because there Nick PROVIDES the topic — auto-sending "Hi"
    // would make Biscuit tell a story about saying hi.
    const skipAutoGreet = new Set(['story_time']);
    document.addEventListener('viewchange', (e) => {
      if (e.detail.id !== 'view-' + skillId) return;
      if (skipAutoGreet.has(skillId)) {
        // Show a one-time bubble with a hint so the screen isn't blank.
        if (log.children.length === 0) {
          appendBubble('buddy', "Tell me what you want a story about! I'll make it up. Try things like 'a flying pizza' or 'a soccer-playing dinosaur'.");
        }
        return;
      }
      if (!firstMessageSent && log.children.length === 0) {
        sendMessage("Hi Biscuit! Let's start.");
      }
    });
  }

  // Robot Dance wiring
  const danceGoBtn = document.getElementById('dance-go');
  const danceStopBtn = document.getElementById('dance-stop');
  const danceNarration = document.getElementById('dance-narration');
  const danceLog = document.getElementById('dance-log');
  window.onRobotLog = (line) => {
    // Reuse for both robot view AND dance view
    const time = new Date().toLocaleTimeString();
    if (danceLog) {
      danceLog.textContent += `[${time}] ${line}\n`;
      danceLog.scrollTop = danceLog.scrollHeight;
    }
    if (typeof robotLog !== 'undefined' && robotLog) {
      robotLog.textContent += `[${time}] ${line}\n`;
      robotLog.scrollTop = robotLog.scrollHeight;
    }
  };

  danceGoBtn?.addEventListener('click', async () => {
    danceNarration.textContent = '*excited puppy noises*';
    danceGoBtn.disabled = true;
    const result = await callApi('robot_dance');
    danceGoBtn.disabled = false;
    if (result.ok) {
      danceNarration.textContent = result.narration + ' (' + result.name + ')';
      speak(result.narration, buddies.dance);
    } else {
      danceNarration.textContent = result.error || 'Couldn\'t dance';
    }
  });

  danceStopBtn?.addEventListener('click', async () => {
    stopSpeaking();
    await callApi('emergency_stop');
    danceNarration.textContent = 'STOPPED';
  });

  // ----- Biscuit's Notebook -----
  const notebookForm = document.getElementById('notebook-form');
  const notebookSavedMsg = document.getElementById('notebook-saved-msg');
  const notebookStats = document.getElementById('notebook-stats');

  function formatRelativeDate(iso) {
    if (!iso) return 'never';
    try {
      const then = new Date(iso);
      const now = new Date();
      const diffSec = Math.max(0, (now - then) / 1000);
      if (diffSec < 60) return 'just now';
      if (diffSec < 3600) return `${Math.round(diffSec / 60)} minutes ago`;
      if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hours ago`;
      const days = Math.round(diffSec / 86400);
      return days === 1 ? 'yesterday' : `${days} days ago`;
    } catch (e) { return 'a while ago'; }
  }

  async function loadNotebook() {
    const memory = await callApi('get_memory');
    if (!memory || memory.ok === false) {
      console.warn('[buddy] could not load memory', memory);
      return;
    }
    const kid = memory.kid || {};
    const stats = memory.stats || {};
    for (const field of ['name', 'age', 'favorite_color', 'favorite_animal', 'favorite_food', 'loves']) {
      const input = notebookForm.elements[field];
      if (input) input.value = kid[field] || (field === 'age' ? 8 : '');
    }
    if (notebookStats) {
      const parts = [];
      parts.push(`<strong>Sessions played:</strong> ${stats.total_sessions || 0}`);
      parts.push(`<strong>Messages with Biscuit:</strong> ${stats.total_messages || 0}`);
      parts.push(`<strong>Robot drives:</strong> ${stats.robot_drives || 0}`);
      if (stats.first_session) parts.push(`<strong>First met:</strong> ${formatRelativeDate(stats.first_session)}`);
      notebookStats.innerHTML = parts.join(' &nbsp;·&nbsp; ');
    }
  }

  notebookForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(notebookForm);
    const kid = {};
    for (const [k, v] of formData.entries()) {
      kid[k] = (k === 'age') ? parseInt(v, 10) || 8 : String(v).trim();
    }
    const result = await callApi('update_memory', kid);
    if (result && result.ok) {
      notebookSavedMsg.textContent = '✅ Saved! Biscuit will remember.';
      notebookSavedMsg.style.opacity = 1;
      setTimeout(() => { notebookSavedMsg.style.opacity = 0; }, 2500);
      // Reset all skill histories so the next chat picks up the new memory
      // immediately (system prompts are rebuilt each turn so this isn't strictly
      // necessary, but it's a clean break).
      for (const skill of ['chat', 'twenty_questions', 'story_time', 'curiosity']) {
        callApi('reset_skill', skill);
      }
    } else {
      notebookSavedMsg.textContent = 'Could not save: ' + (result && result.error || 'unknown');
    }
  });

  // ----- PHOTO BOOTH -----
  let _videoStream = null;

  function getEl(id) { return document.getElementById(id); }

  async function openPhotobooth() {
    const video = getEl('photobooth-video');
    const status = getEl('photobooth-status');
    if (!video) return;

    if (_videoStream) {
      refreshGallery();
      return;
    }
    if (status) status.textContent = '📷 Starting camera... please allow access';
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = _videoStream;
      if (status) {
        status.textContent = 'Smile! Click SNAP! when ready.';
        setTimeout(() => { status.textContent = ''; }, 3500);
      }
    } catch (e) {
      if (status) status.textContent = '😢 Camera not available: ' + (e.message || 'permission denied');
    }
    refreshGallery();
  }

  function stopPhotobooth() {
    if (_videoStream) {
      _videoStream.getTracks().forEach(t => t.stop());
      _videoStream = null;
    }
    const video = getEl('photobooth-video');
    if (video) video.srcObject = null;
  }

  // Stop the camera stream when leaving the photo booth view
  document.addEventListener('viewchange', (e) => {
    if (e.detail.id !== 'view-photobooth') stopPhotobooth();
  });

  function svgToImage(svgEl) {
    return new Promise((resolve, reject) => {
      try {
        const cloned = svgEl.cloneNode(true);
        cloned.querySelectorAll('*').forEach(el => { el.style.animation = 'none'; });
        const xml = new XMLSerializer().serializeToString(cloned);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
        img.src = url;
      } catch (err) { reject(err); }
    });
  }

  async function captureFrame() {
    const video = getEl('photobooth-video');
    if (!video || !video.videoWidth) throw new Error('Camera not ready');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    // Mirror the video frame (selfie style)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // Composite Biscuit overlay in the bottom-right corner
    try {
      const svgEl = buddies.photobooth;
      if (svgEl) {
        const img = await svgToImage(svgEl);
        const overlayW = canvas.width * 0.28;
        const overlayH = overlayW;
        const margin = canvas.width * 0.03;
        ctx.drawImage(img, canvas.width - overlayW - margin, canvas.height - overlayH - margin, overlayW, overlayH);
      }
    } catch (err) {
      console.warn('[buddy] biscuit overlay failed:', err);
    }
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  const photoboothSnap = getEl('photobooth-snap');
  const photoboothFolder = getEl('photobooth-folder');
  const photoboothFlash = getEl('photobooth-flash');
  const photoboothPreview = getEl('photobooth-preview');
  const photoboothPreviewImg = getEl('photobooth-preview-img');
  const photoboothKeep = getEl('photobooth-keep');
  const photoboothDiscard = getEl('photobooth-discard');
  const photoboothGallery = getEl('photobooth-gallery');

  let _pendingDataUrl = null;

  photoboothSnap?.addEventListener('click', async () => {
    if (!_videoStream) {
      await openPhotobooth();
      return;
    }
    photoboothSnap.disabled = true;
    photoboothFlash?.classList.remove('snap');
    void photoboothFlash?.offsetWidth;
    photoboothFlash?.classList.add('snap');
    playBark();
    try {
      const dataUrl = await captureFrame();
      _pendingDataUrl = dataUrl;
      if (photoboothPreviewImg) photoboothPreviewImg.src = dataUrl;
      photoboothPreview?.classList.remove('hidden');
    } catch (err) {
      const status = getEl('photobooth-status');
      if (status) status.textContent = 'Capture failed: ' + (err.message || err);
    } finally {
      photoboothSnap.disabled = false;
    }
  });

  photoboothKeep?.addEventListener('click', async () => {
    if (!_pendingDataUrl) return;
    photoboothKeep.disabled = true;
    const result = await callApi('save_photo', _pendingDataUrl);
    photoboothKeep.disabled = false;
    if (result && result.ok) {
      const status = getEl('photobooth-status');
      if (status) {
        status.textContent = '✅ Saved!';
        setTimeout(() => { status.textContent = ''; }, 2500);
      }
      _pendingDataUrl = null;
      photoboothPreview?.classList.add('hidden');
      refreshGallery();
    } else {
      alert('Save failed: ' + (result && result.error || 'unknown'));
    }
  });

  photoboothDiscard?.addEventListener('click', () => {
    _pendingDataUrl = null;
    photoboothPreview?.classList.add('hidden');
  });

  photoboothFolder?.addEventListener('click', () => callApi('open_photos_folder'));

  async function refreshGallery() {
    if (!photoboothGallery) return;
    const result = await callApi('list_photos');
    photoboothGallery.innerHTML = '';
    if (!result || !result.ok || !result.photos || result.photos.length === 0) {
      photoboothGallery.innerHTML = '<div class="empty">No photos yet. Hit SNAP! to take your first one with Biscuit.</div>';
      return;
    }
    for (const p of result.photos) {
      const img = document.createElement('img');
      img.src = p.data_url;
      img.alt = p.filename;
      img.title = p.filename;
      photoboothGallery.appendChild(img);
    }
  }

  // ----- Robot skill -----
  const robotLog = document.getElementById('robot-log');
  const robotInput = document.getElementById('robot-text');
  const robotSend = document.getElementById('robot-send');
  const robotMic = document.getElementById('robot-mic');
  const robotStop = document.getElementById('robot-stop');
  const robotNarration = document.getElementById('robot-narration');
  const portSelect = document.getElementById('robot-port-select');
  const connectBtn = document.getElementById('robot-connect-btn');
  const refreshBtn = document.getElementById('robot-refresh-btn');
  const statusDot = document.getElementById('robot-status-dot');
  const statusText = document.getElementById('robot-status-text');

  function logToRobotPanel(line) {
    const time = new Date().toLocaleTimeString();
    robotLog.textContent += `[${time}] ${line}\n`;
    robotLog.scrollTop = robotLog.scrollHeight;
  }

  // window.onRobotLog is set up earlier in the dance-wiring section so it
  // fans out to BOTH the dance log and the robot log. Don't overwrite it here.
  window.onRobotDone = () => { robotNarration.textContent = robotNarration.textContent + ' ✅'; };

  async function refreshPorts() {
    const ports = await callApi('list_ports');
    portSelect.innerHTML = '';
    if (!Array.isArray(ports) || ports.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No serial ports found — running in dry-run';
      opt.value = '';
      portSelect.appendChild(opt);
      return;
    }
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.device;
      opt.textContent = `${p.device} — ${p.description}`;
      portSelect.appendChild(opt);
    });
  }

  function setRobotConnected(connected, port) {
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('disconnected', !connected);
    statusText.textContent = connected ? `Connected to ${port}` : 'Robot not connected (dry-run)';
    connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  }

  connectBtn.addEventListener('click', async () => {
    if (connectBtn.textContent === 'Disconnect') {
      await callApi('disconnect_robot');
      setRobotConnected(false, null);
      logToRobotPanel('disconnected');
      return;
    }
    const port = portSelect.value;
    if (!port) {
      logToRobotPanel('no port selected — staying in dry-run');
      return;
    }
    const result = await callApi('connect_robot', port);
    if (result.ok) {
      setRobotConnected(true, result.port);
      logToRobotPanel(`connected to ${result.port}`);
    } else {
      logToRobotPanel('connect failed: ' + result.error);
    }
  });

  refreshBtn.addEventListener('click', refreshPorts);

  async function sendRobotCommand() {
    const text = robotInput.value.trim();
    if (!text) return;
    robotInput.value = '';
    robotNarration.textContent = '🦴 Biscuit is thinking...';
    robotSend.disabled = true;
    if (buddies.robot) buddies.robot.classList.add('thinking');

    const result = await callApi('robot_command', text);
    robotSend.disabled = false;
    if (buddies.robot) buddies.robot.classList.remove('thinking');

    if (!result.ok) {
      robotNarration.textContent = 'Biscuit got confused: ' + (result.error || 'unknown');
      return;
    }

    const narration = result.plan.narration || 'Woof!';
    robotNarration.textContent = narration;
    speak(narration, buddies.robot);

    if (!result.plan.actions || result.plan.actions.length === 0) {
      logToRobotPanel('no actions to run');
    }
  }

  robotSend.addEventListener('click', sendRobotCommand);
  robotInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendRobotCommand(); });

  robotStop.addEventListener('click', async () => {
    stopSpeaking();
    await callApi('emergency_stop');
    robotNarration.textContent = 'STOPPED';
    logToRobotPanel('emergency stop');
  });

  // ----- Boot -----
  async function boot() {
    // Wait for pywebview API to attach
    let tries = 0;
    while (!api() && tries < 50) {
      await new Promise(r => setTimeout(r, 100));
      tries++;
    }

    const status = await callApi('get_status');

    // Restore the voice picker preference from backend memory if local
    // storage doesn't have it (handles webview storage clears).
    try {
      if (!localStorage.getItem(SAVED_VOICE_KEY)) {
        const mem = await callApi('get_memory');
        const savedVoice = mem && mem.preferences && mem.preferences.voice_name;
        if (savedVoice) localStorage.setItem(SAVED_VOICE_KEY, savedVoice);
      }
    } catch (e) { /* not fatal */ }

    if (status && status.demo_mode) {
      const msg = status.ai_error || 'Biscuit is in demo mode.';
      appendBubble('buddy', msg + ' Try saying hi, asking for a joke, or driving the robot!');
    }
    if (status && status.voice_available) {
      voiceAvailable = true;
    } else {
      const reason = (status && status.voice_error) || 'voice not available';
      console.warn('[buddy] voice unavailable:', reason);
    }
    if (status && status.eleven_ready) {
      elevenReady = true;
      console.log('[buddy] ElevenLabs ready — using premium TTS with character-level lip sync');
    } else if (status && status.eleven_error) {
      console.log('[buddy] ElevenLabs not configured (' + status.eleven_error + '), using Web Speech fallback');
    }

    // Load any bundled bark samples (real audio generated via ElevenLabs SFX,
    // committed under assets/sounds/). Falls back to synth if not present.
    preloadBundledBarks();
    if (status && status.robot_connected) {
      setRobotConnected(true, status.robot_port);
    } else {
      setRobotConnected(false, null);
    }
    // Re-attach mic handlers now that voiceAvailable is known
    setupMics();
  }

  boot();
})();
