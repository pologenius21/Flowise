/**
 * PhantomChat Client
 * Anonymous • Ephemeral • Encrypted
 *
 * - E2EE via Web Crypto (ECDH P-256 + AES-256-GCM)
 * - 140 char limit, 30s expire, 10s burn
 * - QR code contact exchange with regenerating codes
 * - Name detection & redaction
 * - Anti-copy, anti-screenshot, anti-forensic protections
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════════════
  // STATE — sessionStorage only, wiped on tab close
  // ═══════════════════════════════════════════════════

  const MAX_CHARS = 140;
  const EXPIRE_MS = 30000;  // 30 seconds after read
  const BURN_MS = 10000;    // 10 seconds after expire

  let ws = null;
  let identity = null;        // { publicKey, privateKey }
  let myAnonId = null;
  let myPublicKeyB64 = null;
  let contacts = new Map();   // anonId -> { publicKey, sharedKey, displayHash }
  let activeContact = null;
  let messages = new Map();   // contactId -> [{ id, text, sent, timestamp, expireTimer, burnTimer }]
  let qrRefreshInterval = null;
  let currentExchangeCode = null;

  // ═══════════════════════════════════════════════════
  // ANTI-FORENSIC PROTECTIONS
  // ═══════════════════════════════════════════════════

  function initProtections() {
    // Block right-click context menu
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Block keyboard shortcuts for copy, save, print, screenshot
    document.addEventListener('keydown', e => {
      // Block: Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Ctrl+S, Ctrl+P, PrintScreen
      if (e.ctrlKey || e.metaKey) {
        if (['c', 'v', 'x', 'a', 's', 'p'].includes(e.key.toLowerCase())) {
          // Allow typing in input only for non-copy operations
          if (e.target.id === 'message-input' && !['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
            return;
          }
          // Allow paste ONLY in message-input and scan-input
          if (e.key.toLowerCase() === 'v' && (e.target.id === 'message-input' || e.target.id === 'scan-input')) {
            return;
          }
          e.preventDefault();
        }
      }
      if (e.key === 'PrintScreen' || e.key === 'F12') {
        e.preventDefault();
      }
    });

    // Block drag events
    document.addEventListener('dragstart', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    // Detect visibility change (potential screenshot/screen recording)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Blur all message content when tab is hidden
        document.querySelectorAll('.msg-text').forEach(el => {
          el.style.filter = 'blur(8px)';
        });
      } else {
        document.querySelectorAll('.msg-text').forEach(el => {
          el.style.filter = 'none';
        });
      }
    });

    // Block copy events
    document.addEventListener('copy', e => {
      e.preventDefault();
      e.clipboardData.setData('text/plain', '');
    });

    // Block cut events
    document.addEventListener('cut', e => {
      e.preventDefault();
    });
  }

  // ═══════════════════════════════════════════════════
  // NAME DETECTION & REDACTION
  // ═══════════════════════════════════════════════════

  // Common name patterns to redact
  const NAME_PATTERNS = [
    // Capitalized words that look like names (2+ chars, not common words)
    /\b[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}\b/g,  // "First Last"
    /\b(?:Mr|Mrs|Ms|Dr|Prof)\.\s*[A-Z][a-z]+/g,    // "Mr. Smith"
    // @mentions
    /@\w{2,}/g,
    // Email-like patterns
    /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g,
    // Phone numbers
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ];

  // Common words that look like names but aren't
  const COMMON_WORDS = new Set([
    'the', 'this', 'that', 'they', 'them', 'then', 'than', 'there',
    'here', 'where', 'when', 'what', 'which', 'will', 'with',
    'have', 'been', 'from', 'just', 'about', 'also', 'back',
    'could', 'would', 'should', 'some', 'well', 'still', 'such',
    'each', 'much', 'both', 'these', 'those', 'your', 'know',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'january', 'february', 'march', 'april',
    'may', 'june', 'july', 'august', 'september', 'october',
    'november', 'december', 'today', 'tomorrow', 'yesterday',
    'maybe', 'sure', 'yeah', 'nope', 'okay', 'hello', 'sorry',
    'thanks', 'please', 'right', 'left', 'north', 'south', 'east', 'west',
    'new', 'old', 'good', 'bad', 'great', 'nice', 'real',
    'very', 'really', 'true', 'false', 'same', 'other',
  ]);

  function redactNames(text) {
    let redacted = text;

    // Redact matched patterns
    NAME_PATTERNS.forEach(pattern => {
      redacted = redacted.replace(pattern, match => {
        // Check if it's a common word (case-insensitive)
        const words = match.trim().split(/\s+/);
        const allCommon = words.every(w => COMMON_WORDS.has(w.toLowerCase()));
        if (allCommon) return match;
        return `<span class="redacted">${'█'.repeat(match.length)}</span>`;
      });
    });

    return redacted;
  }

  // ═══════════════════════════════════════════════════
  // IDENTITY MANAGEMENT
  // ═══════════════════════════════════════════════════

  async function initIdentity() {
    // Check sessionStorage for existing identity
    const stored = sessionStorage.getItem('phantom_identity');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        const privateKey = await PhantomCrypto.importPrivateKey(data.privateKey);
        const publicKey = await PhantomCrypto.importPublicKey(data.publicKey);
        identity = { publicKey, privateKey };
        myAnonId = data.anonId;
        myPublicKeyB64 = data.publicKey;

        // Restore contacts
        if (data.contacts) {
          for (const c of data.contacts) {
            const cPubKey = await PhantomCrypto.importPublicKey(c.publicKey);
            const sharedKey = await PhantomCrypto.deriveSharedKey(privateKey, cPubKey);
            contacts.set(c.anonId, {
              publicKey: cPubKey,
              publicKeyB64: c.publicKey,
              sharedKey,
              displayHash: c.displayHash
            });
          }
        }
        return;
      } catch (e) {
        sessionStorage.removeItem('phantom_identity');
      }
    }

    // Generate new identity
    const keyPair = await PhantomCrypto.generateIdentity();
    identity = keyPair;
    myPublicKeyB64 = await PhantomCrypto.exportPublicKey(keyPair.publicKey);
    myAnonId = await PhantomCrypto.generateAnonId(keyPair.publicKey);

    await saveIdentity();
  }

  async function saveIdentity() {
    const data = {
      privateKey: await PhantomCrypto.exportPrivateKey(identity.privateKey),
      publicKey: myPublicKeyB64,
      anonId: myAnonId,
      contacts: []
    };

    for (const [anonId, c] of contacts) {
      data.contacts.push({
        anonId,
        publicKey: c.publicKeyB64,
        displayHash: c.displayHash
      });
    }

    sessionStorage.setItem('phantom_identity', JSON.stringify(data));
  }

  function generateDisplayHash(anonId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let hash = '';
    for (let i = 0; i < 8; i++) {
      const code = anonId.charCodeAt(i % anonId.length) * (i + 7);
      hash += chars[code % chars.length];
    }
    return hash.slice(0, 3) + '#' + hash.slice(3, 7);
  }

  // ═══════════════════════════════════════════════════
  // WEBSOCKET CONNECTION
  // ═══════════════════════════════════════════════════

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'register',
        anonId: myAnonId,
        publicKey: myPublicKeyB64
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      // Reconnect after 2s
      setTimeout(connectWS, 2000);
    };

    ws.onerror = () => {};
  }

  async function handleServerMessage(msg) {
    switch (msg.type) {
      case 'registered':
        showToast('Identity active');
        break;

      case 'exchange_waiting':
        showToast('Waiting for contact to scan...');
        break;

      case 'exchange_complete':
        await handleExchangeComplete(msg);
        break;

      case 'exchange_error':
        showToast(`Exchange failed: ${msg.reason}`, 'error');
        break;

      case 'message':
        await handleIncomingMessage(msg);
        break;

      case 'sent':
        // Message confirmed sent
        break;

      case 'read_receipt':
        // Could trigger visual feedback
        break;

      case 'panic_complete':
        executePanic();
        break;

      case 'error':
        showToast(msg.reason, 'error');
        break;
    }
  }

  // ═══════════════════════════════════════════════════
  // CONTACT EXCHANGE (QR)
  // ═══════════════════════════════════════════════════

  async function showQRExchange() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'exchange-modal';

    overlay.innerHTML = `
      <div class="modal">
        <h2>ADD CONTACT</h2>
        <div id="qr-tab-share" style="display:block">
          <p>Show this QR code to your contact.<br>It regenerates every 45 seconds.</p>
          <canvas id="qr-canvas" width="200" height="200"></canvas>
          <div id="qr-timer">45s</div>
          <div class="modal-actions">
            <button class="btn" onclick="document.getElementById('qr-tab-share').style.display='none';document.getElementById('qr-tab-scan').style.display='block'">I WANT TO SCAN</button>
            <button class="btn btn-danger" id="close-exchange-btn">CANCEL</button>
          </div>
        </div>
        <div id="qr-tab-scan" style="display:none">
          <p>Paste the exchange code from your contact's QR.</p>
          <input type="text" id="scan-input" placeholder="Paste exchange code..." autocomplete="off" spellcheck="false">
          <div class="modal-actions">
            <button class="btn btn-primary" id="claim-btn">CONNECT</button>
            <button class="btn" onclick="document.getElementById('qr-tab-scan').style.display='none';document.getElementById('qr-tab-share').style.display='block'">BACK</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handler
    document.getElementById('close-exchange-btn').onclick = () => {
      clearInterval(qrRefreshInterval);
      overlay.remove();
    };

    // Claim handler
    document.getElementById('claim-btn').onclick = () => {
      const code = document.getElementById('scan-input').value.trim();
      if (code) {
        ws.send(JSON.stringify({
          type: 'exchange_claim',
          code,
          publicKey: myPublicKeyB64
        }));
      }
    };

    // Allow paste in scan input
    const scanInput = document.getElementById('scan-input');
    scanInput.addEventListener('paste', (e) => {
      // Explicitly allow paste here
    });

    // Generate first QR and start refresh cycle
    await refreshQR();
    qrRefreshInterval = setInterval(refreshQR, 45000);
  }

  async function refreshQR() {
    try {
      const resp = await fetch('/api/exchange/create');
      const { code } = await resp.json();
      currentExchangeCode = code;

      // Tell server we're offering this code
      ws.send(JSON.stringify({
        type: 'exchange_offer',
        code,
        publicKey: myPublicKeyB64
      }));

      // Render QR code
      const canvas = document.getElementById('qr-canvas');
      if (canvas && typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, code, {
          width: 200,
          margin: 2,
          color: { dark: '#7b2fff', light: '#111111' }
        });
      } else if (canvas) {
        // Fallback: show code as text
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = '#7b2fff';
        ctx.font = '9px monospace';
        // Wrap the code
        const lines = code.match(/.{1,24}/g) || [];
        lines.forEach((line, i) => {
          ctx.fillText(line, 10, 30 + i * 14);
        });
      }

      // Timer countdown
      let remaining = 45;
      const timerEl = document.getElementById('qr-timer');
      const countdown = setInterval(() => {
        remaining--;
        if (timerEl) timerEl.textContent = `${remaining}s`;
        if (remaining <= 0) clearInterval(countdown);
      }, 1000);

    } catch (e) {
      // Silently fail
    }
  }

  async function handleExchangeComplete(msg) {
    const contactPubKey = await PhantomCrypto.importPublicKey(msg.contactPublicKey);
    const sharedKey = await PhantomCrypto.deriveSharedKey(identity.privateKey, contactPubKey);
    const displayHash = generateDisplayHash(msg.contactAnonId);

    contacts.set(msg.contactAnonId, {
      publicKey: contactPubKey,
      publicKeyB64: msg.contactPublicKey,
      sharedKey,
      displayHash
    });

    await saveIdentity();
    renderContacts();
    showToast('Contact added securely');

    // Close modal if open
    const modal = document.getElementById('exchange-modal');
    if (modal) {
      clearInterval(qrRefreshInterval);
      modal.remove();
    }
  }

  // ═══════════════════════════════════════════════════
  // MESSAGING
  // ═══════════════════════════════════════════════════

  async function sendMessage() {
    if (!activeContact) return;

    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || text.length > MAX_CHARS) return;

    const contact = contacts.get(activeContact);
    if (!contact) return;

    try {
      const { encrypted, nonce } = await PhantomCrypto.encrypt(contact.sharedKey, text);

      ws.send(JSON.stringify({
        type: 'message',
        to: activeContact,
        encrypted,
        nonce
      }));

      // Add to local messages
      addLocalMessage(activeContact, {
        id: crypto.randomUUID(),
        text,
        sent: true,
        timestamp: Date.now()
      });

      input.value = '';
      updateCharCount();
    } catch (e) {
      showToast('Encryption failed', 'error');
    }
  }

  async function handleIncomingMessage(msg) {
    const contact = contacts.get(msg.from);
    if (!contact) return;

    try {
      const text = await PhantomCrypto.decrypt(contact.sharedKey, msg.encrypted, msg.nonce);

      addLocalMessage(msg.from, {
        id: msg.id,
        text,
        sent: false,
        timestamp: msg.serverTimestamp
      });

      // Send read receipt
      ws.send(JSON.stringify({
        type: 'read',
        messageId: msg.id,
        from: msg.from
      }));

      // Notification sound or visual if not active chat
      if (msg.from !== activeContact) {
        renderContacts(); // Update unread badge
      }
    } catch (e) {
      // Decryption failed — silently discard
    }
  }

  function addLocalMessage(contactId, msg) {
    if (!messages.has(contactId)) {
      messages.set(contactId, []);
    }

    const msgList = messages.get(contactId);
    msgList.push(msg);

    // Start expire timer (30s)
    msg.expireTimer = setTimeout(() => {
      msg.expiring = true;
      renderMessages();

      // Start burn timer (10s after expire)
      msg.burnTimer = setTimeout(() => {
        msg.burned = true;
        const idx = msgList.indexOf(msg);
        if (idx !== -1) msgList.splice(idx, 1);
        renderMessages();
      }, BURN_MS);
    }, EXPIRE_MS);

    if (contactId === activeContact) {
      renderMessages();
    }
  }

  // ═══════════════════════════════════════════════════
  // PANIC WIPE
  // ═══════════════════════════════════════════════════

  function triggerPanic() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'panic' }));
    }
    executePanic();
  }

  function executePanic() {
    // Wipe everything
    sessionStorage.clear();
    localStorage.clear();
    contacts.clear();
    messages.clear();
    identity = null;
    myAnonId = null;

    // White-out the screen
    document.body.innerHTML = '';
    document.body.style.background = '#000';

    // Reload after brief delay
    setTimeout(() => {
      location.reload();
    }, 500);
  }

  // ═══════════════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════════════

  function renderContacts() {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    list.innerHTML = '';

    for (const [anonId, contact] of contacts) {
      const item = document.createElement('div');
      item.className = `contact-item${activeContact === anonId ? ' active' : ''}`;

      const unread = messages.has(anonId) && anonId !== activeContact
        ? messages.get(anonId).filter(m => !m.sent && !m.burned).length
        : 0;

      item.innerHTML = `
        <div class="contact-status"></div>
        <span class="contact-hash">${contact.displayHash}</span>
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
      `;

      item.onclick = () => {
        activeContact = anonId;
        renderContacts();
        renderChatView();
        renderMessages();
      };

      list.appendChild(item);
    }
  }

  function renderChatView() {
    const main = document.getElementById('main');
    if (!main) return;

    const contact = contacts.get(activeContact);
    if (!contact) return;

    main.innerHTML = `
      <div id="chat-header">
        <span id="chat-contact-id">${contact.displayHash}</span>
        <span class="encryption-badge">E2EE ACTIVE</span>
      </div>
      <div id="messages-container"></div>
      <div id="input-area">
        <textarea id="message-input"
          placeholder="Type a message... (${MAX_CHARS} chars max)"
          maxlength="${MAX_CHARS}"
          rows="1"
          spellcheck="false"
          autocomplete="off"
        ></textarea>
        <span id="char-count">${MAX_CHARS}</span>
        <button id="send-btn">SEND</button>
      </div>
    `;

    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    input.addEventListener('input', updateCharCount);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Block paste of anything except plain text in message input
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      // Only allow plain text, truncated to max chars
      const remaining = MAX_CHARS - input.value.length;
      if (remaining > 0) {
        const insert = text.slice(0, remaining);
        document.execCommand('insertText', false, insert);
      }
    });

    sendBtn.onclick = sendMessage;

    renderMessages();
  }

  function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container || !activeContact) return;

    const msgList = messages.get(activeContact) || [];
    container.innerHTML = '';

    for (const msg of msgList) {
      if (msg.burned) continue;

      const el = document.createElement('div');
      el.className = `message ${msg.sent ? 'sent' : 'received'}${msg.expiring ? ' burning' : ''}`;

      const redactedText = redactNames(msg.text);

      el.innerHTML = `
        <div class="msg-text">${escapeHtml(msg.text).replace(
          // Re-apply redaction to escaped HTML
          /\b[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}\b/g,
          match => {
            const words = match.trim().split(/\s+/);
            if (words.every(w => COMMON_WORDS.has(w.toLowerCase()))) return match;
            return `<span class="redacted">${'█'.repeat(match.length)}</span>`;
          }
        )}</div>
        <div class="msg-meta">
          ${msg.expiring
            ? '<span class="burn-timer">BURNING...</span>'
            : `<span>${formatTime(msg.timestamp)}</span>`
          }
        </div>
      `;

      container.appendChild(el);
    }

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  function updateCharCount() {
    const input = document.getElementById('message-input');
    const counter = document.getElementById('char-count');
    if (!input || !counter) return;

    const remaining = MAX_CHARS - input.value.length;
    counter.textContent = remaining;

    counter.className = '';
    if (remaining <= 20) counter.className = 'warning';
    if (remaining <= 0) counter.className = 'over';
  }

  function renderWelcomeScreen() {
    const main = document.getElementById('main');
    main.innerHTML = `
      <div id="welcome-screen">
        <div class="ghost">&#128123;</div>
        <p>
          NO IDENTITY. NO HISTORY. NO TRACES.<br><br>
          Add a contact using the QR exchange<br>
          to start an encrypted conversation.<br><br>
          <span style="color: var(--text-dim); font-size: 10px;">
            Messages expire 30s after reading.<br>
            Everything burns 10s after that.
          </span>
        </p>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderColor = 'var(--danger)';
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════

  async function init() {
    initProtections();
    await initIdentity();

    // Render UI
    document.getElementById('my-anon-id').textContent = `ID: ${myAnonId}`;
    document.getElementById('add-contact-btn').onclick = showQRExchange;
    document.getElementById('panic-btn').onclick = () => {
      if (confirm('WIPE ALL DATA? This cannot be undone.')) {
        triggerPanic();
      }
    };

    renderContacts();
    renderWelcomeScreen();
    connectWS();
  }

  // Expose QR lib callback
  window.PhantomApp = { init };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
