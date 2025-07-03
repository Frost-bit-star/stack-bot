const {
  default: dreadedConnect,
  useMultiFileAuthState,
  DisconnectReason,
  getContentType,
  jidDecode
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const chalk = require("chalk");
const axios = require("axios");
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const color = (text, c) => (!c ? chalk.green(text) : chalk.keyword(c)(text));

let aiActive = false;
const ownerNumber = "254768974189@s.whatsapp.net";
let notifiedOnline = false;

async function aiReply(messages) {
  try {
    const systemPrompt = "You are replying as me in WhatsApp chats. Reply casually, naturally, and personally as a young, confident, funny guy. Always reply in first person as if you are me. Never mention AI, assistant, or anything robotic. Make replies feel real and authentic, with slang, jokes, emojis, and smooth compliments where relevant. Keep it short, natural, and fitting the flow of conversation.";

    const combinedText = systemPrompt + "\n\n" + messages.map(m => {
      return `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`;
    }).join('\n');

    const response = await axios.get("https://api.dreaded.site/api/chatgpt", {
      params: { text: combinedText }
    });

    return response.data?.result?.prompt || "😂 Sorry, brain jammed for a sec. Try again!";
  } catch (err) {
    console.log("AI API error:", err.response?.data || err.message);
    return "😂 Sorry, brain jammed for a sec. Try again!";
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const client = dreadedConnect({
    logger: pino({ level: "silent" }),
    browser: ["NecromancerBot", "Safari", "5.1.7"],
    markOnlineOnConnect: true,
    auth: state,
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed, reconnecting...", reason);
      if (reason !== DisconnectReason.loggedOut) {
        startBot();
      } else {
        console.log("❌ You have been logged out. Delete session and reconnect.");
      }
    } else if (connection === "open") {
      console.log(color("💀 Necromancer WhatsApp bot resurrected and running!", "magenta"));
      console.log("✅ Owner number set to:", ownerNumber);

      if (!notifiedOnline) {
        try {
          await client.sendMessage(ownerNumber, {
            image: fs.readFileSync(path.join(__dirname, "me.jpeg")),
            caption: "☠️ The Necromancer has risen...\n\nYour bot is connected and the darkness listens to your commands."
          });
          notifiedOnline = true;
        } catch (err) {
          console.log("❌ Failed to send online image:", err.message);
        }
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

      console.log("From:", from, "Text:", text, "IsCmd:", isCmd);

      // Owner commands
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
      if (from === "status@broadcast") {
        await client.readMessages([mek.key]);
        const emojis = ['🗿','⌚️','💠','👣','🍆','💔','🤍','❤️‍🔥','💣','🧠','🦅','🌻','🧊','🛑','🧸','👑','📍','😅','🎭','🎉','😳','💯','🔥','💫','🐒','💗','❤️‍🔥','👁️','👀','🙌','🙆','🌟','💧','🦄','🟢','🎎','✅','🥱','🌚','💚','💕','😉','😒'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await client.sendMessage(from, { react: { text: randomEmoji, key: mek.key } });
        console.log('Reaction sent successfully ✅️');
        return;
      }

      // AI replies
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
  res.send("💀 Necromancer WhatsApp Bot is alive and running!");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});