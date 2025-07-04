const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
require("dotenv").config();

const REPO_DIR = path.resolve(__dirname, "backup");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN environment variable not set.");
}

// ✅ Hardcoded GitHub repo
const REPO_URL = `https://${GITHUB_TOKEN}@github.com/Frost-bit-star/Necromancer-storage.git`;

async function generateCommitMessage() {
  try {
    const prompt = "Write a very short, two-word, dark necromancer-themed git commit message about saving backup or resurrecting data. Only output the two words.";
    const response = await axios.get("https://api.dreaded.site/api/chatgpt", { params: { text: prompt } });

    if (response.data && response.data.result && response.data.result.prompt) {
      const msg = response.data.result.prompt.trim();
      // ✅ Force it to two words max
      const twoWords = msg.split(/\s+/).slice(0,2).join(' ');
      return twoWords;
    } else {
      return "Necro Update";
    }
  } catch (err) {
    console.log("❌ Failed to generate AI commit message:", err.message);
    return "Necro Update";
  }
}

async function gitInit() {
  if (!fs.existsSync(REPO_DIR)) {
    console.log("📥 Cloning backup repo...");
    try {
      execSync(`git clone ${REPO_URL} ${REPO_DIR}`, { stdio: "inherit" });

      // ✅ Set Git global username and email after cloning
      execSync(`git -C ${REPO_DIR} config user.name "Frost-bit-star"`, { stdio: "inherit" });
      execSync(`git -C ${REPO_DIR} config user.email "morganmilstone983@gmail.com"`, { stdio: "inherit" });

    } catch (cloneErr) {
      console.error("❌ Git clone failed:", cloneErr.message);
    }
  } else {
    console.log("🔄 Backup repo already cloned, pulling latest...");
    gitPull();
  }
}

function gitPull() {
  try {
    console.log("🔄 Pulling latest backup from GitHub...");
    execSync(`git -C ${REPO_DIR} pull`, { stdio: "inherit" });
  } catch (e) {
    console.error("❌ Git pull error:", e.message);
  }
}

async function gitPush() {
  let commitMsg = await generateCommitMessage();

  // ✅ Strip surrounding quotes to prevent pathspec errors
  commitMsg = commitMsg.replace(/^["'](.+(?=["']$))["']$/, '$1');

  try {
    // ✅ Ensure Git username and email are set before commit
    execSync(`git -C ${REPO_DIR} config user.name "Frost-bit-star"`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} config user.email "morganmilstone983@gmail.com"`, { stdio: "inherit" });

    console.log("📤 Pushing backup to GitHub with commit:", commitMsg);
    execSync(`git -C ${REPO_DIR} add .`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} commit -m "${commitMsg}"`, { stdio: "inherit" });

    execSync(`git -C ${REPO_DIR} remote set-url origin ${REPO_URL}`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} push`, { stdio: "inherit" });
    console.log("✅ Backup pushed to GitHub");
  } catch (e) {
    if (!e.message.includes("nothing to commit")) {
      console.error("❌ Git push error:", e.message);
    } else {
      console.log("ℹ️ Nothing to commit, backup unchanged.");
    }
  }
}

function copyFiles() {
  const sessionDir = path.resolve(__dirname, "session");
  const dbFile = path.resolve(__dirname, "data.db");

  if (!fs.existsSync(REPO_DIR)) return;

  // ✅ Copy session folder to backup
  if (fs.existsSync(sessionDir)) {
    console.log("📁 Backing up session directory...");
    fs.cpSync(sessionDir, path.join(REPO_DIR, "session"), { recursive: true, force: true });
  }

  // ✅ Copy database file to backup
  if (fs.existsSync(dbFile)) {
    console.log("📄 Backing up database file...");
    fs.copyFileSync(dbFile, path.join(REPO_DIR, "data.db"));
  }
}

module.exports = {
  gitInit,
  gitPull,
  gitPush,
  copyFiles,
};