/**
 * PhantomChat Server
 * RAM-only, zero-persistence anonymous messaging relay
 * No logs. No archives. No traces.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ═══════════════════════════════════════════════════════
// RAM-ONLY STORAGE — everything dies on restart
// ═══════════════════════════════════════════════════════

// Active connections: anonId -> { ws, publicKey }
const connections = new Map();

// Pending contact exchanges: exchangeCode -> { fromAnonId, timestamp }
const pendingExchanges = new Map();

// Contact pairs: anonId -> Set<contactAnonId>
const contactPairs = new Map();

// Message queue for offline delivery (RAM only, purged on restart)
const messageQueue = new Map();

// ═══════════════════════════════════════════════════════
// SECURITY: No logging, no IP tracking
// ═══════════════════════════════════════════════════════

// Override console to prevent accidental logging in production
const LOG_ENABLED = process.env.PHANTOM_DEBUG === '1';
const log = LOG_ENABLED ? console.log.bind(console) : () => {};

// Strip all identifying headers
app.use((req, res, next) => {
  // Remove server fingerprint
  res.removeHeader('X-Powered-By');
  res.setHeader('Server', 'phantom');

  // Security headers to prevent caching, framing, sniffing
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()');

  // CSP: lock down everything
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; '));

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════
// QR EXCHANGE ENDPOINT
// ═══════════════════════════════════════════════════════

// Generate a one-time exchange code for QR contact adding
app.get('/api/exchange/create', (req, res) => {
  const code = crypto.randomBytes(32).toString('hex');
  // Exchange codes expire after 60 seconds
  pendingExchanges.set(code, {
    timestamp: Date.now(),
    claimed: false
  });

  // Auto-cleanup after 60s
  setTimeout(() => {
    pendingExchanges.delete(code);
  }, 60000);

  res.json({ code, expiresIn: 60 });
});

// ═══════════════════════════════════════════════════════
// WEBSOCKET RELAY — anonymous message routing
// ═══════════════════════════════════════════════════════

wss.on('connection', (ws, req) => {
  let anonId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {

      // ─── REGISTER: claim an anonymous identity ───
      case 'register': {
        if (!msg.anonId || !msg.publicKey) return;
        anonId = msg.anonId;
        connections.set(anonId, { ws, publicKey: msg.publicKey });

        if (!contactPairs.has(anonId)) {
          contactPairs.set(anonId, new Set());
        }

        // Deliver any queued messages
        if (messageQueue.has(anonId)) {
          const queued = messageQueue.get(anonId);
          queued.forEach(m => ws.send(JSON.stringify(m)));
          messageQueue.delete(anonId);
        }

        ws.send(JSON.stringify({ type: 'registered', anonId }));
        log(`[phantom] identity registered: ${anonId.slice(0, 8)}...`);
        break;
      }

      // ─── EXCHANGE: QR-based contact pairing ───
      case 'exchange_offer': {
        if (!msg.code || !anonId) return;
        const exchange = pendingExchanges.get(msg.code);
        if (!exchange || exchange.claimed) {
          ws.send(JSON.stringify({ type: 'exchange_error', reason: 'invalid_or_expired' }));
          return;
        }
        exchange.fromAnonId = anonId;
        exchange.fromPublicKey = msg.publicKey;
        exchange.claimed = false;
        ws.send(JSON.stringify({ type: 'exchange_waiting' }));
        break;
      }

      case 'exchange_claim': {
        if (!msg.code || !anonId) return;
        const exchange = pendingExchanges.get(msg.code);
        if (!exchange || !exchange.fromAnonId || exchange.claimed) {
          ws.send(JSON.stringify({ type: 'exchange_error', reason: 'invalid_or_expired' }));
          return;
        }
        if (exchange.fromAnonId === anonId) {
          ws.send(JSON.stringify({ type: 'exchange_error', reason: 'cannot_add_self' }));
          return;
        }

        exchange.claimed = true;

        // Create mutual contact pair
        if (!contactPairs.has(anonId)) contactPairs.set(anonId, new Set());
        if (!contactPairs.has(exchange.fromAnonId)) contactPairs.set(exchange.fromAnonId, new Set());

        contactPairs.get(anonId).add(exchange.fromAnonId);
        contactPairs.get(exchange.fromAnonId).add(anonId);

        // Notify both parties with each other's public keys
        const fromConn = connections.get(exchange.fromAnonId);

        ws.send(JSON.stringify({
          type: 'exchange_complete',
          contactAnonId: exchange.fromAnonId,
          contactPublicKey: exchange.fromPublicKey
        }));

        if (fromConn && fromConn.ws.readyState === WebSocket.OPEN) {
          const claimerConn = connections.get(anonId);
          fromConn.ws.send(JSON.stringify({
            type: 'exchange_complete',
            contactAnonId: anonId,
            contactPublicKey: claimerConn ? claimerConn.publicKey : msg.publicKey
          }));
        }

        // Burn the exchange code
        pendingExchanges.delete(msg.code);
        log(`[phantom] contact pair established`);
        break;
      }

      // ─── MESSAGE: encrypted relay ───
      case 'message': {
        if (!anonId || !msg.to || !msg.encrypted) return;

        // Verify they are contacts
        const contacts = contactPairs.get(anonId);
        if (!contacts || !contacts.has(msg.to)) {
          ws.send(JSON.stringify({ type: 'error', reason: 'not_contacts' }));
          return;
        }

        const envelope = {
          type: 'message',
          from: anonId,
          encrypted: msg.encrypted,
          nonce: msg.nonce,
          ephemeralPublicKey: msg.ephemeralPublicKey,
          id: crypto.randomBytes(16).toString('hex'),
          serverTimestamp: Date.now()
        };

        const recipient = connections.get(msg.to);
        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
          recipient.ws.send(JSON.stringify(envelope));
          ws.send(JSON.stringify({ type: 'sent', id: envelope.id }));
        } else {
          // Queue for brief offline delivery (purged on server restart)
          if (!messageQueue.has(msg.to)) messageQueue.set(msg.to, []);
          const queue = messageQueue.get(msg.to);
          queue.push(envelope);

          // Max 50 queued messages, auto-purge after 5 minutes
          if (queue.length > 50) queue.shift();
          setTimeout(() => {
            if (messageQueue.has(msg.to)) {
              const q = messageQueue.get(msg.to);
              const idx = q.findIndex(m => m.id === envelope.id);
              if (idx !== -1) q.splice(idx, 1);
              if (q.length === 0) messageQueue.delete(msg.to);
            }
          }, 5 * 60 * 1000);

          ws.send(JSON.stringify({ type: 'queued', id: envelope.id }));
        }
        break;
      }

      // ─── READ RECEIPT (for burn timer) ───
      case 'read': {
        if (!msg.messageId || !msg.from) return;
        const sender = connections.get(msg.from);
        if (sender && sender.ws.readyState === WebSocket.OPEN) {
          sender.ws.send(JSON.stringify({
            type: 'read_receipt',
            messageId: msg.messageId
          }));
        }
        break;
      }

      // ─── PANIC: wipe everything for this identity ───
      case 'panic': {
        if (!anonId) return;
        // Remove all traces
        connections.delete(anonId);
        contactPairs.delete(anonId);
        messageQueue.delete(anonId);

        // Remove from others' contact lists
        for (const [, contacts] of contactPairs) {
          contacts.delete(anonId);
        }

        ws.send(JSON.stringify({ type: 'panic_complete' }));
        ws.close();
        log(`[phantom] identity wiped: ${anonId.slice(0, 8)}...`);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (anonId) {
      connections.delete(anonId);
      log(`[phantom] disconnected: ${anonId.slice(0, 8)}...`);
    }
  });

  ws.on('error', () => {
    if (anonId) connections.delete(anonId);
  });
});

// ═══════════════════════════════════════════════════════
// PERIODIC CLEANUP — purge stale data from RAM
// ═══════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();

  // Purge expired exchange codes (>60s)
  for (const [code, data] of pendingExchanges) {
    if (now - data.timestamp > 60000) {
      pendingExchanges.delete(code);
    }
  }

  // Purge message queues older than 5 minutes
  for (const [id, queue] of messageQueue) {
    const filtered = queue.filter(m => now - m.serverTimestamp < 5 * 60 * 1000);
    if (filtered.length === 0) {
      messageQueue.delete(id);
    } else {
      messageQueue.set(id, filtered);
    }
  }
}, 30000);

// ═══════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════

const PORT = process.env.PORT || 3099;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║       👻 PhantomChat v1.0.0          ║`);
  console.log(`  ║   Anonymous • Ephemeral • Encrypted  ║`);
  console.log(`  ║   RAM-only — no logs, no traces      ║`);
  console.log(`  ╠══════════════════════════════════════╣`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

// Graceful shutdown — wipe everything
process.on('SIGINT', () => {
  connections.clear();
  contactPairs.clear();
  pendingExchanges.clear();
  messageQueue.clear();
  console.log('\n  [phantom] All data wiped. Shutting down.\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  connections.clear();
  contactPairs.clear();
  pendingExchanges.clear();
  messageQueue.clear();
  process.exit(0);
});
