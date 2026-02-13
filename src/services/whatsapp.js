const axios = require('axios');
const config = require('../config');

const API_VERSION = config.whatsapp.apiVersion;

/**
 * Cria instancia axios para um usuario especifico
 */
function createApi(credentials) {
    const { accessToken, phoneNumberId } = credentials;
    return axios.create({
        baseURL: `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}`,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });
}

/**
 * Envia mensagem de texto
 */
async function sendMessage(credentials, to, text) {
    const api = createApi(credentials);
    const phone = formatPhone(to);

    const response = await api.post('/messages', {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { body: text }
    });

    console.log(`[WhatsApp:${credentials.phoneNumberId}] Mensagem enviada para ${phone}`);
    return response.data;
}

/**
 * Envia mensagem com imagem (via URL)
 */
async function sendImageMessage(credentials, to, imageUrl, caption = '') {
    const api = createApi(credentials);
    const phone = formatPhone(to);

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'image',
        image: {
            link: imageUrl
        }
    };

    if (caption) {
        payload.image.caption = caption;
    }

    const response = await api.post('/messages', payload);
    console.log(`[WhatsApp:${credentials.phoneNumberId}] Imagem enviada para ${phone}`);
    return response.data;
}

/**
 * Marca mensagem como lida
 */
async function markAsRead(credentials, messageId) {
    try {
        const api = createApi(credentials);
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        });
    } catch (err) {
        console.error('[WhatsApp] Erro ao marcar como lida:', err.message);
    }
}

/**
 * Valida credenciais fazendo uma chamada de teste a API
 */
async function validateCredentials(accessToken, phoneNumberId) {
    try {
        const response = await axios.get(
            `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        return { valid: true, data: response.data };
    } catch (err) {
        return { valid: false, error: err.response?.data?.error?.message || err.message };
    }
}

/**
 * Extrai dados da mensagem recebida via webhook
 */
function parseWebhookMessage(body) {
    try {
        if (body.object !== 'whatsapp_business_account') return null;

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (!value?.messages?.length) return null;

        const message = value.messages[0];
        const contact = value.contacts?.[0];
        const metadata = value.metadata;

        // Aceita apenas mensagens de texto
        if (message.type !== 'text') return null;

        return {
            phone: message.from,
            text: message.text?.body || '',
            pushName: contact?.profile?.name || 'Cliente',
            messageId: message.id,
            timestamp: message.timestamp,
            phoneNumberId: metadata?.phone_number_id || null
        };
    } catch (err) {
        console.error('[WhatsApp] Erro ao parsear webhook:', err.message);
        return null;
    }
}

/**
 * Verifica o webhook (challenge do Meta)
 */
function verifyWebhook(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
        console.log('[WhatsApp] Webhook verificado com sucesso');
        return { success: true, challenge };
    }

    return { success: false };
}

/**
 * Formata numero de telefone (remove caracteres especiais, mantem apenas digitos)
 */
function formatPhone(phone) {
    return String(phone).replace(/[^0-9]/g, '');
}

module.exports = {
    sendMessage,
    sendImageMessage,
    markAsRead,
    validateCredentials,
    parseWebhookMessage,
    verifyWebhook
};
