// Nick's Robot Biscuit — frontend logic
// Voice in/out via Web Speech API; UI state machine; bridge to Python via pywebview.

(function () {
  'use strict';

  const MOUTH_CLOSED = 'M 170 280 Q 185 295 200 290 Q 215 295 230 280';
  const MOUTH_OPEN_SHAPE = 'M 168 278 Q 200 320 232 278 Q 220 305 200 308 Q 180 305 168 278 Z';
  const TONGUE_SHAPE = 'M 178 290 Q 200 315 222 290 Q 215 308 200 310 Q 185 308 178 290 Z';

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
  }

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

  settingsCloseBtn.addEventListener('click', () => {
    if (voiceSelect.value) localStorage.setItem(SAVED_VOICE_KEY, voiceSelect.value);
    settingsModal.classList.add('hidden');
  });

  voiceTestBtn.addEventListener('click', () => {
    if (voiceSelect.value) localStorage.setItem(SAVED_VOICE_KEY, voiceSelect.value);
    const target = buddies.chat || buddies.picker;
    speak("Woof woof! Hi Nick, it's me Biscuit! Wanna play?", target);
  });

  // Click outside the modal content closes it
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      if (voiceSelect.value) localStorage.setItem(SAVED_VOICE_KEY, voiceSelect.value);
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
