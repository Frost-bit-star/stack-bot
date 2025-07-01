const { session } = require("./settings");
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
const cheerio = require('cheerio');
const util = require("util");
const fetch = require('node-fetch');
const { exec, spawn, execSync } = require("child_process");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const color = (text, color) => (!color ? chalk.green(text) : chalk.keyword(color)(text));

let aiActive = false;
let ownerNumber;
const chatHistories = {}; // 🔥 stores last 5 messages per contact

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
  const sessionJson = Buffer.from(session, 'base64').toString('utf-8');
  const sessionFolder = './session';
  if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);
  fs.writeFileSync(`${sessionFolder}/creds.json`, sessionJson);

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  const client = dreadedConnect({
    logger: pino({ level: "silent" }),
    browser: ["BacktrackAI", "Safari", "5.1.7"],
    markOnlineOnConnect: true,
    auth: state,
  });

  client.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📌 Scan this QR to connect:\n", qr);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed, reconnecting...", reason);
      startBot();
    } else if (connection === "open") {
      console.log(color("🤖 WhatsApp bot connected and running!", "green"));
      ownerNumber = client.user.id;
      console.log("✅ Owner number detected:", ownerNumber);
      client.sendMessage(ownerNumber, { text: "✅ Bot is connected and online!" });
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

      // Fake typing indicator for every incoming message
      await client.sendPresenceUpdate('composing', from);
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Command handling with ownerNumber split fix
      if (isCmd && from.split("@")[0] === ownerNumber.split("@")[0]) {
        console.log("Owner command received:", text);
        const command = text.trim().toLowerCase();
        if (command === ".activateai") {
          aiActive = true;
          await client.sendMessage(from, { text: "🤖 AI Assistant activated. I'll start replying like your flirty funny self." });
        } else if (command === ".deactivate") {
          aiActive = false;
          await client.sendMessage(from, { text: "😴 AI Assistant deactivated. I'm off duty boss." });
        }
        return;
      }

      // Status view auto-react
      if (mek.key && mek.key.remoteJid === "status@broadcast") {
        await client.readMessages([mek.key]);
        const emojis = ['🗿','⌚️','💠','👣','🍆','💔','🤍','❤️‍🔥','💣','🧠','🦅','🌻','🧊','🛑','🧸','👑','📍','😅','🎭','🎉','😳','💯','🔥','💫','🐒','💗','❤️‍🔥','👁️','👀','🙌','🙆','🌟','💧','🦄','🟢','🎎','✅','🥱','🌚','💚','💕','😉','😒'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await client.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key } });
        console.log('Reaction sent successfully ✅️');
      }

      // AI reply
      if (aiActive && !mek.key.fromMe && from.endsWith("@s.whatsapp.net")) {
        // Initialize chat history if not exist
        if (!chatHistories[from]) chatHistories[from] = [];

        // Add current user message
        chatHistories[from].push({ role: "user", content: text });

        // Keep only last 5 messages
        if (chatHistories[from].length > 5) {
          chatHistories[from] = chatHistories[from].slice(-5);
        }

        const aiText = await aiReply(chatHistories[from]);

        // Add AI reply to history
        chatHistories[from].push({ role: "assistant", content: aiText });
        if (chatHistories[from].length > 5) {
          chatHistories[from] = chatHistories[from].slice(-5);
        }

        // Fake typing before AI reply
        await client.sendPresenceUpdate('composing', from);
        await new Promise(resolve => setTimeout(resolve, 1500));

        await client.sendMessage(from, { text: aiText });
      }

      // ✅ Additional merged features
      try {
        var body =
          mtype === "conversation"
            ? msg.conversation
            : mtype === "imageMessage"
            ? msg.caption
            : mtype === "videoMessage"
            ? msg.caption
            : mtype === "extendedTextMessage"
            ? msg.text
            : "";

        var budy = typeof text === "string" ? text : "";
        const textL = budy.toLowerCase();
        const quotedMessage = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // Save statuses with #save
        if (quotedMessage && textL.startsWith("#save") && mek.key.remoteJid.includes("status@broadcast")) {
          if (quotedMessage.imageMessage) {
            let imageCaption = quotedMessage.imageMessage.caption;
            let imageUrl = await client.downloadAndSaveMediaMessage(quotedMessage.imageMessage);
            client.sendMessage(ownerNumber, {
              image: { url: imageUrl },
              caption: imageCaption
            });
          }

          if (quotedMessage.videoMessage) {
            let videoCaption = quotedMessage.videoMessage.caption;
            let videoUrl = await client.downloadAndSaveMediaMessage(quotedMessage.videoMessage);
            client.sendMessage(ownerNumber, {
              video: { url: videoUrl },
              caption: videoCaption
            });
          }
        }

        // Auto save on "uhm|wow|nice|🙂"
        if (/^(uhm|wow|nice|🙂)/i.test(budy) && quotedMessage) {
          if (quotedMessage?.imageMessage) {
            let imageCaption = quotedMessage.imageMessage.caption || "";
            let imageUrl = await client.downloadAndSaveMediaMessage(quotedMessage.imageMessage);
            client.sendMessage(ownerNumber, {
              image: { url: imageUrl },
              caption: imageCaption
            });
          }

          if (quotedMessage?.videoMessage) {
            let videoCaption = quotedMessage.videoMessage.caption || "";
            let videoUrl = await client.downloadAndSaveMediaMessage(quotedMessage.videoMessage);
            client.sendMessage(ownerNumber, {
              video: { url: videoUrl },
              caption: videoCaption
            });
          }

          if (quotedMessage?.audioMessage) {
            let audioUrl = await client.downloadAndSaveMediaMessage(quotedMessage.audioMessage);
            client.sendMessage(ownerNumber, {
              audio: { url: audioUrl },
              mimetype: quotedMessage.audioMessage.mimetype,
              ptt: quotedMessage.audioMessage.ptt || false
            });
          }
        }

      } catch (e) {
        console.log("Main merged module error:", e);
      }

    } catch (err) {
      console.log("messages.upsert error:", err);
    }
  });

  client.ev.on("creds.update", saveCreds);
}

startBot();

app.get("/", (req, res) => {
  res.send("✅ Autoview Bot with AI, status saver, message history, and typing indicator is running!");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});