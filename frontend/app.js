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
  const TRICKS = ['sit', 'jump', 'spin', 'wiggle', 'rollover', 'laydown'];
  const TRICK_DURATIONS = { sit: 1400, jump: 900, spin: 1100, wiggle: 900, rollover: 1400, laydown: 1600 };

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
    'spin': 'spin', 'spin around': 'spin', 'twirl': 'spin', 'spin biscuit': 'spin',
    'wiggle': 'wiggle', 'wiggle butt': 'wiggle', 'shake': 'wiggle',
    'roll over': 'rollover', 'rollover': 'rollover',
    'lay down': 'laydown', 'lie down': 'laydown', 'lay': 'laydown', 'down': 'laydown',
    'dance': 'wiggle',  // generic "dance" maps to wiggle
  };
  const TRICK_VERBS = {
    sit: 'Biscuit sits',
    jump: 'Biscuit jumps',
    spin: 'Biscuit spins',
    wiggle: 'Biscuit wiggles',
    rollover: 'Biscuit rolls over',
    laydown: 'Biscuit lies down',
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

    performTrick(buddy, trick);
    playBark();
    if (statusEl) {
      statusEl.textContent = `🐾 ${TRICK_VERBS[trick]}!`;
      setTimeout(() => { if (statusEl.textContent.startsWith('🐾')) statusEl.textContent = ''; }, 1800);
    }
    return true;
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

  function playBark(opts) {
    opts = opts || {};
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + (opts.delay || 0);
    const dur = 0.30 + Math.random() * 0.06;

    // Voiced part: falling sawtooth pitch (the "voiced" core of a bark)
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const startFreq = 270 + Math.random() * 80;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + dur);

    // Noise part: breathy texture
    const sr = ctx.sampleRate;
    const noiseBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Pink-ish noise via simple integration of white
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // Bandpass filter shapes the formants (mouth resonance)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(450, now + dur);
    filter.Q.value = 1.2;

    // Envelope: quick attack, fast decay
    const envOsc = ctx.createGain();
    envOsc.gain.setValueAtTime(0, now);
    envOsc.gain.linearRampToValueAtTime(0.55, now + 0.018);
    envOsc.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const envNoise = ctx.createGain();
    envNoise.gain.setValueAtTime(0, now);
    envNoise.gain.linearRampToValueAtTime(0.4, now + 0.012);
    envNoise.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(envOsc);
    envOsc.connect(filter);
    noise.connect(envNoise);
    envNoise.connect(filter);
    filter.connect(ctx.destination);

    osc.start(now);
    noise.start(now);
    osc.stop(now + dur + 0.05);
    noise.stop(now + dur + 0.05);
  }

  function detectDogNoises(text) {
    return /\b(woo+f+|ruf+f*|bar+k|ar+f|yi+p|yap+|grr+r*)/i.test(text || '');
  }

  function playBarksForText(text) {
    if (!text) return;
    const matches = text.match(/\b(woo+f+|ruf+f*|bar+k|ar+f|yi+p|yap+|grr+r*)/gi) || [];
    const count = Math.min(matches.length || 0, 3);  // cap at 3 so it doesn't get annoying
    for (let i = 0; i < count; i++) {
      playBark({ delay: i * 0.28 });
    }
  }

  // ----- Speech synthesis (Biscuit talking) -----
  let currentUtterance = null;
  let mouthInterval = null;

  // Voice selection priority: Microsoft "Online (Natural)" neural voices sound
  // dramatically better than the legacy ones. Aria/Jenny/Sara are warm, kid-
  // friendly female voices. Ana is specifically tagged for kids.
  // User-selected voice (persisted in localStorage) overrides the tier ranking.
  const SAVED_VOICE_KEY = 'buddy.voice.name';

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

  function speak(text, buddy) {
    stopSpeaking();
    if (!('speechSynthesis' in window)) return;
    // Play actual bark sound effects for any "woof"/"ruff"/"bark" tokens
    // in the text BEFORE synthesizing speech for the rest.
    playBarksForText(text);
    const cleaned = cleanForTTS(text);
    if (!cleaned) return;  // Nothing speakable — pure puppy noises

    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.voice = pickVoice();
    // Softer defaults: lower pitch (less squeaky), slightly slower rate.
    utter.pitch = 1.05;
    utter.rate = 0.95;
    utter.volume = 1.0;

    utter.onstart = () => {
      setSpeaking(buddy, true);
      let open = false;
      mouthInterval = setInterval(() => {
        open = !open;
        setMouth(buddy, open);
      }, 130);
    };
    utter.onend = utter.onerror = () => {
      if (mouthInterval) { clearInterval(mouthInterval); mouthInterval = null; }
      setMouth(buddy, false);
      setSpeaking(buddy, false);
    };

    currentUtterance = utter;
    window.speechSynthesis.speak(utter);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (mouthInterval) { clearInterval(mouthInterval); mouthInterval = null; }
    Object.values(buddies).forEach(b => { setMouth(b, false); setSpeaking(b, false); });
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

  function refreshVoiceList() {
    const voices = window.speechSynthesis.getVoices()
      .filter(v => v.lang && v.lang.startsWith('en'))
      .sort((a, b) => {
        // Online/Natural voices first, then alphabetical
        const aOnline = /Online|Natural/i.test(a.name) ? 0 : 1;
        const bOnline = /Online|Natural/i.test(b.name) ? 0 : 1;
        if (aOnline !== bOnline) return aOnline - bOnline;
        return a.name.localeCompare(b.name);
      });
    const current = pickVoice();
    voiceSelect.innerHTML = '';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      const tag = /Online|Natural/i.test(v.name) ? '✨ ' : '   ';
      opt.textContent = tag + v.name;
      if (current && v.name === current.name) opt.selected = true;
      voiceSelect.appendChild(opt);
    });
  }

  settingsBtn.addEventListener('click', () => {
    refreshVoiceList();
    settingsModal.classList.remove('hidden');
  });

  function persistVoiceChoice(name) {
    if (!name) return;
    localStorage.setItem(SAVED_VOICE_KEY, name);
    // Also save to backend memory so it survives if WebView storage clears.
    callApi('update_preferences', { voice_name: name });
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
