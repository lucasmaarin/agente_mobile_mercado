const express = require('express');
const axios = require('axios');
const router = express.Router();
const firebase = require('../services/firebase');
const whatsapp = require('../services/whatsapp');
const config = require('../config');
const { requireAuth } = require('./auth');

// Todas as rotas requerem autenticacao
router.use(requireAuth);

// ==================== WHATSAPP ONBOARDING ====================

/**
 * DELETE /api/whatsapp/unregister
 * Remove credenciais WhatsApp do usuario logado
 */
router.delete('/whatsapp/unregister', async (req, res) => {
    try {
        const userId = req.session.userId;
        await firebase.removeWhatsAppCredentials(userId);
        await firebase.updateWhatsAppStatus(userId, false);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao remover WhatsApp:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/whatsapp/status
 * Retorna status da configuracao WhatsApp do usuario logado
 */
router.get('/whatsapp/status', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await firebase.getUser(userId);

        if (!user?.whatsapp?.phone_number_id) {
            return res.json({ status: 'not_configured', whatsapp: null });
        }

        res.json({
            status: 'configured',
            whatsapp: {
                phone_number_id: '***' + user.whatsapp.phone_number_id.slice(-4),
                phone_number: user.whatsapp.phone_number || '',
                connected_at: user.whatsapp.connected_at
            }
        });
    } catch (error) {
        console.error('Erro ao obter status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/whatsapp/link
 * Retorna link wa.me do numero do estabelecimento
 */
router.get('/whatsapp/link', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await firebase.getUser(userId);

        if (!user?.whatsapp?.phone_number) {
            return res.status(400).json({ error: 'Numero WhatsApp nao configurado' });
        }

        const phone = user.whatsapp.phone_number.replace(/[^0-9]/g, '');
        const link = `https://wa.me/${phone}`;

        res.json({ link, phone: user.whatsapp.phone_number });
    } catch (error) {
        console.error('Erro ao gerar link:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/whatsapp/send
 * Envia mensagem para um numero usando as credenciais do usuario logado
 */
router.post('/whatsapp/send', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone e message sao obrigatorios' });
        }

        const user = await firebase.getUser(userId);
        if (!user?.whatsapp?.access_token) {
            return res.status(400).json({ error: 'WhatsApp nao configurado para este usuario' });
        }

        const credentials = {
            accessToken: user.whatsapp.access_token,
            phoneNumberId: user.whatsapp.phone_number_id
        };

        await whatsapp.sendMessage(credentials, phone, message);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== EMBEDDED SIGNUP ====================

/**
 * POST /api/whatsapp/embedded-signup
 * Recebe o code do Facebook Login (Embedded Signup) e troca por token + phone_number_id
 *
 * Fluxo:
 * 1. Frontend abre popup do Facebook Login com WhatsApp Embedded Signup
 * 2. Usuario conecta sua conta Meta Business e registra numero
 * 3. Frontend recebe um 'code' e envia para esta rota
 * 4. Backend troca code por access_token
 * 5. Backend busca WABA ID e phone_number_id
 * 6. Salva tudo no Firebase
 */
router.post('/whatsapp/embedded-signup', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'code e obrigatorio' });
        }

        if (!config.meta.appId || !config.meta.appSecret) {
            return res.status(500).json({ error: 'META_APP_ID e META_APP_SECRET nao configurados no servidor' });
        }

        // 1. Trocar code por access_token
        const tokenResponse = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
            params: {
                client_id: config.meta.appId,
                client_secret: config.meta.appSecret,
                code: code
            }
        });

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            return res.status(400).json({ error: 'Falha ao obter access_token do Meta' });
        }

        // 2. Buscar informacoes de debug do token para pegar o WABA ID
        //    O Embedded Signup associa o token a um WhatsApp Business Account
        const debugResponse = await axios.get('https://graph.facebook.com/v21.0/debug_token', {
            params: {
                input_token: accessToken,
                access_token: `${config.meta.appId}|${config.meta.appSecret}`
            }
        });

        const granularScopes = debugResponse.data.data?.granular_scopes || [];
        const wabaScope = granularScopes.find(s => s.scope === 'whatsapp_business_management');
        const wabaId = wabaScope?.target_ids?.[0];

        if (!wabaId) {
            return res.status(400).json({
                error: 'Nao foi possivel encontrar o WhatsApp Business Account. Certifique-se de completar o fluxo de registro.'
            });
        }

        // 3. Buscar phone numbers do WABA
        const phonesResponse = await axios.get(
            `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        const phoneNumbers = phonesResponse.data.data || [];
        if (phoneNumbers.length === 0) {
            return res.status(400).json({
                error: 'Nenhum numero de telefone encontrado na conta. Complete o registro do numero no fluxo.'
            });
        }

        // Usa o primeiro numero (geralmente o que acabou de ser registrado)
        const phoneData = phoneNumbers[0];
        const phoneNumberId = phoneData.id;
        const displayPhoneNumber = phoneData.display_phone_number;

        // 4. Registrar o webhook para este WABA (inscreve o app)
        try {
            await axios.post(
                `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
                {},
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            console.log(`[EmbeddedSignup] App inscrito no WABA ${wabaId}`);
        } catch (subErr) {
            console.error('[EmbeddedSignup] Erro ao inscrever app no WABA:', subErr.response?.data || subErr.message);
        }

        // 5. Salvar credenciais no Firebase
        await firebase.saveWhatsAppCredentials(userId, {
            access_token: accessToken,
            phone_number_id: phoneNumberId,
            business_account_id: wabaId,
            phone_number: displayPhoneNumber
        });

        res.json({
            success: true,
            whatsapp: {
                phone_number_id: phoneNumberId,
                phone_number: displayPhoneNumber,
                business_account_id: wabaId,
                status: 'connected'
            }
        });
    } catch (error) {
        const metaError = error.response?.data?.error;
        console.error('Erro no Embedded Signup:', metaError || error.message);
        res.status(500).json({
            error: metaError?.message || error.message
        });
    }
});

// ==================== CONFIGURACOES ====================

/**
 * GET /api/settings
 * Retorna configuracoes do agente
 */
router.get('/settings', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await firebase.getUser(userId);

        if (!user) {
            return res.status(404).json({ error: 'Usuario nao encontrado' });
        }

        res.json({
            agent_settings: user.agent_settings,
            whatsapp_configured: !!user.whatsapp?.phone_number_id
        });
    } catch (error) {
        console.error('Erro ao obter configuracoes:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/settings
 * Atualiza configuracoes do agente
 */
router.put('/settings', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { agent_name, company_name, delivery_price, welcome_message, active, company_id } = req.body;

        const user = await firebase.getUser(userId);
        const currentSettings = user.agent_settings || {};

        const newSettings = {
            ...currentSettings,
            agent_name: agent_name ?? currentSettings.agent_name,
            company_name: company_name ?? currentSettings.company_name,
            company_id: company_id ?? currentSettings.company_id,
            delivery_price: delivery_price !== undefined ? parseFloat(delivery_price) : currentSettings.delivery_price,
            welcome_message: welcome_message ?? currentSettings.welcome_message,
            active: active !== undefined ? active : currentSettings.active
        };

        await firebase.updateAgentSettings(userId, newSettings);

        res.json({
            success: true,
            agent_settings: newSettings
        });
    } catch (error) {
        console.error('Erro ao atualizar configuracoes:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/toggle-agent
 * Liga/desliga o agente
 */
router.post('/settings/toggle-agent', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await firebase.getUser(userId);

        const newActive = !user.agent_settings?.active;

        await firebase.updateAgentSettings(userId, {
            ...user.agent_settings,
            active: newActive
        });

        res.json({
            success: true,
            active: newActive
        });
    } catch (error) {
        console.error('Erro ao alternar agente:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== CONVERSAS ====================

/**
 * GET /api/conversations
 * Lista conversas recentes
 */
router.get('/conversations', async (req, res) => {
    try {
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 20;

        const conversations = await firebase.getRecentConversations(userId, limit);

        res.json({ conversations });
    } catch (error) {
        console.error('Erro ao listar conversas:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/conversations/:phone
 * Retorna conversa especifica
 */
router.get('/conversations/:phone', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { phone } = req.params;

        const conversation = await firebase.getConversation(userId, phone);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversa nao encontrada' });
        }

        res.json({ conversation });
    } catch (error) {
        console.error('Erro ao obter conversa:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/conversations/:phone
 * Remove conversa
 */
router.delete('/conversations/:phone', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { phone } = req.params;

        await firebase.clearConversation(userId, phone);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao remover conversa:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== PEDIDOS ====================

/**
 * GET /api/orders
 * Lista pedidos
 */
router.get('/orders', async (req, res) => {
    try {
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 50;

        const orders = await firebase.getOrders(userId, limit);

        res.json({ orders });
    } catch (error) {
        console.error('Erro ao listar pedidos:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ESTATISTICAS ====================

/**
 * GET /api/stats
 * Retorna estatisticas
 */
router.get('/stats', async (req, res) => {
    try {
        const userId = req.session.userId;
        const stats = await firebase.getStats(userId);

        res.json({ stats });
    } catch (error) {
        console.error('Erro ao obter estatisticas:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== PRODUTOS ====================

/**
 * GET /api/products
 * Lista produtos da empresa
 */
router.get('/products', async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await firebase.getUser(userId);
        const companyId = user.agent_settings?.company_id;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID nao configurado' });
        }

        const products = await firebase.getProducts(companyId);

        res.json({ products });
    } catch (error) {
        console.error('Erro ao listar produtos:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/products/search
 * Busca produtos
 */
router.get('/products/search', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Query de busca obrigatoria' });
        }

        const user = await firebase.getUser(userId);
        const companyId = user.agent_settings?.company_id;

        const products = await firebase.searchProducts(companyId, q);

        res.json({ products });
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
