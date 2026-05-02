const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const qrcode = require('qrcode-terminal');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    getContentType,
    jidNormalizedUser,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const PREFIX = '!';
const DATA_FILE = path.join(__dirname, 'bot-data.json');
const AUTH_PATH = process.env.BAILEYS_AUTH_PATH || path.join(__dirname, '.baileys_auth');
const QR_IMAGE_PATH = path.join(AUTH_PATH, 'whatsapp-qr.png');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DEFAULT_AI_PROMPT = 'You are a helpful WhatsApp assistant. Keep replies clear, friendly, and concise.';
const chatHistories = new Map();

let sock;

function createDefaultStore() {
    return {
        mutedChats: {},
        autoReplyChats: {},
        antiLinkChats: {},
        aiEnabledChats: {},
        aiSystemPrompts: {},
        globalAiEnabled: false
    };
}

function loadStore() {
    if (!fs.existsSync(DATA_FILE)) {
        return createDefaultStore();
    }

    try {
        return {
            ...createDefaultStore(),
            ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
        };
    } catch (error) {
        console.error('Failed to read bot-data.json, using empty settings:', error);
        return createDefaultStore();
    }
}

const store = loadStore();

function saveStore() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function ensureChatSettings(chatId) {
    if (!(chatId in store.mutedChats)) {
        store.mutedChats[chatId] = false;
    }

    if (!(chatId in store.autoReplyChats)) {
        store.autoReplyChats[chatId] = true;
    }

    if (!(chatId in store.antiLinkChats)) {
        store.antiLinkChats[chatId] = false;
    }

    if (!(chatId in store.aiEnabledChats)) {
        store.aiEnabledChats[chatId] = store.globalAiEnabled;
    }

    if (!(chatId in store.aiSystemPrompts)) {
        store.aiSystemPrompts[chatId] = DEFAULT_AI_PROMPT;
    }
}

saveStore();

function getBaseUserId(value) {
    if (!value) {
        return '';
    }

    return String(value).split('@')[0].split(':')[0];
}

function getTextFromMessage(message) {
    if (!message?.message) {
        return '';
    }

    const contentType = getContentType(message.message);

    if (!contentType) {
        return '';
    }

    const content = message.message[contentType];

    if (typeof content === 'string') {
        return content;
    }

    if (contentType === 'conversation') {
        return message.message.conversation || '';
    }

    if (contentType === 'extendedTextMessage') {
        return content.text || '';
    }

    if (contentType === 'imageMessage' || contentType === 'videoMessage') {
        return content.caption || '';
    }

    if (contentType === 'ephemeralMessage' || contentType === 'viewOnceMessageV2' || contentType === 'viewOnceMessageV2Extension') {
        return getTextFromMessage({
            message: content.message
        });
    }

    return '';
}

function isGreeting(text) {
    return /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|how are u|how far|sup|what's up|whats up|who are you|who are u|who re u|who r u)\b/i.test(text.trim());
}

function hasLink(text) {
    return /(https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(text);
}

function formatMenu() {
    return [
        'Bot commands:',
        '!menu - Show this menu',
        '!ping - Check if the bot is online',
        '!echo <text> - Repeat your text',
        '!ask <question> - Ask the AI a one-off question',
        '!ai on/off/status - Control AI chat mode in this chat',
        '!globalai on/off/status - Control AI for all chats by default',
        '!ai prompt <text> - Set the AI behavior for this chat',
        '!ai reset - Clear recent AI chat memory for this chat',
        '!time - Show server time',
        '!info - Show bot status',
        '!chatid - Show the current chat ID',
        '!owner - Show the connected bot number',
        '!autoreply on/off - Enable or disable greeting replies in this chat',
        '!groupinfo - Show group details',
        '!admins - List group admins',
        '!tagall - Mention everyone in the group',
        '!mute - Pause bot replies in this chat',
        '!unmute - Resume bot replies in this chat',
        '!antilink on/off - Warn when non-admins send links'
    ].join('\n');
}

async function generateAiReply(chatId, userText) {
    if (!GROQ_API_KEY) {
        throw new Error('missing_api_key');
    }

    ensureChatSettings(chatId);

    const history = chatHistories.get(chatId) || [];
    const systemPrompt = store.aiSystemPrompts[chatId] || DEFAULT_AI_PROMPT;
    const messages = [
        {
            role: 'system',
            content: systemPrompt
        },
        ...history,
        {
            role: 'user',
            content: userText
        }
    ];

    let response;
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages,
                    temperature: 0.7
                }),
                signal: AbortSignal.timeout(30000)
            });
            break;
        } catch (error) {
            lastError = error;

            if (attempt === 2) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }

    if (!response) {
        throw lastError || new Error('groq_request_failed');
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`groq_${response.status}:${errorText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
        throw new Error('empty_ai_reply');
    }

    chatHistories.set(
        chatId,
        [
            ...history,
            {
                role: 'user',
                content: userText
            },
            {
                role: 'assistant',
                content: reply
            }
        ].slice(-12)
    );

    return reply;
}

async function sendText(jid, text, options = {}) {
    await sock.sendMessage(jid, { text, ...options });
}

async function getGroupMetadata(chatId) {
    try {
        return await sock.groupMetadata(chatId);
    } catch (error) {
        return null;
    }
}

async function getSenderName(message, metadata) {
    const senderJid = jidNormalizedUser(message.key.participant || message.key.remoteJid || '');
    const participant = metadata?.participants?.find((item) => jidNormalizedUser(item.id) === senderJid);
    return participant?.notify || participant?.name || getBaseUserId(senderJid) || 'there';
}

async function isSenderAdmin(message, metadata) {
    if (!metadata) {
        return true;
    }

    const senderJid = jidNormalizedUser(message.key.participant || message.key.remoteJid || '');
    const senderBaseId = getBaseUserId(senderJid);
    const participant = metadata.participants.find((item) => {
        const participantJid = jidNormalizedUser(item.id);
        return participantJid === senderJid || getBaseUserId(participantJid) === senderBaseId;
    });

    return Boolean(participant && ['admin', 'superadmin'].includes(participant.admin));
}

async function requireGroup(context) {
    if (!context.isGroup) {
        await context.reply('This command only works in groups.');
        return null;
    }

    return context.metadata || (await getGroupMetadata(context.chatId));
}

async function requireGroupAdmin(context) {
    const metadata = await requireGroup(context);

    if (!metadata) {
        return null;
    }

    if (!(await isSenderAdmin(context.rawMessage, metadata))) {
        await context.reply('You need to be a group admin to use this command.');
        return null;
    }

    return metadata;
}

async function getAdminNames(metadata) {
    return metadata.participants
        .filter((item) => ['admin', 'superadmin'].includes(item.admin))
        .map((item) => item.notify || item.name || getBaseUserId(item.id));
}

function createContext(message) {
    const chatId = jidNormalizedUser(message.key.remoteJid || '');
    const senderId = jidNormalizedUser(message.key.participant || message.key.remoteJid || '');
    const body = getTextFromMessage(message).trim();

    return {
        rawMessage: message,
        chatId,
        senderId,
        body,
        isGroup: chatId.endsWith('@g.us'),
        isFromMe: Boolean(message.key.fromMe),
        metadata: null,
        reply: async (text) => sendText(chatId, text, { quoted: message }),
        send: async (text, options) => sendText(chatId, text, options)
    };
}

const commands = {
    menu: {
        run: async (context) => {
            await context.reply(formatMenu());
        }
    },
    help: {
        run: async (context) => {
            await context.reply(formatMenu());
        }
    },
    ping: {
        run: async (context) => {
            await context.reply('pong');
        }
    },
    echo: {
        run: async (context, args) => {
            if (!args.length) {
                await context.reply('Usage: !echo <text>');
                return;
            }

            await context.reply(args.join(' '));
        }
    },
    ask: {
        run: async (context, args) => {
            if (!args.length) {
                await context.reply('Usage: !ask <question>');
                return;
            }

            await context.reply('Thinking...');
            const reply = await generateAiReply(context.chatId, args.join(' '));
            await context.reply(reply);
        }
    },
    ai: {
        run: async (context, args) => {
            ensureChatSettings(context.chatId);
            const subcommand = (args[0] || '').toLowerCase();

            if (!subcommand || subcommand === 'status') {
                const state = store.aiEnabledChats[context.chatId] ? 'on' : 'off';
                const prompt = store.aiSystemPrompts[context.chatId] || DEFAULT_AI_PROMPT;
                await context.reply(`AI mode is ${state}.\nModel: ${GROQ_MODEL}\nPrompt: ${prompt}`);
                return;
            }

            if (subcommand === 'on' || subcommand === 'off') {
                if (!GROQ_API_KEY) {
                    await context.reply('Set GROQ_API_KEY first before enabling AI mode.');
                    return;
                }

                store.aiEnabledChats[context.chatId] = subcommand === 'on';
                saveStore();
                await context.reply(`AI mode is now ${subcommand} in this chat.`);
                return;
            }

            if (subcommand === 'reset') {
                chatHistories.delete(context.chatId);
                await context.reply('AI memory cleared for this chat.');
                return;
            }

            if (subcommand === 'prompt') {
                const promptText = args.slice(1).join(' ').trim();

                if (!promptText) {
                    await context.reply('Usage: !ai prompt <text>');
                    return;
                }

                store.aiSystemPrompts[context.chatId] = promptText;
                chatHistories.delete(context.chatId);
                saveStore();
                await context.reply('AI prompt updated for this chat.');
                return;
            }

            await context.reply('Usage: !ai on|off|status|prompt <text>|reset');
        }
    },
    globalai: {
        run: async (context, args) => {
            const mode = (args[0] || '').toLowerCase();

            if (!mode || mode === 'status') {
                await context.reply(`Global AI is ${store.globalAiEnabled ? 'on' : 'off'}.`);
                return;
            }

            if (!GROQ_API_KEY) {
                await context.reply('Set GROQ_API_KEY first before enabling global AI.');
                return;
            }

            if (!['on', 'off'].includes(mode)) {
                await context.reply('Usage: !globalai on|off|status');
                return;
            }

            const enabled = mode === 'on';
            store.globalAiEnabled = enabled;

            for (const chatId of Object.keys(store.aiEnabledChats)) {
                store.aiEnabledChats[chatId] = enabled;
            }

            saveStore();
            await context.reply(
                `Global AI is now ${mode}. ${enabled ? 'New and existing chats will reply with AI.' : 'Chats will stop AI replies unless enabled again.'}`
            );
        }
    },
    time: {
        run: async (context) => {
            const now = new Date().toLocaleString('en-NG', {
                dateStyle: 'full',
                timeStyle: 'medium'
            });
            await context.reply(`Server time: ${now}`);
        }
    },
    info: {
        run: async (context) => {
            const knownChats = new Set([
                ...Object.keys(store.mutedChats),
                ...Object.keys(store.autoReplyChats),
                ...Object.keys(store.antiLinkChats),
                ...Object.keys(store.aiEnabledChats)
            ]);
            const connectedUser = jidNormalizedUser(sock.user?.id || '');
            await context.reply(
                [
                    'Bot status:',
                    `Connected number: ${connectedUser || 'unknown'}`,
                    `Known chats: ${knownChats.size}`,
                    `Prefix: ${PREFIX}`,
                    `AI model: ${GROQ_MODEL}`,
                    `Groq key set: ${GROQ_API_KEY ? 'yes' : 'no'}`,
                    `Global AI: ${store.globalAiEnabled ? 'on' : 'off'}`
                ].join('\n')
            );
        }
    },
    owner: {
        run: async (context) => {
            const connectedUser = jidNormalizedUser(sock.user?.id || '');
            await context.reply(connectedUser ? `Connected as ${connectedUser}` : 'Owner number is not available yet.');
        }
    },
    chatid: {
        run: async (context) => {
            await context.reply(`Chat ID: ${context.chatId}`);
        }
    },
    autoreply: {
        run: async (context, args) => {
            const mode = (args[0] || '').toLowerCase();
            ensureChatSettings(context.chatId);

            if (!['on', 'off'].includes(mode)) {
                await context.reply('Usage: !autoreply on|off');
                return;
            }

            store.autoReplyChats[context.chatId] = mode === 'on';
            saveStore();
            await context.reply(`Auto-reply is now ${mode} in this chat.`);
        }
    },
    groupinfo: {
        run: async (context) => {
            const metadata = await requireGroup(context);

            if (!metadata) {
                return;
            }

            await context.reply(
                [
                    `Group: ${metadata.subject || 'this chat'}`,
                    `Participants: ${metadata.participants.length}`,
                    `Description: ${metadata.desc || 'No group description.'}`
                ].join('\n')
            );
        }
    },
    admins: {
        run: async (context) => {
            const metadata = await requireGroup(context);

            if (!metadata) {
                return;
            }

            const names = await getAdminNames(metadata);
            await context.reply(`Admins:\n${names.map((name) => `- ${name}`).join('\n')}`);
        }
    },
    tagall: {
        run: async (context) => {
            const metadata = await requireGroupAdmin(context);

            if (!metadata) {
                return;
            }

            const mentions = metadata.participants.map((item) => jidNormalizedUser(item.id));
            const lines = metadata.participants.map((item, index) => `@${getBaseUserId(item.id)} ${item.notify || item.name || `member ${index + 1}`}`);
            await context.send(lines.join('\n'), { mentions });
        }
    },
    mute: {
        run: async (context) => {
            const metadata = context.isGroup ? await getGroupMetadata(context.chatId) : null;

            if (context.isGroup && !(await isSenderAdmin(context.rawMessage, metadata))) {
                await context.reply('Only a group admin can mute the bot here.');
                return;
            }

            ensureChatSettings(context.chatId);
            store.mutedChats[context.chatId] = true;
            saveStore();
            await context.reply(`Bot replies are now muted in ${metadata?.subject || 'this chat'}.`);
        }
    },
    unmute: {
        runWhenMuted: true,
        run: async (context) => {
            const metadata = context.isGroup ? await getGroupMetadata(context.chatId) : null;

            if (context.isGroup && !(await isSenderAdmin(context.rawMessage, metadata))) {
                await context.reply('Only a group admin can unmute the bot here.');
                return;
            }

            ensureChatSettings(context.chatId);
            store.mutedChats[context.chatId] = false;
            saveStore();
            await context.reply(`Bot replies are active again in ${metadata?.subject || 'this chat'}.`);
        }
    },
    antilink: {
        run: async (context, args) => {
            const metadata = await requireGroupAdmin(context);

            if (!metadata) {
                return;
            }

            const mode = (args[0] || '').toLowerCase();

            if (!['on', 'off'].includes(mode)) {
                await context.reply('Usage: !antilink on|off');
                return;
            }

            ensureChatSettings(context.chatId);
            store.antiLinkChats[context.chatId] = mode === 'on';
            saveStore();
            await context.reply(`Anti-link is now ${mode} in ${metadata.subject || 'this chat'}.`);
        }
    }
};

async function handleNonCommandMessage(context) {
    if (!context.body) {
        return;
    }

    ensureChatSettings(context.chatId);

    if (store.mutedChats[context.chatId]) {
        return;
    }

    context.metadata = context.isGroup ? await getGroupMetadata(context.chatId) : null;
    const senderIsAdmin = context.isGroup ? await isSenderAdmin(context.rawMessage, context.metadata) : false;

    if (context.isGroup && store.antiLinkChats[context.chatId] && !senderIsAdmin && hasLink(context.body)) {
        const senderName = await getSenderName(context.rawMessage, context.metadata);
        await context.send(`${senderName}, links are not allowed here.`, {
            mentions: [context.senderId]
        });
        return;
    }

    if (store.autoReplyChats[context.chatId] && isGreeting(context.body)) {
        await context.reply('Hello. I am online and ready. Send !menu to see commands.');
        return;
    }

    if (store.aiEnabledChats[context.chatId]) {
        try {
            const reply = await generateAiReply(context.chatId, context.body);
            await context.reply(reply);
        } catch (error) {
            console.error('AI reply failed:', error);

            if (String(error.message).includes('missing_api_key')) {
                await context.reply('AI mode needs GROQ_API_KEY to be set on this computer.');
                return;
            }

            if (String(error.message).includes('groq_429')) {
                await context.reply('Groq rate limit or free quota is exhausted right now. Please try again shortly.');
                return;
            }

            if (String(error.message).includes('groq_503')) {
                await context.reply('Groq is under heavy demand right now. Please try again shortly.');
                return;
            }

            if (String(error.message).includes('UND_ERR_CONNECT_TIMEOUT')) {
                await context.reply('AI is online but Groq timed out. Please try again in a moment.');
                return;
            }

            await context.reply('AI reply failed right now. Try again in a moment.');
        }
    }
}

async function handleCommandMessage(context) {
    if (!context.body) {
        return;
    }

    if (!context.body.startsWith(PREFIX)) {
        await handleNonCommandMessage(context);
        return;
    }

    ensureChatSettings(context.chatId);

    const [commandName, ...args] = context.body.slice(PREFIX.length).split(/\s+/);
    const command = commands[commandName.toLowerCase()];

    if (!command) {
        await context.reply("Unknown command. Send !menu to see what's available.");
        return;
    }

    if (store.mutedChats[context.chatId] && !command.runWhenMuted) {
        return;
    }

    try {
        await command.run(context, args);
    } catch (error) {
        console.error(`Command "${commandName}" failed:`, error);

        if (commandName.toLowerCase() === 'ask' && String(error.message).includes('groq_429')) {
            await context.reply('Groq rate limit or free quota is exhausted right now. Please try again shortly.');
            return;
        }

        if (commandName.toLowerCase() === 'ask' && String(error.message).includes('groq_503')) {
            await context.reply('Groq is under heavy demand right now. Please try again shortly.');
            return;
        }

        await context.reply('Something went wrong while running that command.');
    }
}

async function handleMessages(messages) {
    for (const message of messages) {
        if (!message.message || message.key.remoteJid === 'status@broadcast') {
            continue;
        }

        const context = createContext(message);
        await handleCommandMessage(context);
    }
}

async function handleGroupParticipantsUpdate(update) {
    if (update.action !== 'add') {
        return;
    }

    try {
        await sendText(update.id, 'Welcome. The bot is online here. Send !menu to see commands.');
    } catch (error) {
        console.error('Failed to send welcome message:', error);
    }
}

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();

    console.log('Starting WhatsApp bot with Baileys...');
    console.log(`Auth path: ${AUTH_PATH}`);
    console.log('Waiting for WhatsApp to initialize...');

    sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        browser: ['WhatsApp Bot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') {
            return;
        }

        await handleMessages(messages);
    });
    sock.ev.on('group-participants.update', handleGroupParticipantsUpdate);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan this QR code with WhatsApp:');
            qrcode.generate(qr, { small: true });

            try {
                fs.mkdirSync(AUTH_PATH, { recursive: true });
                await QRCode.toFile(QR_IMAGE_PATH, qr, { type: 'png' });
                console.log(`Saved QR image to: ${QR_IMAGE_PATH}`);
                console.log('If needed, open /qr in a browser to view the QR image.');
            } catch (error) {
                console.error('Failed to save QR image:', error);
            }
        }

        if (connection === 'open') {
            console.log('Client is ready!');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.warn('Connection closed:', statusCode || lastDisconnect?.error || 'unknown');

            if (shouldReconnect) {
                console.log('Reconnecting...');
                await new Promise((resolve) => setTimeout(resolve, 5000));
                await startSock();
            } else {
                console.error('Logged out. Delete the Baileys auth folder if you want to link again.');
            }
        }
    });
}

startSock().catch((error) => {
    console.error('Client initialization failed:', error);
});

const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    if (req.url === '/qr') {
        if (!fs.existsSync(QR_IMAGE_PATH)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('QR image not available yet. Wait for bot initialization and scan log output first.');
            return;
        }

        const qrData = fs.readFileSync(QR_IMAGE_PATH);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(qrData);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
}).listen(port, () => {
    console.log(`Health endpoint listening on port ${port}`);
});
