const express = require('express');
const router = express.Router();
const firebase = require('../services/firebase');
const sessionManager = require('../services/sessionManager');
const baileys = require('../services/baileys');
const { requireAuth } = require('./auth');

// Todas as rotas requerem autenticacao
router.use(requireAuth);

// ==================== WHATSAPP ====================

/**
 * POST /api/whatsapp/connect
 * Inicia conexao com WhatsApp
 */
router.post('/whatsapp/connect', async (req, res) => {
    try {
        const userId = req.session.userId;

        // Inicia sessao
        await sessionManager.startSession(userId);

        res.json({
            success: true,
            message: 'Iniciando conexao...'
        });
    } catch (error) {
        console.error('Erro ao conectar WhatsApp:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/whatsapp/status
 * Retorna status da conexao e QR Code se disponivel
 */
router.get('/whatsapp/status', async (req, res) => {
    try {
        const userId = req.session.userId;
        const status = sessionManager.getSessionStatus(userId);
        const user = await firebase.getUser(userId);

        res.json({
            ...status,
            whatsapp_connected: user?.whatsapp_connected || false
        });
    } catch (error) {
        console.error('Erro ao obter status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/whatsapp/disconnect
 * Desconecta do WhatsApp
 */
router.post('/whatsapp/disconnect', async (req, res) => {
    try {
        const userId = req.session.userId;
        await sessionManager.stopSession(userId);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao desconectar:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/whatsapp/send
 * Envia mensagem para um numero
 */
router.post('/whatsapp/send', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone e message sao obrigatorios' });
        }

        await baileys.sendMessage(userId, phone, message);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: error.message });
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
            whatsapp_connected: user.whatsapp_connected
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
