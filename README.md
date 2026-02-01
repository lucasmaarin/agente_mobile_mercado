# WhatsApp Sales Bot

Bot de vendas para WhatsApp com IA usando Baileys e OpenAI GPT-4o-mini.

## Stack

- **WhatsApp**: Baileys (conexao direta, sem navegador)
- **IA**: OpenAI GPT-4o-mini
- **Database**: Firebase Firestore
- **Autenticacao**: Firebase Auth (Google)
- **Frontend**: Express + EJS + TailwindCSS

## Instalacao

```bash
# Instalar dependencias
npm install

# Configurar variaveis de ambiente
cp .env.example .env
# Edite o arquivo .env com suas credenciais

# Colocar credenciais do Firebase Admin SDK
# Baixe o arquivo JSON do Firebase Console e salve como:
# firebase-credentials.json
```

## Configuracao

### 1. Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com)
2. Ative o Firestore Database
3. Ative Authentication com Google
4. Baixe as credenciais do Admin SDK (Configuracoes > Contas de servico)
5. Salve como `firebase-credentials.json` na raiz do projeto

### 2. OpenAI

1. Crie uma conta na [OpenAI](https://platform.openai.com)
2. Gere uma API Key
3. Adicione no `.env`

### 3. Estrutura do Firestore

Crie as colecoes necessarias:

```
users/{userId}
  - email: string
  - name: string
  - whatsapp_connected: boolean
  - agent_settings: object
    - agent_name: string
    - company_name: string
    - company_id: string
    - delivery_price: number
    - welcome_message: string
    - active: boolean
  - stats: object
    - messages_today: number
    - total_messages: number
    - orders_count: number

users/{userId}/conversations/{phone}
  - messages: array
  - cart: array
  - updatedAt: timestamp

users/{userId}/orders/{orderId}
  - customer_name: string
  - phone: string
  - items: array
  - subtotal: number
  - delivery_price: number
  - total: number
  - address: string
  - status: string
  - createdAt: timestamp

companies/{companyId}/products/{productId}
  - name: string
  - price: number
  - description: string
  - category: string
  - available: boolean
```

## Executar

```bash
# Desenvolvimento
npm run dev

# Producao
npm start
```

Acesse: http://localhost:3000

## Fluxo de Uso

1. Acesse `/login` e entre com Google
2. No dashboard, clique em "Conectar WhatsApp"
3. Escaneie o QR Code com seu WhatsApp
4. Configure o agente (nome, empresa, taxa de entrega)
5. Ative o agente
6. Clientes podem conversar com o bot!

## API Endpoints

### Autenticacao
- `POST /auth/login` - Login com token Firebase
- `POST /auth/logout` - Logout
- `GET /auth/me` - Usuario atual

### WhatsApp
- `POST /api/whatsapp/connect` - Iniciar conexao
- `GET /api/whatsapp/status` - Status e QR Code
- `POST /api/whatsapp/disconnect` - Desconectar
- `POST /api/whatsapp/send` - Enviar mensagem

### Configuracoes
- `GET /api/settings` - Obter configuracoes
- `PUT /api/settings` - Atualizar configuracoes
- `POST /api/settings/toggle-agent` - Ligar/desligar agente

### Conversas
- `GET /api/conversations` - Listar conversas
- `GET /api/conversations/:phone` - Obter conversa
- `DELETE /api/conversations/:phone` - Remover conversa

### Pedidos
- `GET /api/orders` - Listar pedidos

### Estatisticas
- `GET /api/stats` - Obter estatisticas

### Produtos
- `GET /api/products` - Listar produtos
- `GET /api/products/search?q=` - Buscar produtos

## Estrutura do Projeto

```
whatsapp-bot/
├── src/
│   ├── index.js              # Entry point
│   ├── config.js             # Configuracoes
│   ├── services/
│   │   ├── baileys.js        # Conexao WhatsApp
│   │   ├── openai.js         # Integracao OpenAI
│   │   ├── firebase.js       # Firebase Admin
│   │   └── sessionManager.js # Gerencia sessoes
│   ├── agent/
│   │   └── salesAgent.js     # Logica do agente IA
│   ├── routes/
│   │   ├── auth.js           # Rotas de autenticacao
│   │   └── api.js            # APIs do dashboard
│   └── utils/
│       └── helpers.js        # Funcoes auxiliares
├── views/
│   ├── login.ejs             # Pagina de login
│   └── dashboard.ejs         # Dashboard principal
├── public/                   # Arquivos estaticos
├── sessions/                 # Sessoes Baileys (gitignore)
├── .env                      # Variaveis de ambiente
├── firebase-credentials.json # Credenciais Firebase (gitignore)
└── package.json
```

## Licenca

MIT
