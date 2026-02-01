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

    // App defaults
    defaults: {
        companyId: process.env.COMPANY_ID,
        companyName: process.env.COMPANY_NAME || 'Minha Loja',
        deliveryPrice: parseFloat(process.env.DELIVERY_PRICE) || 5.00
    },

    // Server
    server: {
        port: parseInt(process.env.PORT) || 3000,
        sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production'
    },

    // Debug
    debug: process.env.DEBUG === 'true'
};
