// Vercel Serverless Function - DeepSeek Proxy + Key-based Paid Access
const DEEPSEEK_API_KEY = "sk-a25622a11cf3443bb77e0092884630bc";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

let paidUsers = {};
let usageStore = {};

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "para_";
  for (let i = 0; i < 24; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

let pendingPayments = {};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { admin, email } = req.query;
    if (admin === "bw4admin2026" && !email) {
      const now = new Date().toISOString();
      const totalApi = Object.values(usageStore).reduce((s, u) => s + u.count, 0);
      const users = Object.entries(usageStore).map(([ip, u]) => ({
        ip, ...u,
        lastActive: new Date(u.lastActive).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
      }));
      users.sort((a, b) => b.count - a.count);
      const paidList = Object.values(paidUsers).map(u => ({
        email: u.email, credits: u.credits, used: u.used,
        remaining: u.credits - u.used, apiKey: u.apiKey
      }));
      return res.status(200).json({
        totalRequests: totalApi, activeUsers: users.length,
        users, paidUsers: paidList, serverTime: now,
        pendingPayments: Object.values(pendingPayments).filter(p => !p.processed).length
      });
    }
    if (admin === "bw4admin2026" && email) {
      const user = paidUsers[email];
      if (!user) return res.status(404).json({ error: "User not found" });
      return res.status(200).json({ email: user.email, apiKey: user.apiKey, credits: user.credits, used: user.used, remaining: user.credits - user.used });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "POST" && req.body?.action === "claimKey") {
    const { email, plan } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    if (paidUsers[email]) return res.status(200).json({ apiKey: paidUsers[email].apiKey });
    const planMap = { usdt_3: 5000, usdt_5: 10000, usdt_10: 25000 };
    const credits = planMap[plan] || 5000;
    pendingPayments[email] = { email, plan, credits, timestamp: new Date().toISOString(), notified: false, processed: false };
    return res.status(200).json({ status: "pending", message: "Payment check submitted. If USDT is detected, your API Key will be sent to your email." });
  }

  if (req.method === "POST" && req.body?.action === "register") {
    const { admin, email, credits } = req.body;
    if (admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });
    if (!email) return res.status(400).json({ error: "Missing email" });
    if (paidUsers[email]) return res.status(200).json({ error: "Already registered", apiKey: paidUsers[email].apiKey });
    const apiKey = generateKey();
    paidUsers[email] = { email, apiKey, credits: credits || 5000, used: 0 };
    return res.status(200).json({ apiKey, credits: paidUsers[email].credits });
  }

  if (req.method === "POST" && req.body?.action === "addCredits") {
    const { admin, email, credits } = req.body;
    if (admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });
    if (!email || !paidUsers[email]) return res.status(404).json({ error: "User not found" });
    paidUsers[email].credits += credits || 0;
    return res.status(200).json({ email, totalCredits: paidUsers[email].credits, used: paidUsers[email].used });
  }

  if (req.method === "POST") {
    const { text, apiKey } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (!usageStore[ip]) usageStore[ip] = { count: 0, firstSeen: Date.now(), lastActive: Date.now() };
    usageStore[ip].count++; usageStore[ip].lastActive = Date.now();
    let isUnlimited = false;
    if (apiKey) {
      const user = Object.values(paidUsers).find(u => u.apiKey === apiKey);
      if (user && user.used < user.credits) { isUnlimited = true; user.used++; }
      else if (user && user.used >= user.credits) return res.status(402).json({ error: "Credits exhausted. Contact @Alexis on Telegram to buy more." });
    }
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "Paraphrase this text in English: " + text }] })
      });
      const data = await response.json();
      const result = data.choices?.[0]?.message?.content || "Error processing request.";
      res.status(200).json({ result, unlimited: isUnlimited, used: isUnlimited ? Object.values(paidUsers).find(u => u.apiKey === apiKey)?.used : usageStore[ip].count });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
