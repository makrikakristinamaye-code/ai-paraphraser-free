Enter file contents here
// Vercel Serverless Function - DeepSeek Proxy + Key-based Paid Access + USDT Payment
const DEEPSEEK_API_KEY = "sk-a25622a11cf3443bb77e0092884630bc";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

let paidUsers = {};
let usageStore = {};
let pendingPayments = {};

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "para_";
  for (let i = 0; i < 24; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

const PLAN_MAP = { usdt_3: 5000, usdt_5: 10000, usdt_10: 25000 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // === GET ===
  if (req.method === "GET") {
    const { admin, email } = req.query;
    if (admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });

    if (!email) {
      // Full admin view with pendingPayments
      const totalApi = Object.values(usageStore).reduce((s, u) => s + u.count, 0);
      const paidList = Object.values(paidUsers).map(u => ({
        email: u.email, credits: u.credits, used: u.used,
        remaining: u.credits - u.used, apiKey: u.apiKey
      }));
      const pendings = Object.entries(pendingPayments)
        .filter(([_, p]) => !p.processed)
        .map(([email, p]) => ({ email, credits: p.credits, plan: p.plan, timestamp: p.timestamp }));
      return res.status(200).json({
        totalRequests: totalApi, paidUsers: paidList,
        pendingPayments: pendings, serverTime: new Date().toISOString()
      });
    }

    const user = paidUsers[email];
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.status(200).json({ email: user.email, apiKey: user.apiKey, credits: user.credits, used: user.used, remaining: user.credits - user.used });
  }

  // === POST ===
  const body = req.body || {};
  const { action } = body;

  // claimKey: user says they sent USDT
  if (action === "claimKey") {
    const { email, plan } = body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    if (paidUsers[email]) return res.status(200).json({ apiKey: paidUsers[email].apiKey });
    const credits = PLAN_MAP[plan] || 5000;
    pendingPayments[email] = { email, plan, credits, timestamp: new Date().toISOString(), processed: false };
    return res.status(200).json({ status: "pending", message: "Payment check submitted." });
  }

  // register: admin creates a paid user
  if (action === "register") {
    if (body.admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });
    const { email, credits } = body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    if (paidUsers[email]) return res.status(200).json({ error: "Already registered", apiKey: paidUsers[email].apiKey });
    const apiKey = generateKey();
    paidUsers[email] = { email, apiKey, credits: credits || 5000, used: 0 };
    // Mark pending as processed
    if (pendingPayments[email]) pendingPayments[email].processed = true;
    return res.status(200).json({ apiKey, credits: paidUsers[email].credits });
  }

  // addCredits: admin top-up
  if (action === "addCredits") {
    if (body.admin !== "bw4admin2026") return res.status(401).json({ error: "Unauthorized" });
    const { email, credits } = body;
    if (!email || !paidUsers[email]) return res.status(404).json({ error: "User not found" });
    paidUsers[email].credits += credits || 0;
    return res.status(200).json({ email, totalCredits: paidUsers[email].credits, used: paidUsers[email].used });
  }

  // Default: paraphrase
  const { text, apiKey } = body;
  if (!text) return res.status(400).json({ error: "Missing text" });

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (!usageStore[ip]) usageStore[ip] = { count: 0, firstSeen: Date.now(), lastActive: Date.now() };
  usageStore[ip].count++;
  usageStore[ip].lastActive = Date.now();

  let isUnlimited = false;
  if (apiKey) {
    const user = Object.values(paidUsers).find(u => u.apiKey === apiKey);
    if (user && user.used < user.credits) { isUnlimited = true; user.used++; }
    else if (user && user.used >= user.credits) return res.status(402).json({ error: "Credits exhausted. Contact @Alexis" });
  }

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": \`Bearer \${DEEPSEEK_API_KEY}\` },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "Paraphrase this text in English: " + text }] })
    });
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "Error processing request.";
    res.status(200).json({ result, unlimited: isUnlimited, used: isUnlimited ? Object.values(paidUsers).find(u => u.apiKey === apiKey)?.used : usageStore[ip].count });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
