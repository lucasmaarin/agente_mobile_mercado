const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({
    apiKey: config.openai.apiKey
});

/**
 * Gera resposta do agente de vendas usando GPT-4o-mini
 * OTIMIZADO: menos tokens, resposta mais rapida
 */
async function generateResponse(systemPrompt, conversationHistory, userMessage) {
    try {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            { role: 'user', content: userMessage }
        ];

        const completion = await openai.chat.completions.create({
            model: config.openai.model,
            messages,
            max_tokens: 150,  // Reduzido para respostas mais curtas
            temperature: 0.5  // Mais determinístico = mais rápido
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Erro OpenAI:', error);
        throw error;
    }
}

module.exports = {
    openai,
    generateResponse
};
