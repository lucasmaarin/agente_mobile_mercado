require('dotenv').config();

module.exports = {
    // OpenAI
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini'
    },

    // Firebase
    firebase: {
        credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH,
        projectId: process.env.FIREBASE_PROJECT_ID,
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN
    },

    // WhatsApp Business Cloud API (configs globais - credenciais sao por usuario no Firebase)
    whatsapp: {
        verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'zerograu_webhook_token',
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0'
    },

    // Meta App (para Embedded Signup)
    meta: {
        appId: process.env.META_APP_ID,
        appSecret: process.env.META_APP_SECRET
    },

    // App defaults
    defaults: {
        companyId: process.env.COMPANY_ID,
        companyName: process.env.COMPANY_NAME || 'Minha Loja',
        deliveryPrice: parseFloat(process.env.DELIVERY_PRICE) || 5.00
    },

    // Server
    server: {
        port: parseInt(process.env.PORT) || 3000,
        sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
        disableAuth: process.env.DISABLE_AUTH === 'true',
        defaultUserId: process.env.DEFAULT_USER_ID || 'local-admin',
        defaultUserEmail: process.env.DEFAULT_USER_EMAIL || 'local@local',
        defaultUserName: process.env.DEFAULT_USER_NAME || 'Local Admin'
    },

    // Debug
    debug: process.env.DEBUG === 'true'
};
