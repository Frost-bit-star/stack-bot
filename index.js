const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const express = require("express");
const axios = require("axios");
const { session } = require("./settings");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionName = "session";

async function initializeSession() {
  const credsPath = path.join(__dirname, "session", "creds.json");
  try {
    const decoded = Buffer.from(session, "base64").toString("utf-8");
    if (!fs.existsSync(credsPath) || session !== "zokk") {
      console.log("📡 connecting...");
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, decoded, "utf8");
    }
  } catch (e) {
    console.log("Session is invalid: " + e);
  }
}

// AI reply function
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
  await initializeSession();
  const { state, saveCreds } = await useMultiFileAuthState(`./${sessionName}`);
  console.log("Connecting to WhatsApp...");

  const client = makeWASocket({
    logger: pino({ level: "silent" }),
    browser: ["Bot", "Chrome", "1.0.0"],
    auth: state,
  });

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 Scan this QR code to connect:\n");
      console.log(qr);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (reason === DisconnectReason.badSession) process.exit();
      else if ([DisconnectReason.connectionClosed, DisconnectReason.connectionLost, DisconnectReason.restartRequired, DisconnectReason.timedOut].includes(reason)) startBot();
      else if (reason === DisconnectReason.connectionReplaced || reason === DisconnectReason.loggedOut) process.exit();
      else startBot();
    } else if (connection === "open") {
      console.log("✅ Bot connected successfully!");
      await client.sendMessage(client.user.id, { text: "Hello, your bot is connected and running!" });
    }
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message || mek.key.fromMe) return;

      const chatId = mek.key.remoteJid;
      const messages = [];

      // Fetch last 5 messages for AI context
      const chatHistory = await client.loadMessages(chatId, 5);
      for (let msg of chatHistory) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
        if (text) {
          messages.push({
            role: msg.key.fromMe ? "assistant" : "user",
            content: text
          });
        }
      }

      // Always include the current incoming message as latest
      const incomingText = mek.message.conversation || mek.message.extendedTextMessage?.text || "";
      if (incomingText) {
        messages.push({
          role: "user",
          content: incomingText
        });
      }

      const reply = await aiReply(messages);
      await client.sendMessage(chatId, { text: reply });

    } catch (err) {
      console.log("❌ Message error:", err);
    }
  });

  app.get("/", (req, res) => {
    res.send("Baileys WhatsApp Bot is running!");
  });

  app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
  });
}

startBot();