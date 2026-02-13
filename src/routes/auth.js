const express = require('express');
const router = express.Router();
const firebase = require('../services/firebase');
const config = require('../config');

/**
 * POST /auth/login
 * Processa login via Firebase Auth (token do frontend)
 */
router.post('/login', async (req, res) => {
    try {
        if (config.server.disableAuth) {
            const uid = config.server.defaultUserId;
            let user = await firebase.getUser(uid);
            if (!user) {
                user = await firebase.createUser(uid, {
                    email: config.server.defaultUserEmail,
                    name: config.server.defaultUserName,
                    auth_provider: 'disabled'
                });
            }

            req.session.userId = uid;
            req.session.user = {
                id: uid,
                email: user.email,
                name: user.name
            };

            return res.json({
                success: true,
                user: {
                    id: uid,
                    email: user.email,
                    name: user.name
                }
            });
        }

        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'Token nao fornecido' });
        }

        // Verifica token com Firebase Admin
        const decodedToken = await firebase.admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Busca ou cria usuario
        let user = await firebase.getUser(uid);

        if (!user) {
            // Pega nome do token (Google) ou do displayName (email/senha)
            const displayName = decodedToken.name || decodedToken.displayName || decodedToken.email?.split('@')[0];

            user = await firebase.createUser(uid, {
                email: decodedToken.email,
                name: displayName,
                auth_provider: decodedToken.firebase?.sign_in_provider || 'unknown'
            });
        } else {
            // Atualiza nome se mudou (ex: usuario atualizou perfil)
            const newName = decodedToken.name || decodedToken.displayName;
            if (newName && newName !== user.name) {
                await firebase.updateUser(uid, { name: newName });
                user.name = newName;
            }
        }

        // Salva na sessao
        req.session.userId = uid;
        req.session.user = {
            id: uid,
            email: user.email,
            name: user.name
        };

        res.json({
            success: true,
            user: {
                id: uid,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(401).json({ error: 'Token invalido' });
    }
});

/**
 * POST /auth/logout
 * Encerra sessao
 */
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao fazer logout' });
        }
        res.json({ success: true });
    });
});

/**
 * GET /auth/me
 * Retorna usuario logado
 */
router.get('/me', (req, res) => {
    if (config.server.disableAuth) {
        return res.json({
            user: {
                id: config.server.defaultUserId,
                email: config.server.defaultUserEmail,
                name: config.server.defaultUserName
            }
        });
    }

    if (!req.session.userId) {
        return res.status(401).json({ error: 'Nao autenticado' });
    }

    res.json({
        user: req.session.user
    });
});

/**
 * Middleware de autenticacao
 */
async function requireAuth(req, res, next) {
    try {
        if (config.server.disableAuth) {
            if (!req.session.userId) {
                const uid = config.server.defaultUserId;
                let user = await firebase.getUser(uid);
                if (!user) {
                    user = await firebase.createUser(uid, {
                        email: config.server.defaultUserEmail,
                        name: config.server.defaultUserName,
                        auth_provider: 'disabled'
                    });
                }

                req.session.userId = uid;
                req.session.user = {
                    id: uid,
                    email: user.email,
                    name: user.name
                };
            }

            return next();
        }

        if (!req.session.userId) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(401).json({ error: 'Nao autenticado' });
            }
            return res.redirect('/login');
        }
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
