// api/audit.js — Tender Audit AI engine (Vercel serverless function)
// -------------------------------------------------------------------
// SETUP (do this once, after deploying):
//   1. Get an API key at https://console.anthropic.com  (Settings -> API Keys)
//   2. In Vercel: your project -> Settings -> Environment Variables
//        Name:  ANTHROPIC_API_KEY
//        Value: your key (starts sk-ant-...)
//   3. Redeploy. The checker on the site will then return REAL audits.
//   4. IMPORTANT: in the Anthropic console, set a monthly spend limit so costs can't run away.
//
// Until the key is set, the site falls back to a sample result automatically — nothing breaks.

// Model: Haiku is cheapest/fastest and fine for the free checker.
// Confirm the current model name in your Anthropic console; swap to a Sonnet model for higher quality.
const MODEL = "claude-haiku-4-5-20251001";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Tells the front-end the engine isn't wired yet, so it shows the sample instead.
    res.status(503).json({ error: "not_configured" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // Cap tender length to control cost (about 20k chars is plenty for a notice).
    const tender = (body.tender || "").toString().slice(0, 20000);
    if (tender.trim().length < 40) {
      res.status(400).json({ error: "Please paste a tender notice (at least a few lines)." });
      return;
    }

    const region = body.region === "ni" ? "Northern Ireland" : "Ireland";
    const sector = body.sector || "Not stated";
    const turnover = body.turnover || "Not stated";
    const insurance = body.insurance || "Not stated";
    const years = body.years || "Not stated";
    const experience = body.experience || "Not stated";
    const deadline = body.deadline || "see notice";
    const today = new Date().toISOString().slice(0, 10);

    const prompt =
`You are a senior public-procurement analyst specialising in tender readiness for the Republic of Ireland (eTenders.gov.ie) and Northern Ireland (eTendersNI).

Analyse the TENDER NOTICE below for a supplier with this profile:
- Region: ${region}
- Sector: ${sector}
- Annual turnover: ${turnover}
- Insurance held: ${insurance}
- Years trading: ${years}
- Similar public-sector experience: ${experience}
- Today's date: ${today}; user-entered deadline: ${deadline}

RULES:
- Extract facts ONLY from the tender text. If something is not stated, use "Not stated" — never invent thresholds, values or dates.
- Judge fit by comparing the tender's requirements against the supplier profile above.
- Be concise: every note and list item max 12 words.
- Do NOT encourage underpricing; if anything, flag the risk of bidding too low.
- Score 0-100. Verdict: "Bid" if 70+, "Maybe" if 45-69, "No-Bid" if under 45.

Return ONLY a valid JSON object (no markdown fences, no commentary) with EXACTLY these keys:
{
 "verdict": "Bid | Maybe | No-Bid",
 "score": <integer 0-100>,
 "summary": "<one short sentence>",
 "breakdown": [
   {"area":"Deadline risk","rating":"<short>","note":"<max 12 words>"},
   {"area":"Insurance fit","rating":"<short>","note":"<max 12 words>"},
   {"area":"Experience fit","rating":"<short>","note":"<max 12 words>"},
   {"area":"Turnover requirement","rating":"<short>","note":"<max 12 words>"},
   {"area":"Required documents","rating":"<short>","note":"<max 12 words>"},
   {"area":"Compliance risk","rating":"<short>","note":"<max 12 words>"},
   {"area":"Scoring clarity","rating":"<short>","note":"<max 12 words>"}
 ],
 "effort": "<e.g. 8-12 hours>",
 "recommendation": "<one short actionable line>",
 "documents": ["<required document>", "... up to 8"],
 "risks": ["<top risk>", "... up to 5"]
}

TENDER NOTICE:
"""
${tender}
"""`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      res.status(502).json({ error: "engine_error", detail: detail.slice(0, 300) });
      return;
    }

    const data = await apiRes.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const clean = raw.replace(/```json/g, "").replace(/```/g, "").trim();

    let audit;
    try {
      audit = JSON.parse(clean);
    } catch (e) {
      res.status(502).json({ error: "parse_error" });
      return;
    }

    res.status(200).json(audit);
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e).slice(0, 300) });
  }
};
