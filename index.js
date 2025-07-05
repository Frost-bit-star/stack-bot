// index.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, getContentType } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
require("dotenv").config();

const { session } = require("./settings");
const gitBackup = require("./gitbackup");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ownerNumber = "254768974189@s.whatsapp.net";
const credsPath = path.join(__dirname, "session", "creds.json");

function color(text, c) {
  return c ? chalk.keyword(c)(text) : chalk.green(text);
}

// === Initialize SQLite DB ===
const db = new sqlite3.Database(path.join(__dirname, "data.db"), (err) => {
  if (err) console.error("DB open error:", err.message);
  else console.log("✅ SQLite database initialized");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
});

// === AI Status Helpers ===
function getAIStatus(callback) {
  db.get(`SELECT value FROM settings WHERE key = 'aiActive'`, (err, row) => {
    if (err) return callback(false);
    callback(row ? row.value === "true" : false);
  });
}

function setAIStatus(status, callback = () => {}) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiActive', ?)`, [String(status)], callback);
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

// === AI reply function ===
async function aiReply(messages) {
  try {
    const systemPrompt = "You are replying as me in WhatsApp chats. Reply casually, naturally, and personally as a young, confident, funny guy. Never mention AI or robotic phrases. Keep it short, authentic, and fun.";

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

async function initializeSession() {
  try {
    const decoded = Buffer.from(session, "base64").toString("utf-8");
    if (!decoded.includes('"noiseKey"') || !decoded.includes('"me"')) {
      throw new Error("Invalid base64 session data in settings.js");
    }
    fs.mkdirSync(path.dirname(credsPath), { recursive: true });
    fs.writeFileSync(credsPath, decoded, "utf8");
    console.log("✅ Session creds.json restored from base64");
  } catch (e) {
    console.error("❌ Failed to write valid session creds.json:", e.message);
  }
}

async function startBot() {
  await initializeSession();

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  console.log("🔌 Connecting to WhatsApp...");

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
      console.log("❌ Connection closed. Reason:", reason);

      if ([DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.loggedOut].includes(reason)) {
        console.log("⚠️ Invalid session or replaced. Exiting...");
        process.exit();
      } else {
        console.log("🔄 Reconnecting in 5s...");
        setTimeout(() => startBot(), 5000);
      }
    } else if (connection === "open") {
      console.log(color("💀 Necromancer WhatsApp bot resurrected and stable!", "magenta"));
      try {
        await client.sendMessage(ownerNumber, {
          text: "☠️ The Necromancer is online and ready."
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

      if (from === ownerNumber && text.startsWith(".")) {
        const command = text.trim().toLowerCase();
        if (command === ".activateai") {
          setAIStatus(true, async () => {
            await client.sendMessage(from, { text: "🔮 The Necromancer AI is awake." });
          });
        } else if (command === ".deactivate") {
          setAIStatus(false, async () => {
            await client.sendMessage(from, { text: "💀 The Necromancer AI returns to shadows." });
          });
        }
        return;
      }

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

// === Express endpoints ===
app.get("/", (req, res) => {
  res.send("💀 Necromancer WhatsApp bot is running and stable!");
});

app.get("/ai-status", (req, res) => {
  getAIStatus((status) => {
    res.json({ aiActive: status });
  });
});

app.post("/activate-ai", (req, res) => {
  setAIStatus(true, () => {
    res.json({ message: "AI activated" });
  });
});

app.post("/deactivate-ai", (req, res) => {
  setAIStatus(false, () => {
    res.json({ message: "AI deactivated" });
  });
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

// === Main startup ===
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

    startBot();
  } catch (e) {
    console.error("❌ Startup error:", e);
  }
})();