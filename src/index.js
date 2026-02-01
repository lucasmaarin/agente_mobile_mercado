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

const app = express();

// ==================== MIDDLEWARES ====================

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessao
app.use(session({
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Mude para true em producao com HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
    }
}));

// Arquivos estaticos
app.use(express.static(path.join(__dirname, '../public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ==================== ROTAS ====================

// Auth routes
app.use('/auth', authRoutes);

// API routes
app.use('/api', apiRoutes);

// Pagina de login
app.get('/login', (req, res) => {
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

        // Reconecta sessoes salvas
        console.log('\n[1/2] Verificando sessoes salvas...');
        await sessionManager.reconnectSavedSessions();

        // Inicia servidor
        console.log('\n[2/2] Iniciando servidor HTTP...');
        app.listen(config.server.port, () => {
            console.log(`\nServidor rodando em http://localhost:${config.server.port}`);
            console.log('\nRotas disponiveis:');
            console.log(`  - GET  /login     -> Pagina de login`);
            console.log(`  - GET  /dashboard -> Dashboard principal`);
            console.log(`  - POST /auth/*    -> Autenticacao`);
            console.log(`  - *    /api/*     -> APIs do bot`);
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

    const sessions = sessionManager.getActiveSessions();
    for (const session of sessions) {
        try {
            await sessionManager.stopSession(session.userId);
        } catch (e) {
            // Ignora erros ao encerrar
        }
    }

    process.exit(0);
});

// Inicia o servidor
startServer();
