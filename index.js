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
const { Boom } = require("@hapi/boom");
const { session } = require("./settings");

const app = express();
const PORT = process.env.PORT || 3000;
const color = (text, color) => (!color ? chalk.green(text) : chalk.keyword(color)(text));

let aiActive = false;
const ownerNumber = "254768974189@s.whatsapp.net";

let notifiedOnline = false; // ✅ prevent repeated online notifications

async function initializeSession() {
  const credsPath = path.join(__dirname, "session", "creds.json");
  try {
    const decoded = Buffer.from(session, "base64").toString("utf-8");
    if (!fs.existsSync(credsPath)) {
      console.log("📡 writing session creds.json from settings.js...");
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, decoded, "utf8");
    }
  } catch (e) {
    console.log("❌ Session initialization error:", e);
  }
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
  await initializeSession();

  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const client = dreadedConnect({
    logger: pino({ level: "silent" }),
    browser: ["NecromancerBot", "DarkSafari", "6.6.6"],
    markOnlineOnConnect: true,
    auth: state,
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("Connection closed, reconnecting...", reason);
      if (reason === DisconnectReason.badSession) {
        console.log("Bad session, deleting and exiting.");
        fs.rmSync('./session', { recursive: true, force: true });
        process.exit(1);
      } else {
        startBot();
      }
    } else if (connection === "open") {
      console.log(color("💀 Necromancer WhatsApp bot resurrected and running!", "magenta"));
      console.log("✅ Owner number set to:", ownerNumber);
      if (!notifiedOnline) {
        client.sendMessage(ownerNumber, {
          image: fs.readFileSync(path.join(__dirname, "me.jpeg")),
          caption: "☠️ The Necromancer has risen...\n\nYour bot is connected and the darkness listens to your commands."
        });
        notifiedOnline = true;
      }
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

      // Debug logs
      console.log("From:", from, "Text:", text, "IsCmd:", isCmd);

      // Command handling with necromancer replies
      if (from === ownerNumber && isCmd) {
        const command = text.trim().toLowerCase();
        if (command === ".activateai") {
          aiActive = true;
          await client.sendMessage(from, {
            image: fs.readFileSync(path.join(__dirname, "me.jpeg")),
            caption: "☠️ Someone summons the necromancer...\n\nI am here... say the word and I will do as you command."
          });
        } else if (command === ".deactivate") {
          aiActive = false;
          await client.sendMessage(from, {
            text: "💀 I will return to the land of the dead...\nBut if you need me, just summon me.\n\nRemember... the word is .activateai"
          });
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

      // AI reply with fake typing (necromancer active)
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

      // ✅ Additional merged features
      try {
        const textL = text.toLowerCase();
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
        if (/^(uhm|wow|nice|🙂)/i.test(textL) && quotedMessage) {
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
}

startBot();

app.get("/", (req, res) => {
  res.send("💀 Necromancer Bot with AI and status saver is alive and waiting in the shadows.");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});