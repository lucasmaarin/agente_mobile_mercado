const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const config = require('../config');

// Logger
const logger = pino({ level: config.debug ? 'info' : 'silent' });

// Armazena conexões ativas
const connections = new Map();

// Event emitter
const EventEmitter = require('events');
const baileysEvents = new EventEmitter();

/**
 * Conecta ao WhatsApp
 */
async function connectWhatsApp(userId, callbacks = {}) {
    const sessionPath = path.join(process.cwd(), 'sessions', userId);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`[${userId}] Usando Baileys v${version.join('.')} (latest: ${isLatest})`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: true,
        logger,
        browser: ['Chrome (Linux)', 'Chrome', '120.0.6099.109'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
    });

    connections.set(userId, {
        socket: sock,
        status: 'connecting',
        qrCode: null
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[${userId}] QR Code gerado`);
            try {
                const qrDataUrl = await QRCode.toDataURL(qr);
                const conn = connections.get(userId);
                if (conn) {
                    conn.qrCode = qrDataUrl;
                    conn.status = 'waiting_qr';
                }
                baileysEvents.emit('qr', { userId, qrCode: qrDataUrl });
                if (callbacks.onQR) callbacks.onQR(qrDataUrl);
            } catch (err) {
                console.error('Erro QR:', err);
            }
        }

        if (connection === 'open') {
            console.log(`[${userId}] Conectado!`);
            const conn = connections.get(userId);
            if (conn) {
                conn.status = 'connected';
                conn.qrCode = null;
            }
            baileysEvents.emit('connected', { userId });
            if (callbacks.onConnected) callbacks.onConnected();
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`[${userId}] Desconectado (${code})`);

            const conn = connections.get(userId);
            if (conn) conn.status = 'disconnected';

            if (code !== DisconnectReason.loggedOut) {
                console.log(`[${userId}] Reconectando em 3s...`);
                setTimeout(() => connectWhatsApp(userId, callbacks), 3000);
            } else {
                connections.delete(userId);
                await clearSession(userId);
                if (callbacks.onLoggedOut) callbacks.onLoggedOut();
            }
        }
    });

    // Mensagens recebidas
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (msg.key.fromMe) continue;

                const jid = msg.key.remoteJid || '';
                if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

                // Extrai texto
                const messageContent = msg.message;
                if (!messageContent) continue;

                const text = messageContent.conversation ||
                    messageContent.extendedTextMessage?.text ||
                    messageContent.imageMessage?.caption ||
                    messageContent.videoMessage?.caption ||
                    '';

                if (!text) continue;

                // Extrai telefone - usa remoteJid para responder
                const remoteJid = jid; // Guarda JID original para responder
                let phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');

                // Se tem senderPn no key, usa como phone para exibição
                if (msg.key.senderPn) {
                    phone = msg.key.senderPn.replace('@s.whatsapp.net', '');
                }

                const pushName = msg.pushName || 'Cliente';
                console.log(`[${userId}] ${pushName} (${phone}): ${text}`);

                // Passa remoteJid para poder responder corretamente
                baileysEvents.emit('message', { userId, phone, text, pushName, remoteJid, message: msg });

                if (callbacks.onMessage) {
                    callbacks.onMessage({ phone, text, pushName, remoteJid, message: msg });
                }
            } catch (err) {
                console.error(`[${userId}] Erro msg:`, err.message);
            }
        }
    });

    return sock;
}

async function sendMessage(userId, phoneOrJid, text) {
    const conn = connections.get(userId);
    if (!conn || conn.status !== 'connected') {
        throw new Error('WhatsApp nao conectado');
    }

    // Se já é um JID completo, usa direto. Senão, adiciona sufixo
    let jid = phoneOrJid;
    if (!phoneOrJid.includes('@')) {
        jid = `${phoneOrJid}@s.whatsapp.net`;
    }

    await conn.socket.sendMessage(jid, { text });
    console.log(`[${userId}] Enviado para ${jid}`);
    return true;
}

function getConnectionStatus(userId) {
    const conn = connections.get(userId);
    if (!conn) return { status: 'disconnected', qrCode: null };
    return { status: conn.status, qrCode: conn.qrCode };
}

async function disconnect(userId) {
    const conn = connections.get(userId);
    if (conn?.socket) {
        try { await conn.socket.logout(); } catch (e) {}
        connections.delete(userId);
    }
    await clearSession(userId);
}

async function clearSession(userId) {
    const sessionPath = path.join(process.cwd(), 'sessions', userId);
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }
}

function hasSession(userId) {
    const sessionPath = path.join(process.cwd(), 'sessions', userId);
    return fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;
}

function getActiveConnections() {
    return Array.from(connections.entries()).map(([userId, conn]) => ({
        userId,
        status: conn.status
    }));
}

module.exports = {
    connectWhatsApp,
    sendMessage,
    getConnectionStatus,
    disconnect,
    clearSession,
    hasSession,
    getActiveConnections,
    baileysEvents,
    connections
};
