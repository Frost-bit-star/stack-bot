const {
  default: dreadedConnect,
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage,
  jidDecode,
  proto,
  getContentType,
  BufferJSON,
  STORIES_JID,
  WA_DEFAULT_EPHEMERAL,
  generateWAMessageFromContent,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  areJidsSameUser
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const chalk = require("chalk");
const axios = require("axios");
const express = require("express");
const path = require("path");
const { session } = require("./settings");

const app = express();
const PORT = process.env.PORT || 10000;
const color = (text, color) => (!color ? chalk.green(text) : chalk.keyword(color)(text));

let aiActive = false;
const ownerNumber = "254768974189@s.whatsapp.net"; // ✅ your owner number

// Write creds.json on every start from settings.js
const credsPath = path.join(__dirname, "session", "creds.json");
try {
  const decoded = Buffer.from(session, "base64").toString("utf-8");
  fs.mkdirSync(path.dirname(credsPath), { recursive: true });
  fs.writeFileSync(credsPath, decoded, "utf8");
  console.log("📡 writing session creds.json from settings.js...");
} catch (e) {
  console.error("❌ Failed to write session creds:", e);
}

async function aiReply(messages) {
  try {
    const systemPrompt = "You are replying as me in WhatsApp chats. Reply casually, naturally, and personally as a young, confident, funny guy. Always reply in first person as if you are me. Never mention AI, assistant, or anything robotic. Make replies feel real and authentic, with slang, jokes, emojis, and smooth compliments where relevant. Keep it short, natural, and fitting the flow of conversation. Do not sound like a chatbot or motivational speaker. Do not say 'I'm here for you' or 'let me know what's up'. Always read previous messages carefully and reply naturally to the latest one as if you are continuing the conversation seamlessly.";

    const combinedText = systemPrompt + "\n\n" + messages.map(m => {
      return `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`;
    }).join('\n');

    const response = await axios.get("https://api.dreaded.site/api/chatgpt", {
      params: { text: combinedText }
    });

    if (response.data && response.data.result && response.data.result.prompt) {
      return response.data.result.prompt;
    } else {
      return "❌ Invalid response from AI API";
    }
  } catch (err) {
    console.log("AI API error:", err.response?.data || err.message);
    return "😂 Sorry, brain jammed for a sec. Try again!";
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const client = dreadedConnect({
    logger: pino({ level: "silent" }),
    browser: ["NecromancerBot", "Chrome", "1.0.0"],
    markOnlineOnConnect: true,
    auth: state,
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed, reconnecting...", reason);
      setTimeout(() => startBot(), 5000); // delay to prevent crash loop
    }

    if (connection === "open") {
      console.log(color("💀 Necromancer WhatsApp bot resurrected and running!", "magenta"));
      console.log("✅ Owner number set to:", ownerNumber);

      // Wait 3 seconds for full readiness
      setTimeout(async () => {
        try {
          await client.sendMessage(ownerNumber, {
            image: fs.readFileSync(path.join(__dirname, "me.jpeg")),
            caption: "☠️ The Necromancer has risen...\n\nYour bot is connected and the darkness listens to your commands.\n\n⚔️ Would you like to summon the Necromancer now? Send .activateai to awaken me."
          });
        } catch (err) {
          console.log("❌ Failed to send necromancer online message:", err.message);
        }
      }, 3000);
    }
  });

  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message) return;
      mek.message = mek.message.ephemeralMessage?.message || mek.message;
      const mtype = getContentType(mek.message);
      const msg = mek.message[mtype];
      const text = msg?.text || msg?.conversation || msg?.caption || "";
      const from = mek.key.remoteJid;
      const isCmd = text.startsWith(".");

      console.log("From:", from, "Text:", text, "IsCmd:", isCmd);

      // Command handling
      if (from === ownerNumber && isCmd) {
        const command = text.trim().toLowerCase();
        if (command === ".activateai") {
          aiActive = true;
          await client.sendMessage(from, {
            image: fs.readFileSync(path.join(__dirname, "me.jpeg")),
            caption: "🔮 The Necromancer is awake...\nSpeak your will, my master."
          });
        } else if (command === ".deactivate") {
          aiActive = false;
          await client.sendMessage(from, {
            text: "💀 The Necromancer returns to shadows...\nSummon me anytime with .activateai."
          });
        }
        return;
      }

      // Status view auto-react
      if (mek.key && mek.key.remoteJid === "status@broadcast") {
        await client.readMessages([mek.key]);
        const emojis = ['🗿','💠','💀','🔥','👑','⚔️','🧠','💫','🌙','⚡','🌑','🧊','📿','🕯️','🦂','🐍','🦇'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await client.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key } });
        console.log('Reaction sent successfully ✅️');
      }

      // AI reply
      if (aiActive && !mek.key.fromMe && from.endsWith("@s.whatsapp.net")) {
        await client.sendPresenceUpdate('composing', from);

        const history = await client.fetchMessagesFromJid(from, 5);
        const messages = history.map(h => ({
          role: h.key.fromMe ? "assistant" : "user",
          content: h.message?.conversation || h.message?.extendedTextMessage?.text || ""
        }));
        messages.push({ role: "user", content: text });

        const aiText = await aiReply(messages);

        await client.sendMessage(from, { text: aiText });

        await client.sendPresenceUpdate('paused', from);
      }

    } catch (err) {
      console.log("messages.upsert error:", err);
    }
  });
}

startBot();

app.get("/", (req, res) => {
  res.send("💀 Necromancer WhatsApp bot is running and awaiting commands!");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});

// Global error handlers to prevent crash
process.on('unhandledRejection', (reason, p) => {
  console.log('🔥 Unhandled Rejection at:', p, 'reason:', reason);
});

process.on('uncaughtException', err => {
  console.log('🔥 Uncaught Exception thrown:', err);
});