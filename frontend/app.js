// Nick's Robot Buddy — frontend logic
// Voice in/out via Web Speech API; UI state machine; bridge to Python via pywebview.

(function () {
  'use strict';

  const MOUTH_CLOSED = 'M 170 280 Q 185 295 200 290 Q 215 295 230 280';
  const MOUTH_OPEN_SHAPE = 'M 168 278 Q 200 320 232 278 Q 220 305 200 308 Q 180 305 168 278 Z';
  const TONGUE_SHAPE = 'M 178 290 Q 200 315 222 290 Q 215 308 200 310 Q 185 308 178 290 Z';

  // ----- Buddy avatar instances -----
  function mountBuddy(containerId) {
    const tpl = document.getElementById('buddy-template');
    const node = tpl.content.cloneNode(true);
    const root = document.getElementById(containerId);
    if (!root) return null;
    root.innerHTML = '';
    root.appendChild(node);
    return root.querySelector('svg.buddy-svg');
  }

  const buddies = {
    picker: mountBuddy('buddy-picker'),
    chat: mountBuddy('buddy-chat'),
    robot: mountBuddy('buddy-robot'),
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
  }

  // Use document-level delegation so handlers can't be missed by timing or
  // re-renders. Keep the per-element listeners as a belt-and-suspenders backup.
  document.addEventListener('click', (e) => {
    const skillBtn = e.target.closest('.skill-btn');
    if (skillBtn) {
      const skill = skillBtn.dataset.skill;
      console.log('[buddy] skill click:', skill);
      if (skill === 'chat') showView('view-chat');
      else if (skill === 'robot') { showView('view-robot'); refreshPorts(); }
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

  // ----- Speech synthesis (Buddy talking) -----
  let currentUtterance = null;
  let mouthInterval = null;

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      /child|kid|junior|female|samantha|zira|google us english|aria/i.test(v.name)
    );
    return preferred || voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0];
  }

  function speak(text, buddy) {
    stopSpeaking();
    if (!('speechSynthesis' in window)) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = pickVoice();
    utter.pitch = 1.4;
    utter.rate = 1.05;
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

  // ----- Speech recognition (Nick talking) -----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognitionActive = false;
  let recognitionTarget = null; // { input, statusEl, onFinal }

  function setupRecognition() {
    if (!SR) return null;
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;

    r.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      if (recognitionTarget) {
        if (final) recognitionTarget.input.value = final.trim();
        else if (interim) recognitionTarget.input.value = interim.trim();
      }
    };
    r.onerror = (e) => {
      if (recognitionTarget && recognitionTarget.statusEl) {
        recognitionTarget.statusEl.textContent = 'Couldn\'t hear you, try the keyboard?';
      }
      recognitionActive = false;
    };
    r.onend = () => {
      recognitionActive = false;
      document.querySelectorAll('.mic-btn').forEach(b => b.classList.remove('listening'));
      if (recognitionTarget) {
        const text = recognitionTarget.input.value.trim();
        if (text && recognitionTarget.onFinal) recognitionTarget.onFinal(text);
      }
      recognitionTarget = null;
    };
    return r;
  }

  recognition = setupRecognition();

  function attachMic(micBtn, input, statusEl, onFinal, buddy) {
    if (!recognition) {
      micBtn.disabled = true;
      micBtn.title = 'Voice not supported on this device — use the keyboard';
      micBtn.style.opacity = '0.4';
      return;
    }

    const start = () => {
      if (recognitionActive) return;
      stopSpeaking();
      try {
        recognitionTarget = { input, statusEl, onFinal };
        recognition.start();
        recognitionActive = true;
        micBtn.classList.add('listening');
        if (buddy) {
          buddy.classList.remove('listening'); // reset so the animation re-fires
          void buddy.offsetWidth;              // force reflow
          buddy.classList.add('listening');
        }
        if (statusEl) statusEl.textContent = 'Listening...';
      } catch (_) { /* already started */ }
    };
    const stop = () => {
      if (!recognitionActive) return;
      try { recognition.stop(); } catch (_) {}
    };

    micBtn.addEventListener('mousedown', start);
    micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
    micBtn.addEventListener('mouseup', stop);
    micBtn.addEventListener('mouseleave', stop);
    micBtn.addEventListener('touchend', stop);
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
    chatStatus.textContent = 'Buddy is thinking...';
    chatSend.disabled = true;

    const result = await callApi('chat', text);
    chatSend.disabled = false;
    chatStatus.textContent = '';

    if (!result.ok) {
      appendBubble('buddy', '*tilts head* Buddy got confused: ' + (result.error || 'unknown'));
      return;
    }
    appendBubble('buddy', result.text);
    speak(result.text, buddies.chat);
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  attachMic(chatMic, chatInput, chatStatus, () => sendChat(), buddies.chat);

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

  // Backend pushes log lines through these globals
  window.onRobotLog = logToRobotPanel;
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
    robotNarration.textContent = 'Buddy is thinking...';
    robotSend.disabled = true;

    const result = await callApi('robot_command', text);
    robotSend.disabled = false;

    if (!result.ok) {
      robotNarration.textContent = 'Buddy got confused: ' + (result.error || 'unknown');
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
  attachMic(robotMic, robotInput, null, () => sendRobotCommand(), buddies.robot);

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
      const msg = status.ai_error || 'Buddy is in demo mode.';
      appendBubble('buddy', msg + ' Try saying hi, asking for a joke, or driving the robot!');
    }
    if (status && status.robot_connected) {
      setRobotConnected(true, status.robot_port);
    } else {
      setRobotConnected(false, null);
    }
  }

  boot();
})();
