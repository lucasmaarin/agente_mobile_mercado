# Configuracao do WhatsApp Business Cloud API — Multi-tenant

Cada estabelecimento tem seu proprio numero WhatsApp. Um unico servidor centralizado
recebe todas as mensagens e roteia para o estabelecimento correto.

## Arquitetura

```
Estabelecimento A (numero A) ──┐
Estabelecimento B (numero B) ──┼── Meta Webhook ── POST /webhook ── Servidor
Estabelecimento C (numero C) ──┘         ↓
                                  phone_number_id identifica qual estabelecimento
                                         ↓
                                  Firebase: users/{userId}/whatsapp.phone_number_id
                                         ↓
                                  salesAgent processa com produtos do estabelecimento
```

---

## 1. Configuracao do servidor (unica vez)

### Variaveis de ambiente globais

```env
# Token de verificacao do webhook e versao da API (globais)
WHATSAPP_VERIFY_TOKEN=zerograu_webhook_token
WHATSAPP_API_VERSION=v21.0

# Meta App (para Embedded Signup - self-service dos estabelecimentos)
META_APP_ID=seu_meta_app_id
META_APP_SECRET=seu_meta_app_secret
```

### Webhook

O servidor expoe um unico webhook que recebe mensagens de TODOS os numeros:
- `GET  /webhook` → Verificacao (challenge do Meta)
- `POST /webhook` → Recebe mensagens, roteia por `phone_number_id`

O webhook precisa estar acessivel publicamente (HTTPS).
Para desenvolvimento local, use ngrok:
```bash
ngrok http 3000
```

---

## 2. Embedded Signup (metodo recomendado para estabelecimentos)

O Embedded Signup permite que cada estabelecimento conecte seu WhatsApp
diretamente pela plataforma, sem precisar acessar o Meta for Developers.

### Como funciona

1. O estabelecimento acessa `https://seu-dominio.com/onboarding`
2. Clica em "Conectar WhatsApp"
3. Uma janela do Facebook abre
4. O usuario faz login no Meta Business e registra seu numero
5. O sistema automaticamente salva o token e phone_number_id
6. Pronto — o bot comeca a funcionar

### Pre-requisitos do Embedded Signup

Para o Embedded Signup funcionar, voce precisa:

1. **Meta App configurado**: crie em https://developers.facebook.com/
2. **Tipo "Business"**: o app deve ser do tipo Business
3. **Produto WhatsApp adicionado**: adicione WhatsApp ao app
4. **Facebook Login for Business**: adicione e configure com:
   - Redirect URI: `https://seu-dominio.com/` (ou qualquer URL valida)
5. **Permissoes solicitadas no app review**:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
6. **Variaveis de ambiente**: `META_APP_ID` e `META_APP_SECRET` no .env
7. **App em modo Live**: mude de Development para Live no painel do Meta

### Webhook automatico

Quando um estabelecimento completa o Embedded Signup, o sistema
automaticamente inscreve o app no WABA (WhatsApp Business Account)
do estabelecimento. Isso significa que o webhook ja recebe mensagens
sem configuracao manual.

---

## 3. Setup manual do Meta Business (alternativa)

### 2.1 Criar conta no Meta for Developers
1. Acesse https://developers.facebook.com/
2. Faca login com sua conta Facebook
3. Clique em "Meus Apps" > "Criar App"
4. Selecione "Business" como tipo de app
5. Adicione o produto "WhatsApp"
6. Vincule uma conta Meta Business

### 2.2 Obter credenciais
No painel do WhatsApp:
- **Phone Number ID**: "Configuracao da API" → copie o ID (ex: `123456789012345`)
- **Access Token**: gere um token temporario (ou permanente via System User)
- **Business Account ID**: "Configuracao da conta" → copie o ID

### 2.3 Configurar webhook
1. Va em "Configuracao" > "Webhook"
2. URL do callback: `https://seu-dominio.com/webhook` (mesmo para todos os numeros)
3. Token de verificacao: use o valor de `WHATSAPP_VERIFY_TOKEN` do .env
4. Inscreva-se no campo "messages"

### 2.4 Gerar token permanente (System User)
1. Va em https://business.facebook.com/settings/system-users
2. Crie um "System User" com role "Admin"
3. Gere token com permissoes:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
4. Esse token nao expira

---

## 4. Registrar estabelecimento via API (alternativa ao Embedded Signup)

### Registro individual (via API)

```bash
curl -X POST https://seu-dominio.com/api/whatsapp/register \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=SUA_SESSAO" \
  -d '{
    "access_token": "EAAxxxxxxx",
    "phone_number_id": "123456789012345",
    "business_account_id": "987654321",
    "phone_number": "+5511999999999"
  }'
```

O sistema valida o token automaticamente antes de salvar.

### Registro em massa (1000+ estabelecimentos)

```bash
curl -X POST https://seu-dominio.com/api/admin/bulk-register \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=SUA_SESSAO" \
  -d '{
    "entries": [
      {
        "userId": "user_001",
        "access_token": "EAAxxxxxxx",
        "phone_number_id": "111111111",
        "phone_number": "+5511111111111",
        "business_account_id": "aaa111"
      },
      {
        "userId": "user_002",
        "access_token": "EAAyyyyyyy",
        "phone_number_id": "222222222",
        "phone_number": "+5522222222222",
        "business_account_id": "bbb222"
      }
    ]
  }'
```

Suporta ate 500 registros por chamada (limite do Firestore batch).
Para mais de 500, faca multiplas chamadas.

---

## 5. Estrutura no Firebase

Cada usuario tera um campo `whatsapp` no documento:

```
users/{userId}
├── email, name, agent_settings, stats...
└── whatsapp:
    ├── phone_number_id: "123456789012345"
    ├── access_token: "EAAxxxxxxx..."
    ├── business_account_id: "987654321"
    ├── phone_number: "+5511999999999"
    └── connected_at: Timestamp
```

O roteamento funciona por query:
`users WHERE whatsapp.phone_number_id == phone_number_id_do_webhook`

**Indice recomendado no Firestore**: crie um indice no campo `whatsapp.phone_number_id`
para performance em queries com 1000+ documentos.

---

## 6. APIs disponiveis

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/whatsapp/register` | Registra credenciais WhatsApp |
| DELETE | `/api/whatsapp/unregister` | Remove credenciais WhatsApp |
| GET | `/api/whatsapp/status` | Status da configuracao |
| GET | `/api/whatsapp/link` | Link wa.me do estabelecimento |
| POST | `/api/whatsapp/send` | Envia mensagem manual |
| POST | `/api/whatsapp/embedded-signup` | Embedded Signup (troca code por token) |
| POST | `/api/admin/bulk-register` | Cadastro em massa |
| GET | `/onboarding` | Pagina de onboarding (Embedded Signup) |

---

## 7. Limites e custos

- **Conversas iniciadas pelo cliente**: gratuitas nas primeiras 1.000/mes por numero
- **Conversas iniciadas pela empresa**: cobradas por conversa
- **Rate limits**: 80 msg/s (Business), 250 msg/s (Enterprise)
- Precos: https://developers.facebook.com/docs/whatsapp/pricing

---

## 8. Solucao de problemas

### Webhook nao recebe mensagens
- Verifique se a URL e HTTPS e esta acessivel publicamente
- Confirme que se inscreveu no campo "messages" no painel do Meta
- Verifique os logs em "Webhooks" > "Testar" no painel do app

### "Nenhum usuario encontrado para phone_number_id"
- O phone_number_id nao foi registrado via `/api/whatsapp/register`
- Verifique se o userId correto esta associado

### Erro 401 ao enviar mensagens
- Token expirado (gere um permanente via System User)
- Permissoes insuficientes no token

### Performance com 1000+ estabelecimentos
- O sistema usa cache em memoria para mapear `phone_number_id → userId` (TTL: 5 min)
- Crie um indice no Firestore para o campo `whatsapp.phone_number_id`
