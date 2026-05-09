const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

async function test() {
  try {
    const res = await openai.chat.completions.create({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [{role: 'user', content: 'Reply with exactly: {"status": "ok"}'}]
    });
    console.log("Success! Response:");
    console.log(res.choices[0].message.content);
  } catch (e) {
    console.error("Failed:", e);
  }
}

test();
