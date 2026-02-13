const whatsapp = require('./whatsapp');
const firebase = require('./firebase');
const salesAgent = require('../agent/salesAgent');

/**
 * Processa mensagem recebida via webhook
 * Roteia para o estabelecimento correto usando phoneNumberId
 */
async function handleIncomingMessage(data) {
    const { phone, text, pushName, messageId, phoneNumberId } = data;

    // Busca usuario/estabelecimento pelo phone_number_id
    const user = await firebase.getUserByPhoneNumberId(phoneNumberId);

    if (!user) {
        console.log(`[Webhook] Nenhum usuario encontrado para phone_number_id: ${phoneNumberId}`);
        return;
    }

    const userId = user.id;
    const credentials = {
        accessToken: user.whatsapp.access_token,
        phoneNumberId: user.whatsapp.phone_number_id
    };

    // Marca como lida
    whatsapp.markAsRead(credentials, messageId);

    try {
        // Verifica se agente esta ativo
        if (!user.agent_settings?.active) {
            console.log(`[${userId}] Agente desativado, ignorando mensagem`);
            return;
        }

        // Incrementa contador de mensagens
        await firebase.incrementMessageCount(userId);

        // Processa com o agente de vendas
        const response = await salesAgent.processMessage(userId, phone, text, pushName, user);

        // Envia resposta
        if (response) {
            const imageUrls = [];

            const imgTagRegex = /\[IMG:([^\]]+)\]/g;
            let cleanResponse = response.replace(imgTagRegex, (_, url) => {
                const trimmed = url.trim();
                if (trimmed) imageUrls.push(trimmed);
                return '';
            });

            const firebaseImageRegex = /https?:\/\/firebasestorage\.googleapis\.com\/[^\s]+/g;
            cleanResponse = cleanResponse.replace(firebaseImageRegex, (url) => {
                imageUrls.push(url);
                return '';
            });

            cleanResponse = cleanResponse.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

            if (cleanResponse) {
                await whatsapp.sendMessage(credentials, phone, cleanResponse);
            }

            if (imageUrls.length > 0) {
                await whatsapp.sendImageMessage(credentials, phone, imageUrls[0]);
            }
        }
    } catch (error) {
        console.error(`[${userId}] Erro ao processar mensagem:`, error);

        try {
            await whatsapp.sendMessage(credentials, phone,
                'Desculpe, tive um problema tecnico. Por favor, tente novamente em instantes.');
        } catch (e) {
            console.error('Erro ao enviar mensagem de erro:', e);
        }
    }
}

module.exports = {
    handleIncomingMessage
};
