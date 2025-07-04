// index.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidDecode, getContentType, proto } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const chalk = require("chalk");
const axios = require("axios");
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { session } = require("./settings");
const gitBackup = require("./gitbackup");

const app = express();
const PORT = process.env.PORT || 10000;
const ownerNumber = "254768974189@s.whatsapp.net";

const credsPath = path.join(__dirname, "session", "creds.json");

function color(text, c) {
  return c ? chalk.keyword(c)(text) : chalk.green(text);
}

// === Write creds.json from settings.js if valid ===
try {
  const decoded = Buffer.from(session, "base64").toString("utf-8");
  if (!decoded.includes('"noiseKey"') || !decoded.includes('"me"')) {
    throw new Error("Invalid session base64 data in settings.js");
  }
  fs.mkdirSync(path.dirname(credsPath), { recursive: true });
  fs.writeFileSync(credsPath, decoded, "utf8");
  console.log("✅ Session creds.json written from settings.js");
} catch (e) {
  console.error("❌ Failed to write valid session creds.json:", e.message);
}

// === Initialize SQLite DB (async) ===
const db = new sqlite3.Database(path.join(__dirname, "data.db"), (err) => {
  if (err) console.error("DB open error:", err.message);
  else console.log("✅ SQLite database initialized");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
});

// === Helper functions to get/set AI status ===
function getAIStatus(callback) {
  db.get(`SELECT value FROM settings WHERE key = 'aiActive'`, (err, row) => {
    if (err) return callback(false);
    callback(row ? row.value === "true" : false);
  });
}

function setAIStatus(status) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiActive', ?)`, [String(status)]);
  backupData();
}

// === Backup data to Git ===
async function backupData() {
  try {
    gitBackup.copyFiles();
    await gitBackup.gitPush();
  } catch (e) {
    console.error("❌ Backup data error:", e);
  }
}

// === Restore backup files before bot starts ===
(async () => {
  try {
    await gitBackup.gitInit();
    await gitBackup.gitPull();

    const backupDb = path.resolve(__dirname, "backup", "data.db");
    if (fs.existsSync(backupDb)) {
      fs.copyFileSync(backupDb, path.join(__dirname, "data.db"));
      console.log("✅ Restored data.db from backup");
    }

    const backupSession = path.resolve(__dirname, "backup", "session");
    if (fs.existsSync(backupSession)) {
      fs.cpSync(backupSession, path.join(__dirname, "session"), { recursive: true, force: true });
      console.log("✅ Restored session from backup");
    }
  } catch (e) {
    console.error("❌ Backup initialization error:", e);
  }
})();

// === AI reply function with your original prompt ===
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

// === Start WhatsApp bot ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const client = makeWASocket({
    logger: pino({ level: "silent" }),
    browser: ["NecromancerBot", "Chrome", "1.0.0"],
    auth: state,
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed:", reason);

      if ([DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.loggedOut].includes(reason)) {
        console.log("❌ Invalid session or replaced. Exiting...");
        process.exit();
      } else {
        console.log("🔄 Reconnecting in 5s...");
        setTimeout(() => startBot(), 5000);
      }
    }

    if (connection === "open") {
      console.log(color("💀 Necromancer WhatsApp bot resurrected!", "magenta"));
      try {
        await client.sendMessage(ownerNumber, {
          text: "☠️ The Necromancer has risen. Awaiting your dark commands."
        });
      } catch (err) {
        console.log("❌ Failed to notify owner:", err.message);
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

      console.log("From:", from, "Text:", text);

      // Commands
      if (from === ownerNumber && text.startsWith(".")) {
        const command = text.trim().toLowerCase();
        if (command === ".activateai") {
          setAIStatus(true);
          await client.sendMessage(from, { text: "🔮 The Necromancer AI is awake." });
        } else if (command === ".deactivate") {
          setAIStatus(false);
          await client.sendMessage(from, { text: "💀 The Necromancer AI returns to shadows." });
        }
        return;
      }

      // AI reply
      getAIStatus(async (active) => {
        if (active && !mek.key.fromMe && from.endsWith("@s.whatsapp.net")) {
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
      });

    } catch (err) {
      console.error("messages.upsert error:", err);
    }
  });
}

startBot();

// === Express endpoint ===
app.get("/", (req, res) => {
  res.send("💀 Necromancer WhatsApp bot is running and awaiting commands!");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});

// === Global error handlers ===
process.on('unhandledRejection', (reason, p) => {
  console.log('🔥 Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.log('🔥 Uncaught Exception thrown:', err);
});