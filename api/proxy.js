// Vercel Serverless - DeepSeek Proxy + Usage Tracking
const DEEPSEEK_API_KEY = "sk-a25622a11cf3443bb77e0092884630bc";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
let usageStore = {};
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    const { admin } = req.query;
    if (admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });
    const users = Object.entries(usageStore).map(([ip, u]) => ({ ip, count: u.count, firstSeen: new Date(u.firstSeen).toLocaleString("zh-CN"), lastActive: new Date(u.lastActive).toLocaleString("zh-CN") }));
    users.sort((a, b) => b.count - a.count);
    return res.status(200).json({ totalRequests: users.reduce((s, u) => s + u.count, 0), activeUsers: users.length, users });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Missing text" });
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (!usageStore[ip]) usageStore[ip] = { count: 0, firstSeen: Date.now(), lastActive: Date.now() };
  usageStore[ip].count++;
  usageStore[ip].lastActive = Date.now();
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + DEEPSEEK_API_KEY },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "Paraphrase this text in English: " + text }] })
    });
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "Error.";
    res.status(200).json({ result, used: usageStore[ip].count });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
