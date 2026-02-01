const baileys = require('./baileys');
const firebase = require('./firebase');
const salesAgent = require('../agent/salesAgent');

// Armazena handlers de mensagem por usuário
const messageHandlers = new Map();

/**
 * Inicia sessão do WhatsApp para um usuário
 */
async function startSession(userId) {
    console.log(`Iniciando sessao para usuario: ${userId}`);

    const user = await firebase.getUser(userId);
    if (!user) {
        throw new Error('Usuario nao encontrado');
    }

    // Conecta ao WhatsApp
    await baileys.connectWhatsApp(userId, {
        onConnected: async () => {
            await firebase.updateWhatsAppStatus(userId, true);
            console.log(`[${userId}] Status atualizado: conectado`);
        },

        onQR: (qrCode) => {
            console.log(`[${userId}] Novo QR Code disponivel`);
        },

        onLoggedOut: async () => {
            await firebase.updateWhatsAppStatus(userId, false);
            messageHandlers.delete(userId);
            console.log(`[${userId}] Deslogado do WhatsApp`);
        },

        onMessage: async (data) => {
            await handleIncomingMessage(userId, data);
        }
    });

    // Registra handler
    messageHandlers.set(userId, true);

    return baileys.getConnectionStatus(userId);
}

/**
 * Processa mensagem recebida
 */
async function handleIncomingMessage(userId, { phone, text, pushName, remoteJid }) {
    // Usa remoteJid para responder (funciona com LID e numero normal)
    const replyTo = remoteJid || phone;

    try {
        // Busca configurações do usuário
        const user = await firebase.getUser(userId);
        if (!user) return;

        // Verifica se agente está ativo
        if (!user.agent_settings?.active) {
            console.log(`[${userId}] Agente desativado, ignorando mensagem`);
            return;
        }

        // Incrementa contador de mensagens
        await firebase.incrementMessageCount(userId);

        // Processa com o agente de vendas
        const response = await salesAgent.processMessage(userId, phone, text, pushName, user);

        // Envia resposta usando remoteJid
        if (response) {
            await baileys.sendMessage(userId, replyTo, response);
        }
    } catch (error) {
        console.error(`[${userId}] Erro ao processar mensagem:`, error);

        // Envia mensagem de erro genérica
        try {
            await baileys.sendMessage(userId, replyTo,
                'Desculpe, tive um problema tecnico. Por favor, tente novamente em instantes.');
        } catch (e) {
            console.error('Erro ao enviar mensagem de erro:', e);
        }
    }
}

/**
 * Para sessão do usuário
 */
async function stopSession(userId) {
    await baileys.disconnect(userId);
    await firebase.updateWhatsAppStatus(userId, false);
    messageHandlers.delete(userId);
    console.log(`[${userId}] Sessao encerrada`);
}

/**
 * Obtém status da sessão
 */
function getSessionStatus(userId) {
    return baileys.getConnectionStatus(userId);
}

/**
 * Reconecta usuários que tinham sessão salva
 */
async function reconnectSavedSessions() {
    console.log('Verificando sessoes salvas...');

    const fs = require('fs');
    const path = require('path');
    const sessionsDir = path.join(process.cwd(), 'sessions');

    if (!fs.existsSync(sessionsDir)) {
        console.log('Nenhuma sessao salva encontrada');
        return;
    }

    const userDirs = fs.readdirSync(sessionsDir);

    for (const userId of userDirs) {
        const sessionPath = path.join(sessionsDir, userId);

        if (fs.statSync(sessionPath).isDirectory() && fs.readdirSync(sessionPath).length > 0) {
            console.log(`Reconectando usuario: ${userId}`);

            try {
                await startSession(userId);
            } catch (error) {
                console.error(`Erro ao reconectar ${userId}:`, error);
            }
        }
    }
}

/**
 * Lista todas as sessões ativas
 */
function getActiveSessions() {
    return baileys.getActiveConnections();
}

module.exports = {
    startSession,
    stopSession,
    getSessionStatus,
    reconnectSavedSessions,
    getActiveSessions,
    handleIncomingMessage
};
