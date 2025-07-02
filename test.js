const fetch = require('node-fetch');

async function testAI() {
  const inputText = "Hello AI, how are you today?";

  try {
    const response = await fetch(`https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(inputText)}`);
    const data = await response.json();

    console.log("✅ AI API response:");
    console.log(data);
  } catch (err) {
    console.error("❌ Error testing AI endpoint:", err);
  }
}

testAI();
