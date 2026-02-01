/**
 * Formata numero de telefone para o formato do WhatsApp
 */
function formatPhoneNumber(phone) {
    // Remove caracteres nao numericos
    let cleaned = phone.replace(/\D/g, '');

    // Adiciona codigo do pais se necessario
    if (cleaned.length === 11 && cleaned.startsWith('9')) {
        cleaned = '55' + cleaned;
    } else if (cleaned.length === 10) {
        cleaned = '55' + cleaned;
    }

    return cleaned;
}

/**
 * Formata valor em reais
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

/**
 * Formata data para exibicao
 */
function formatDate(date) {
    if (!date) return '';

    const d = date instanceof Date ? date : new Date(date);

    return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Gera ID unico
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Trunca texto com reticencias
 */
function truncate(text, maxLength = 100) {
    if (!text || text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
}

/**
 * Valida email
 */
function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

/**
 * Valida telefone brasileiro
 */
function isValidPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 13;
}

/**
 * Delay async
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry com backoff exponencial
 */
async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                await delay(baseDelay * Math.pow(2, attempt - 1));
            }
        }
    }

    throw lastError;
}

/**
 * Limpa texto para busca
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * Extrai numeros de uma string
 */
function extractNumbers(text) {
    const matches = text.match(/\d+([.,]\d+)?/g);
    return matches ? matches.map(n => parseFloat(n.replace(',', '.'))) : [];
}

module.exports = {
    formatPhoneNumber,
    formatCurrency,
    formatDate,
    generateId,
    truncate,
    isValidEmail,
    isValidPhone,
    delay,
    retry,
    normalizeText,
    extractNumbers
};
