// bot.js

const sessionName = "session";
const {
  default: dreadedConnect,
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage,
  jidDecode,
  proto,
  getContentType,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const axios = require("axios");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const color = (text, color) => (!color ? chalk.green(text) : chalk.keyword(color)(text));

let aiActive = false;

/**
 * AI Reply function using your provided endpoint
 * Updated system prompt to ensure replies remain natural, personal, and on-topic
 */
async function aiReply(messages) {
  try {
    const systemPrompt = "You are replying as me in WhatsApp chats. Reply casually, naturally, and personally as a young, confident, funny guy. Always reply in first person as if you are me. Never mention AI, assistant, or anything robotic. Make replies feel real and authentic, with slang, jokes, emojis, and smooth compliments where relevant. Keep it short, natural, and fitting the flow of conversation. Do not sound like a chatbot or motivational speaker. Do not say 'I'm here for you' or 'let me know what's up'. Always read previous messages carefully and reply naturally to the latest one as if you are continuing the conversation seamlessly.";

    // Combine system prompt with chat history for context
    const combinedText = systemPrompt + "\n\n" + messages.map(m => {
      return `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`;
    }).join('\n');

    // Call your API via GET with URL-encoded text
    const response = await axios.get("https://api.dreaded.site/api/chatgpt", {
      params: {
        text: combinedText
      }
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
  const { state, saveCreds } = await useMultiFileAuthState(`./${sessionName}`);
  const client = dreadedConnect({
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["BacktrackAI", "Safari", "5.1.7"],
    markOnlineOnConnect: true,
    auth: state,
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

      // Command handling
      if (mek.key.fromMe && isCmd) {
        if (text === ".activateai") {
          aiActive = true;
          await client.sendMessage(from, { text: "🤖 AI Assistant activated. I'll start replying like your flirty funny self." });
        } else if (text === ".deactivate") {
          aiActive = false;
          await client.sendMessage(from, { text: "😴 AI Assistant deactivated. I'm off duty boss." });
        }
        return;
      }

      // Auto-view statuses with random emoji reaction
      if (mek.key && mek.key.remoteJid === "status@broadcast") {
        await client.readMessages([mek.key]);
        const emojis = ['🗿','⌚️','💠','👣','🍆','💔','🤍','❤️‍🔥','💣','🧠','🦅','🌻','🧊','🛑','🧸','👑','📍','😅','🎭','🎉','😳','💯','🔥','💫','🐒','💗','❤️‍🔥','👁️','👀','🙌','🙆','🌟','💧','🦄','🟢','🎎','✅','🥱','🌚','💚','💕','😉','😒'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await client.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key } });
        console.log('Reaction sent successfully ✅️');
      }

      // AI auto-reply if activated and message is from others
      if (aiActive && !mek.key.fromMe && from.endsWith("@s.whatsapp.net")) {
        const history = await client.fetchMessagesFromJid(from, 10);
        const messages = history.map(h => ({
          role: h.key.fromMe ? "assistant" : "user",
          content: h.message?.conversation || h.message?.extendedTextMessage?.text || ""
        }));
        messages.push({ role: "user", content: text }); // append latest message
        const aiText = await aiReply(messages);
        await client.sendMessage(from, { text: aiText });
      }

      // Continue with your existing features here (example: main commands handler)
      try {
        require("./main")(client, mek, chatUpdate);
      } catch (e) {
        console.log("Main module error:", e);
      }

    } catch (err) {
      console.log("messages.upsert error:", err);
    }
  });

  client.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      console.log("Connection closed, reconnecting...", reason);
      startBot();
    } else if (connection === "open") {
      console.log(color("🤖 WhatsApp bot connected and running!", "green"));
    }
  });

  client.ev.on("creds.update", saveCreds);
}

startBot();

// Express server routes
app.get("/", (req, res) => {
  res.send("✅ Autoview Bot with AI is running!");
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});