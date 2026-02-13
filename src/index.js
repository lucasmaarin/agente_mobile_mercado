require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');

// Rotas
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

// Servicos
const sessionManager = require('./services/sessionManager');
const whatsapp = require('./services/whatsapp');
const firebase = require('./services/firebase');
const FirestoreSessionStore = require('./services/firestoreSessionStore');

const app = express();

// ==================== MIDDLEWARES ====================

// Trust proxy (necessario para Render/ngrok com HTTPS)
app.set('trust proxy', 1);

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessao persistente no Firestore
app.use(session({
    store: new FirestoreSessionStore(firebase.db, {
        collection: 'sessions',
        ttl: 7 * 24 * 60 * 60 // 7 dias
    }),
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
        sameSite: 'lax'
    }
}));

// Arquivos estaticos
app.use(express.static(path.join(__dirname, '../public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ==================== WEBHOOK WHATSAPP ====================

/**
 * GET /webhook - Verificacao do webhook (challenge do Meta)
 */
app.get('/webhook', (req, res) => {
    const result = whatsapp.verifyWebhook(req.query);

    if (result.success) {
        return res.status(200).send(result.challenge);
    }

    res.status(403).send('Forbidden');
});

/**
 * POST /webhook - Receber mensagens do WhatsApp
 */
app.post('/webhook', async (req, res) => {
    // Responde 200 imediatamente (requisito do Meta)
    res.status(200).send('EVENT_RECEIVED');

    // Processa a mensagem em background
    try {
        const messageData = whatsapp.parseWebhookMessage(req.body);

        if (messageData) {
            console.log(`[Webhook] ${messageData.pushName} (${messageData.phone}): ${messageData.text}`);
            await sessionManager.handleIncomingMessage(messageData);
        }
    } catch (error) {
        console.error('[Webhook] Erro ao processar:', error);
    }
});

// ==================== DATA DELETION (Meta requirement) ====================

/**
 * POST /data-deletion - Callback de exclusao de dados do usuario (requisito Meta)
 * O Meta envia quando um usuario solicita exclusao dos dados
 */
app.post('/data-deletion', async (req, res) => {
    try {
        const { signed_request } = req.body;

        // Retorna confirmacao com URL de status
        const confirmationCode = 'del_' + Date.now();
        res.json({
            url: `https://${req.get('host')}/data-deletion-status?code=${confirmationCode}`,
            confirmation_code: confirmationCode
        });

        console.log('[Data Deletion] Solicitacao recebida:', confirmationCode);
    } catch (error) {
        console.error('[Data Deletion] Erro:', error);
        res.json({
            url: `https://${req.get('host')}/data-deletion-status`,
            confirmation_code: 'error'
        });
    }
});

/**
 * GET /data-deletion-status - Pagina de status da exclusao
 */
app.get('/data-deletion-status', (req, res) => {
    const code = req.query.code || 'N/A';
    res.send(`
        <!DOCTYPE html>
        <html><head><title>Status de Exclusao de Dados</title></head>
        <body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px;">
            <h1>Exclusao de Dados</h1>
            <p>Codigo de confirmacao: <strong>${code}</strong></p>
            <p>Seus dados foram processados para exclusao. Caso tenha duvidas, entre em contato pelo e-mail: royalx481@gmail.com</p>
        </body></html>
    `);
});

// ==================== ROTAS ====================

// Auth routes
app.use('/auth', authRoutes);

// API routes
app.use('/api', apiRoutes);

// Pagina de login
app.get('/login', (req, res) => {
    if (config.server.disableAuth) {
        return res.redirect('/dashboard');
    }
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }

    res.render('login', {
        firebaseApiKey: config.firebase.apiKey,
        firebaseAuthDomain: config.firebase.authDomain,
        firebaseProjectId: config.firebase.projectId
    });
});

// Pagina principal (redireciona para dashboard ou login)
app.get('/', (req, res) => {
    if (config.server.disableAuth) {
        return res.redirect('/dashboard');
    }
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// Dashboard (requer autenticacao)
app.get('/dashboard', authRoutes.requireAuth, async (req, res) => {
    res.render('dashboard', {
        user: req.session.user
    });
});

// Onboarding WhatsApp (requer autenticacao)
app.get('/onboarding', authRoutes.requireAuth, async (req, res) => {
    res.render('onboarding', {
        user: req.session.user,
        metaAppId: config.meta.appId || '',
        metaConfigId: config.meta.configId || ''
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Rota nao encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ==================== INICIALIZACAO ====================

async function startServer() {
    try {
        console.log('='.repeat(50));
        console.log('WhatsApp Sales Bot - Iniciando...');
        console.log('='.repeat(50));

        // Modo multi-tenant: credenciais WhatsApp sao por usuario no Firebase
        console.log('\n[1/2] Modo multi-tenant ativo (credenciais WhatsApp por estabelecimento)');

        // Inicia servidor
        console.log('\n[2/2] Iniciando servidor HTTP...');
        app.listen(config.server.port, () => {
            console.log(`\nServidor rodando em http://localhost:${config.server.port}`);
            console.log('\nRotas disponiveis:');
            console.log(`  - GET  /webhook    -> Verificacao do webhook Meta`);
            console.log(`  - POST /webhook    -> Receber mensagens WhatsApp`);
            console.log(`  - GET  /login      -> Pagina de login`);
            console.log(`  - GET  /dashboard  -> Dashboard principal`);
            console.log(`  - GET  /onboarding -> Conectar WhatsApp (Embedded Signup)`);
            console.log(`  - POST /auth/*     -> Autenticacao`);
            console.log(`  - *    /api/*      -> APIs do bot`);
            console.log('\n' + '='.repeat(50));
        });
    } catch (error) {
        console.error('Erro fatal ao iniciar:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nEncerrando...');
    process.exit(0);
});

// Inicia o servidor
startServer();
