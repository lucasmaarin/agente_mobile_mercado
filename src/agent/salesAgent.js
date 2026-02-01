const openaiService = require('../services/openai');
const firebase = require('../services/firebase');

// Estados do fluxo de pedido
const FLOW_STATES = {
    BROWSING: 'browsing',           // Navegando/comprando
    COLLECTING_NAME: 'collecting_name',
    COLLECTING_STREET: 'collecting_street',
    COLLECTING_NUMBER: 'collecting_number',
    COLLECTING_NEIGHBORHOOD: 'collecting_neighborhood',
    COLLECTING_CITY: 'collecting_city',
    COLLECTING_ZIPCODE: 'collecting_zipcode',
    COLLECTING_COMPLEMENT: 'collecting_complement',
    COLLECTING_REFERENCE: 'collecting_reference',
    COLLECTING_PAYMENT: 'collecting_payment',
    CONFIRMING_ORDER: 'confirming_order',
    ORDER_COMPLETED: 'order_completed'
};

const PAYMENT_TYPES = {
    '1': 'PaymentType.cash',
    '2': 'PaymentType.creditcard',
    '3': 'PaymentType.debitcard',
    '4': 'PaymentType.pix'
};

/**
 * Gera o prompt do sistema
 */
function buildSystemPrompt(settings, products, cart, flowState, customerData) {
    const productsList = products.length > 0
        ? products.slice(0, 20).map(p => `- ${p.name}: R$ ${p.price.toFixed(2)} (ID: ${p.id})`).join('\n')
        : 'Nenhum produto disponivel';

    const cartList = cart.length > 0
        ? cart.map(item => `- ${item.quantity}x ${item.name} = R$ ${(item.price * item.quantity).toFixed(2)}`).join('\n')
        : 'Vazio';

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryPrice = settings.delivery_price || 0;
    const totalWithDelivery = cartTotal + deliveryPrice;

    let stateInstructions = '';

    if (flowState === FLOW_STATES.BROWSING) {
        stateInstructions = `
ESTADO ATUAL: Cliente navegando/comprando
- Ajude a encontrar produtos
- Para adicionar: responda e inclua [ADD:ID_PRODUTO:QUANTIDADE]
- Para remover: responda e inclua [REMOVE:ID_PRODUTO]
- Quando cliente quiser FINALIZAR/FECHAR pedido: responda e inclua [START_CHECKOUT]`;
    } else if (flowState === FLOW_STATES.CONFIRMING_ORDER) {
        stateInstructions = `
ESTADO ATUAL: Confirmando pedido
Dados coletados:
- Nome: ${customerData?.name || 'N/A'}
- Endereco: ${customerData?.street}, ${customerData?.number}
- Bairro: ${customerData?.neighborhood}
- Cidade: ${customerData?.city}
- CEP: ${customerData?.zipCode}
- Complemento: ${customerData?.complement || 'N/A'}
- Referencia: ${customerData?.reference || 'N/A'}
- Pagamento: ${customerData?.paymentType || 'N/A'}

Pergunte se esta tudo certo. Se SIM: [CONFIRM_ORDER]. Se NAO: [CANCEL_CHECKOUT]`;
    }

    return `Voce e ${settings.agent_name}, assistente de vendas da ${settings.company_name}.

REGRAS:
- Respostas CURTAS (2-3 linhas)
- Seja simpatico e direto
- Use 1-2 emojis por mensagem

PRODUTOS DISPONIVEIS:
${productsList}

CARRINHO ATUAL:
${cartList}
${cart.length > 0 ? `\nSubtotal: R$ ${cartTotal.toFixed(2)} | Entrega: R$ ${deliveryPrice.toFixed(2)} | TOTAL: R$ ${totalWithDelivery.toFixed(2)}` : ''}
${stateInstructions}`;
}

/**
 * Processa mensagem do cliente
 */
async function processMessage(userId, phone, text, pushName, user) {
    const settings = user.agent_settings || {};
    const companyId = settings.company_id;

    // Busca conversa e produtos em paralelo
    const [conversation, products] = await Promise.all([
        firebase.getConversation(userId, phone),
        firebase.getProducts(companyId)
    ]);

    let messages = conversation?.messages || [];
    let cart = conversation?.cart || [];
    let customerData = conversation?.customerData || {};
    let flowState = customerData.flowState || FLOW_STATES.BROWSING;

    // Limita historico
    if (messages.length > 10) {
        messages = messages.slice(-10);
    }

    let response = '';

    // Processa de acordo com o estado do fluxo
    if (flowState === FLOW_STATES.BROWSING) {
        response = await handleBrowsingState(settings, products, cart, messages, text, customerData);
    } else if (flowState === FLOW_STATES.COLLECTING_NAME) {
        customerData.name = text.trim();
        flowState = FLOW_STATES.COLLECTING_STREET;
        response = `Otimo, ${customerData.name}! Agora me diz o nome da sua rua:`;
    } else if (flowState === FLOW_STATES.COLLECTING_STREET) {
        customerData.street = text.trim();
        flowState = FLOW_STATES.COLLECTING_NUMBER;
        response = 'Qual o numero da casa/apartamento?';
    } else if (flowState === FLOW_STATES.COLLECTING_NUMBER) {
        customerData.number = text.trim();
        flowState = FLOW_STATES.COLLECTING_NEIGHBORHOOD;
        response = 'Qual o bairro?';
    } else if (flowState === FLOW_STATES.COLLECTING_NEIGHBORHOOD) {
        customerData.neighborhood = text.trim();
        flowState = FLOW_STATES.COLLECTING_CITY;
        response = 'Qual a cidade?';
    } else if (flowState === FLOW_STATES.COLLECTING_CITY) {
        customerData.city = text.trim();
        // Extrai UF se informado junto (ex: "Sao Paulo - SP")
        const match = text.match(/[\s-]+([A-Z]{2})$/i);
        if (match) {
            customerData.uf = match[1].toUpperCase();
            customerData.city = text.replace(/[\s-]+[A-Z]{2}$/i, '').trim();
        }
        flowState = FLOW_STATES.COLLECTING_ZIPCODE;
        response = 'Qual o CEP?';
    } else if (flowState === FLOW_STATES.COLLECTING_ZIPCODE) {
        customerData.zipCode = text.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
        flowState = FLOW_STATES.COLLECTING_COMPLEMENT;
        response = 'Tem algum complemento? (apt, bloco, etc.) Se nao tiver, digite "nao"';
    } else if (flowState === FLOW_STATES.COLLECTING_COMPLEMENT) {
        customerData.complement = text.toLowerCase() === 'nao' ? '' : text.trim();
        flowState = FLOW_STATES.COLLECTING_REFERENCE;
        response = 'Algum ponto de referencia? (proximo a...) Se nao tiver, digite "nao"';
    } else if (flowState === FLOW_STATES.COLLECTING_REFERENCE) {
        customerData.reference = text.toLowerCase() === 'nao' ? '' : text.trim();
        flowState = FLOW_STATES.COLLECTING_PAYMENT;
        response = `Como vai pagar?\n1 - Dinheiro\n2 - Cartao Credito\n3 - Cartao Debito\n4 - PIX\n\nDigite o numero:`;
    } else if (flowState === FLOW_STATES.COLLECTING_PAYMENT) {
        const paymentOption = text.trim();
        customerData.paymentType = PAYMENT_TYPES[paymentOption] || 'PaymentType.cash';
        const paymentName = {
            '1': 'Dinheiro', '2': 'Cartao Credito', '3': 'Cartao Debito', '4': 'PIX'
        }[paymentOption] || 'Dinheiro';

        flowState = FLOW_STATES.CONFIRMING_ORDER;

        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total = cartTotal + (settings.delivery_price || 0);

        response = `📋 *RESUMO DO PEDIDO*\n\n`;
        response += `*Itens:*\n${cart.map(i => `• ${i.quantity}x ${i.name} - R$ ${(i.price * i.quantity).toFixed(2)}`).join('\n')}\n\n`;
        response += `*Entrega:* R$ ${(settings.delivery_price || 0).toFixed(2)}\n`;
        response += `*TOTAL:* R$ ${total.toFixed(2)}\n\n`;
        response += `*Entregar para:* ${customerData.name}\n`;
        response += `*Endereco:* ${customerData.street}, ${customerData.number}\n`;
        response += `*Bairro:* ${customerData.neighborhood}\n`;
        response += `*Cidade:* ${customerData.city}\n`;
        response += `*CEP:* ${customerData.zipCode}\n`;
        if (customerData.complement) response += `*Complemento:* ${customerData.complement}\n`;
        if (customerData.reference) response += `*Referencia:* ${customerData.reference}\n`;
        response += `*Pagamento:* ${paymentName}\n\n`;
        response += `Esta tudo certo? Responda *SIM* para confirmar ou *NAO* para cancelar.`;
    } else if (flowState === FLOW_STATES.CONFIRMING_ORDER) {
        const answer = text.toLowerCase().trim();
        if (answer === 'sim' || answer === 's' || answer === 'confirmar' || answer === 'confirmo') {
            // Criar pedido
            try {
                const order = await firebase.createPurchaseRequest(
                    companyId,
                    customerData,
                    cart,
                    settings.delivery_price || 0
                );

                flowState = FLOW_STATES.ORDER_COMPLETED;
                cart = []; // Limpa carrinho
                customerData = { flowState: FLOW_STATES.BROWSING }; // Reset

                response = `✅ *PEDIDO CONFIRMADO!*\n\n`;
                response += `Numero do pedido: *#${order.orderNumber}*\n`;
                response += `Total: R$ ${order.total.toFixed(2)}\n\n`;
                response += `Obrigado pela preferencia! Em breve voce recebera atualizacoes sobre seu pedido. 🛵`;

                flowState = FLOW_STATES.BROWSING;
            } catch (error) {
                console.error('Erro ao criar pedido:', error);
                response = 'Desculpe, houve um erro ao criar o pedido. Por favor, tente novamente.';
            }
        } else if (answer === 'nao' || answer === 'n' || answer === 'cancelar') {
            flowState = FLOW_STATES.BROWSING;
            response = 'Pedido cancelado. Posso ajudar em mais alguma coisa? Seu carrinho ainda esta salvo.';
        } else {
            response = 'Por favor, responda *SIM* para confirmar ou *NAO* para cancelar o pedido.';
        }
    }

    // Processa tags de acao na resposta
    let cleanResponse = response;

    // [START_CHECKOUT] - Inicia coleta de dados
    if (response.includes('[START_CHECKOUT]')) {
        if (cart.length === 0) {
            cleanResponse = 'Seu carrinho esta vazio! Adicione alguns produtos primeiro.';
        } else {
            flowState = FLOW_STATES.COLLECTING_NAME;
            customerData.flowState = flowState;
            cleanResponse = response.replace(/\[START_CHECKOUT\]/g, '').trim();
            cleanResponse += '\n\nPara finalizar, preciso de alguns dados. Qual seu nome completo?';
        }
    }

    // [ADD:id:qty]
    const addMatch = response.match(/\[ADD:([^:]+):(\d+)\]/);
    if (addMatch) {
        const [, productId, qty] = addMatch;
        const product = products.find(p => p.id === productId);
        if (product) {
            const existingIndex = cart.findIndex(item => item.id === productId);
            if (existingIndex >= 0) {
                cart[existingIndex].quantity += parseInt(qty);
            } else {
                cart.push({
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    price: product.price,
                    quantity: parseInt(qty),
                    image: product.image,
                    unityType: product.unityType,
                    barCode: product.barCode
                });
            }
        }
        cleanResponse = response.replace(/\[ADD:[^\]]+\]/g, '').trim();
    }

    // [REMOVE:id]
    const removeMatch = response.match(/\[REMOVE:([^\]]+)\]/);
    if (removeMatch) {
        const [, productId] = removeMatch;
        const index = cart.findIndex(item => item.id === productId);
        if (index >= 0) cart.splice(index, 1);
        cleanResponse = cleanResponse.replace(/\[REMOVE:[^\]]+\]/g, '').trim();
    }

    // Atualiza estado
    customerData.flowState = flowState;

    // Salva conversa
    messages.push({ role: 'user', content: text });
    messages.push({ role: 'assistant', content: cleanResponse });

    await firebase.saveConversation(userId, phone, messages, cart, customerData);

    return cleanResponse;
}

/**
 * Processa estado de navegacao/compras
 */
async function handleBrowsingState(settings, products, cart, messages, text, customerData) {
    const systemPrompt = buildSystemPrompt(settings, products, cart, FLOW_STATES.BROWSING, customerData);
    return await openaiService.generateResponse(systemPrompt, messages, text);
}

/**
 * Mensagem de boas-vindas
 */
function getWelcomeMessage(settings) {
    return settings.welcome_message ||
        `Ola! Sou o ${settings.agent_name}, assistente virtual da ${settings.company_name}. Como posso ajudar?`;
}

/**
 * Limpa carrinho
 */
async function clearCart(userId, phone) {
    const conversation = await firebase.getConversation(userId, phone);
    if (conversation) {
        await firebase.saveConversation(userId, phone, conversation.messages, [], { flowState: FLOW_STATES.BROWSING });
    }
}

module.exports = {
    processMessage,
    getWelcomeMessage,
    clearCart,
    buildSystemPrompt,
    FLOW_STATES
};
