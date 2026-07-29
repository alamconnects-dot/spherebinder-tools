// Netlify Function: generates a short, personalized guidance paragraph
// based on the student's actual SphereBinder Snapshot results.
//
// Uses Google's Gemini API (free tier - gemini-2.5-flash) instead of a paid model,
// since this feature's realistic usage volume sits comfortably inside Gemini's
// free-tier daily quota. No ongoing cost under normal usage.
//
// Requires an environment variable set in Netlify:
//   Site settings -> Environment variables -> GEMINI_API_KEY
//   (get a key at https://aistudio.google.com/apikey — no credit card required)
//
// The API key NEVER touches the browser — it only lives here, server-side.
//
// Note on Gemini's free tier: Google's terms allow free-tier prompts/responses to be
// used to improve their models. This function only ever sends the student's SCIA type,
// scores, and roadmap goal — never their name, email, or phone (those stay in the
// separate Google Sheets lead-capture flow) — but this is still worth knowing.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' })
    };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  // Build a compact, factual description of only what the student has actually completed.
  // Never invent data the student hasn't entered.
  const parts = [];
  if (snapshot.scia) {
    parts.push(`SCIA career snapshot: ${snapshot.scia.typeName} (Holland Code: ${snapshot.scia.code}).`);
  }
  if (snapshot.degree) {
    parts.push(`Top degree match from their own ratings: ${snapshot.degree.name} (composite score ${Math.round(snapshot.degree.score)}/100).`);
  }
  if (snapshot.invest) {
    parts.push(`Lowest-cost university option they compared: ${snapshot.invest.name}, total estimated cost ${snapshot.invest.ccy} ${Math.round(snapshot.invest.amount).toLocaleString()}.`);
  }
  if (snapshot.uni) {
    parts.push(`Best-fit university by their weighted ranking+priority score: ${snapshot.uni.name} (fit score ${Math.round(snapshot.uni.score)}/100).`);
  }
  if (snapshot.scholarship) {
    parts.push(`Tracking ${snapshot.scholarship.count} scholarship(s), potential value up to ${Math.round(snapshot.scholarship.total).toLocaleString()}.`);
  }
  if (snapshot.roadmap) {
    parts.push(`Stated long-term goal: "${snapshot.roadmap.goal}".`);
  }

  if (parts.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ guidance: "Complete at least one tool above — the SCIA Assessment is the best place to start — and this will generate guidance based on your actual results." })
    };
  }

  // System instructions include UAE-specific regulatory guardrails:
  // - Career/education counselling guidance is fine; immigration/visa and financial-product
  //   advice are separately regulated activities in the UAE and must not be given here.
  // - No guaranteed-outcome or unsubstantiated claims (relevant to UAE consumer protection
  //   and advertising standards around education/career services).
  // - Keep tone professional and culturally neutral (no political or religious content).
  const systemPrompt = `You are a warm, direct education and career advisor writing a short guidance note for a student, on behalf of SphereBinder, an independent education advisory firm licensed in Sharjah, UAE. You are given only the facts below, taken from the student's own inputs into SphereBinder's free tools.

Write 3-5 sentences that:
- Connect the specific pieces of information together (don't just restate them separately)
- Point out one genuine tension or thing worth thinking about, if the data suggests one (e.g., a cost vs. fit tradeoff, a mismatch between stated goal and top matches)
- End with one concrete, specific next step
- Write in second person ("you"), plain language, no headers or bullet points, just prose

Hard constraints (do not violate these):
- Do NOT invent facts, statistics, or data not given below
- Do NOT recommend a specific paid SphereBinder package by name — keep it advisory, not a sales pitch
- Do NOT give immigration, visa, or residency advice of any kind — that is a separately regulated activity; if relevant, only suggest the student speak with a licensed immigration advisor
- Do NOT give financial, investment, loan, or banking product advice or recommendations — only general education-cost awareness is in scope
- Do NOT guarantee or imply a guaranteed outcome (e.g., admission, scholarship success, career salary) — use cautious, non-promissory language
- Avoid political, religious, or culturally sensitive content entirely — keep the tone professional and neutral`;

  const userPrompt = `Student's SphereBinder results so far:\n${parts.join('\n')}`;

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 400 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'AI provider error', detail: errText }) };
    }

    const data = await response.json();
    const candidate = (data.candidates && data.candidates[0]) || null;
    const guidance = candidate
      ? (candidate.content.parts || []).map(p => p.text || '').join('').trim()
      : '';

    return {
      statusCode: 200,
      body: JSON.stringify({ guidance: guidance || "Couldn't generate guidance right now — please try again in a moment." })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error', detail: String(e) }) };
  }
};
