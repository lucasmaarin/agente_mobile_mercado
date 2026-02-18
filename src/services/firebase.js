const admin = require('firebase-admin');
const config = require('../config');
const path = require('path');
const fs = require('fs');

// Inicializa Firebase Admin
// Suporta credenciais via variavel de ambiente (Render/producao) ou arquivo (local)
let credential;

if (process.env.FIREBASE_CREDENTIALS_JSON) {
    // Producao: credenciais via variavel de ambiente (JSON string)
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
    credential = admin.credential.cert(serviceAccount);
} else if (config.firebase.credentialsPath && fs.existsSync(path.resolve(config.firebase.credentialsPath))) {
    // Local: credenciais via arquivo (somente se o arquivo existir)
    const serviceAccount = require(path.resolve(config.firebase.credentialsPath));
    credential = admin.credential.cert(serviceAccount);
} else {
    throw new Error('Firebase credentials not configured. Set FIREBASE_CREDENTIALS_JSON env var or provide firebase-credentials.json file');
}

admin.initializeApp({ credential });

const db = admin.firestore();

const PRODUCTS_CACHE_TTL_MS = parseInt(process.env.PRODUCTS_CACHE_TTL_MS || '60000', 10);
const productsCache = new Map();

// Cache de mapeamento phone_number_id → userId para performance
const phoneNumberIdCache = new Map();
const PHONE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// ==================== USERS ====================

async function getUser(userId) {
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) return null;

    const data = doc.data();

    // Aplica defaults do agent_settings (sempre, mesmo se nao existir)
    const defaults = {
        agent_name: 'Max',
        company_name: config.defaults.companyName,
        company_id: config.defaults.companyId,
        delivery_price: config.defaults.deliveryPrice,
        welcome_message: 'Ola! Sou o Max, assistente virtual. Como posso ajudar?',
        active: true
    };
    data.agent_settings = { ...defaults, ...(data.agent_settings || {}) };

    if (!doc.data().agent_settings?.company_id && config.defaults.companyId) {
        await db.collection('users').doc(userId).update({
            'agent_settings.company_id': config.defaults.companyId
        });
    }

    return { id: doc.id, ...data };
}

async function createUser(userId, data) {
    const defaultData = {
        email: data.email || '',
        name: data.name || '',
        whatsapp_connected: false,
        agent_settings: {
            agent_name: 'Max',
            company_name: config.defaults.companyName,
            company_id: config.defaults.companyId,
            delivery_price: config.defaults.deliveryPrice,
            welcome_message: 'Ola! Sou o Max, assistente virtual. Como posso ajudar?',
            active: true
        },
        stats: {
            messages_today: 0,
            total_messages: 0,
            orders_count: 0
        },
        created_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(userId).set({ ...defaultData, ...data }, { merge: true });
    return getUser(userId);
}

async function updateUser(userId, data) {
    await db.collection('users').doc(userId).update(data);
    return getUser(userId);
}

async function updateWhatsAppStatus(userId, connected) {
    await db.collection('users').doc(userId).update({
        whatsapp_connected: connected,
        last_connection: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function updateAgentSettings(userId, settings) {
    await db.collection('users').doc(userId).update({
        agent_settings: settings
    });
}

async function incrementMessageCount(userId) {
    await db.collection('users').doc(userId).update({
        'stats.messages_today': admin.firestore.FieldValue.increment(1),
        'stats.total_messages': admin.firestore.FieldValue.increment(1)
    });
}

async function incrementOrderCount(userId) {
    await db.collection('users').doc(userId).update({
        'stats.orders_count': admin.firestore.FieldValue.increment(1)
    });
}

// ==================== CONVERSATIONS ====================

async function getConversation(userId, phone) {
    const doc = await db.collection('users').doc(userId)
        .collection('conversations').doc(phone).get();

    if (!doc.exists) return null;
    return { phone: doc.id, ...doc.data() };
}

async function saveConversation(userId, phone, messages, cart = [], customerData = null) {
    const data = {
        messages,
        cart,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Salva dados do cliente se fornecido
    if (customerData) {
        data.customerData = customerData;
    }

    await db.collection('users').doc(userId)
        .collection('conversations').doc(phone).set(data, { merge: true });
}

async function saveAutomationConversation(userId, phone, messages, cart = [], customerData = null, agentSettings = null) {
    const rootRef = db.collection('Automacoes').doc(userId);
    const rootData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (agentSettings) {
        rootData.agent_settings = agentSettings;
    }

    await rootRef.set(rootData, { merge: true });

    const convData = {
        messages,
        cart,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (customerData) {
        convData.customerData = customerData;
    }

    await rootRef.collection('conversations').doc(phone).set(convData, { merge: true });
}

async function getRecentConversations(userId, limit = 20) {
    const snapshot = await db.collection('users').doc(userId)
        .collection('conversations')
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        phone: doc.id,
        ...doc.data()
    }));
}

async function clearConversation(userId, phone) {
    await db.collection('users').doc(userId)
        .collection('conversations').doc(phone).delete();
}

// ==================== PRODUCTS ====================
// Busca de: estabelecimentos/{companyId}/Products

async function getProducts(companyId, limit = 50) {
    if (!companyId || typeof companyId !== 'string') {
        console.warn('getProducts: companyId invalido');
        return [];
    }

    const cacheKey = `${companyId}`;
    const cached = productsCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.fetchedAt) < PRODUCTS_CACHE_TTL_MS && cached.items.length >= limit) {
        return cached.items.slice(0, limit);
    }

    const snapshot = await db.collection('estabelecimentos').doc(companyId)
        .collection('Products')
        .where('isActive', '==', true)
        .where('isTrashed', '==', false)
        .limit(limit)
        .get();

    const items = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            name: data.name,
            description: data.description,
            price: data.currentPrice || data.agranelValue || 0,
            category: data.shelves?.[0]?.categoryName || 'Geral',
            subcategory: data.shelves?.[0]?.subcategoryName || '',
            image: data.images?.[0]?.fileUrl || null,
            unityType: data.unityType || 'unidade',
            barCode: data.barCode
        };
    });

    productsCache.set(cacheKey, { items, fetchedAt: now });
    return items;
}

async function searchProducts(companyId, query) {
    if (!companyId || !query) return [];

    const products = await getProducts(companyId, 100);
    const queryLower = query.toLowerCase();

    return products.filter(p =>
        p.name?.toLowerCase().includes(queryLower) ||
        p.description?.toLowerCase().includes(queryLower) ||
        p.category?.toLowerCase().includes(queryLower)
    ).slice(0, 10);
}

async function getProductById(companyId, productId) {
    if (!companyId || !productId) return null;

    const doc = await db.collection('estabelecimentos').doc(companyId)
        .collection('Products').doc(productId).get();

    if (!doc.exists) return null;

    const data = doc.data();
    return {
        id: doc.id,
        name: data.name,
        description: data.description,
        price: data.currentPrice || data.agranelValue || 0,
        category: data.shelves?.[0]?.categoryName || 'Geral',
        subcategory: data.shelves?.[0]?.subcategoryName || '',
        image: data.images?.[0]?.fileUrl || null,
        unityType: data.unityType || 'unidade',
        barCode: data.barCode,
        // Dados completos para o pedido
        _raw: data
    };
}

// ==================== ORDERS (PurchaseRequests) ====================

async function getNextOrderNumber(companyId) {
    // Busca ultimo pedido para gerar proximo numero
    const snapshot = await db.collection('PurchaseRequests')
        .where('companyReference', '==', db.doc(`estabelecimentos/${companyId}`))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        return '000001';
    }

    const lastOrder = snapshot.docs[0].data();
    const lastNumber = parseInt(lastOrder.orderNumber || '0', 10);
    return String(lastNumber + 1).padStart(6, '0');
}

async function createPurchaseRequest(companyId, customerData, cart, deliveryPrice = 0) {
    const now = admin.firestore.Timestamp.now();
    const orderNumber = await getNextOrderNumber(companyId);

    // Calcula totais
    const price = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const total = price + deliveryPrice;

    // Monta produtos do carrinho no formato correto
    const productsCart = cart.map(item => ({
        id: item.id,
        quantity: item.quantity,
        observationIsPermited: false,
        observations: null,
        companyRef: db.doc(`estabelecimentos/${companyId}`),
        productRef: db.doc(`estabelecimentos/${companyId}/Products/${item.id}`),
        product: {
            id: item.id,
            name: item.name,
            description: item.description || '',
            price: item.price,
            previewPrice: 0,
            unitType: `ProductUnitType.${item.unityType || 'unidade'}`,
            unitQuantity: 1,
            images: item.image ? [{
                fileUrl: item.image,
                fileName: '',
                folderPath: '',
                reference: null,
                itsFromPlatform: true,
                quality: 100
            }] : [],
            barCode: item.barCode || ''
        }
    }));

    // Monta endereco
    const address = {
        street: customerData.street || '',
        number: customerData.number || '',
        complement: customerData.complement || '',
        neighborhood: customerData.neighborhood || '',
        city: customerData.city || '',
        state: customerData.state || '',
        uf: customerData.uf || '',
        zipCode: customerData.zipCode || '',
        reference: customerData.reference || '',
        name: `${customerData.street}, ${customerData.number}, ${customerData.neighborhood}`,
        fullAddress: `${customerData.street}, Nº ${customerData.number}, ${customerData.neighborhood}, ${customerData.city}, ${customerData.state}, CEP ${customerData.zipCode}.`,
        position: customerData.position || new admin.firestore.GeoPoint(0, 0),
        createAt: now,
        updateAt: now,
        id: ''
    };

    // Estrutura completa do pedido
    const purchaseRequest = {
        // Identificacao
        id: '', // Sera preenchido apos criar
        orderNumber,

        // Cliente
        clientId: customerData.oderId || '',
        clientName: customerData.name || 'Cliente WhatsApp',
        clientReference: customerData.clientRef || null,

        // Empresa
        companyReference: db.doc(`estabelecimentos/${companyId}`),
        companyName: '',
        companyAddress: '',
        companyImageUrl: '',

        // Endereco de entrega
        address,

        // Produtos
        productsCart,

        // Valores
        price,
        deliveryPrice,
        total,

        // Status
        currentPurchaseStatus: 'PurchaseStatus.pending',
        statusList: [{
            purchaseStatus: 'PurchaseStatus.pending',
            createdAt: now
        }],

        // Pagamento
        purchasePayment: {
            paymentType: customerData.paymentType || 'PaymentType.cash',
            paymentValue: 0,
            valueBack: null
        },

        // Agendamento
        scheduling: null,
        schedule: null,
        estimatedTimeDelivery: {
            date: now,
            intervalMinutes: 60
        },

        // Entregador
        deliveryPerson: {
            name: '',
            email: '',
            phone: ''
        },

        // Outros
        cancelReason: '',
        codeConfirmation: '',
        documentInNote: null,
        review: null,
        chatReference: null,
        schedulerRef: null,

        // Timestamps
        createdAt: now,
        updatedAt: null
    };

    // Cria o documento
    const ref = await db.collection('PurchaseRequests').add(purchaseRequest);

    // Atualiza o ID
    await ref.update({ id: ref.id });

    return {
        id: ref.id,
        orderNumber,
        total,
        status: 'pending'
    };
}

async function getOrders(userId, limit = 50) {
    const snapshot = await db.collection('users').doc(userId)
        .collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

// ==================== STATS ====================

async function resetDailyStats() {
    const batch = db.batch();
    const usersSnapshot = await db.collection('users').get();

    usersSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { 'stats.messages_today': 0 });
    });

    await batch.commit();
}

async function getStats(userId) {
    const user = await getUser(userId);
    if (!user) return null;

    return {
        ...user.stats
    };
}

// ==================== USERS BY AUTH ID ====================

/**
 * Busca usuario na coleção Users (Web Gerenciador) pelo uid do Firebase Auth.
 * Os docs nessa coleção usam UUID customizado como ID, com campo userAuthId = uid do Auth.
 */
async function getUserByAuthId(authUid) {
    const snapshot = await db.collection('Users')
        .where('userAuthId', '==', authUid)
        .limit(1)
        .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
}

// ==================== WHATSAPP CREDENTIALS ====================

async function getUserByPhoneNumberId(phoneNumberId) {
    if (!phoneNumberId) return null;

    // Verifica cache
    const cached = phoneNumberIdCache.get(phoneNumberId);
    if (cached && (Date.now() - cached.fetchedAt) < PHONE_CACHE_TTL_MS) {
        return cached.user;
    }

    // Query no Firestore
    const snapshot = await db.collection('users')
        .where('whatsapp.phone_number_id', '==', phoneNumberId)
        .limit(1)
        .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Aplica defaults do agent_settings (sempre, mesmo se nao existir)
    const defaults = {
        agent_name: 'Max',
        company_name: config.defaults.companyName,
        company_id: config.defaults.companyId,
        delivery_price: config.defaults.deliveryPrice,
        welcome_message: 'Ola! Sou o Max, assistente virtual. Como posso ajudar?',
        active: true
    };
    data.agent_settings = { ...defaults, ...(data.agent_settings || {}) };

    const user = { id: doc.id, ...data };

    // Salva no cache
    phoneNumberIdCache.set(phoneNumberId, { user, fetchedAt: Date.now() });

    return user;
}

async function saveWhatsAppCredentials(userId, credentials) {
    const data = {
        whatsapp: {
            phone_number_id: credentials.phone_number_id,
            access_token: credentials.access_token,
            business_account_id: credentials.business_account_id || '',
            phone_number: credentials.phone_number || '',
            connected_at: admin.firestore.FieldValue.serverTimestamp()
        }
    };

    await db.collection('users').doc(userId).update(data);

    // Invalida cache
    phoneNumberIdCache.delete(credentials.phone_number_id);

    return data.whatsapp;
}

async function removeWhatsAppCredentials(userId) {
    // Busca user para invalidar cache
    const user = await getUser(userId);
    if (user?.whatsapp?.phone_number_id) {
        phoneNumberIdCache.delete(user.whatsapp.phone_number_id);
    }

    await db.collection('users').doc(userId).update({
        whatsapp: admin.firestore.FieldValue.delete()
    });
}

module.exports = {
    db,
    admin,
    // Users
    getUser,
    getUserByAuthId,
    createUser,
    updateUser,
    updateWhatsAppStatus,
    updateAgentSettings,
    incrementMessageCount,
    incrementOrderCount,
    // WhatsApp Credentials
    getUserByPhoneNumberId,
    saveWhatsAppCredentials,
    removeWhatsAppCredentials,
    // Conversations
    getConversation,
    saveConversation,
    saveAutomationConversation,
    getRecentConversations,
    clearConversation,
    // Products
    getProducts,
    searchProducts,
    getProductById,
    // Orders
    createPurchaseRequest,
    getNextOrderNumber,
    getOrders,
    // Stats
    resetDailyStats,
    getStats
};
