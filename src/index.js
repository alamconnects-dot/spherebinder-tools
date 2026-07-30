// Cloudflare Worker (with Static Assets): serves the SphereBinder Student Tools
// site, and handles the /api/ai-guidance route for the AI Guidance feature.
//
// Uses Cloudflare Workers AI (env.AI binding) to generate the report — this runs
// directly on Cloudflare's own infrastructure, so no external API key is needed
// and no cross-provider geo-blocking is possible (unlike calling Gemini directly,
// which failed with "User location is not supported" depending on which edge
// colo Cloudflare routed the request through).
//
// Free tier: 10,000 Neurons/day, no credit card required. The "ai" binding in
// wrangler.jsonc is all that's needed — Cloudflare handles auth automatically.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/ai-guidance') {
      return handleAiGuidance(request, env);
    }

    // Everything else: serve the static site (index.html, images, etc.)
    return env.ASSETS.fetch(request);
  }
};

async function handleAiGuidance(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  let snapshot;
  try {
    snapshot = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

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
    return json({ guidance: "Complete at least one tool above — the SCIA Assessment is the best place to start — and this will generate guidance based on your actual results." });
  }

  const completedTools = parts.length;

  const systemPrompt = `You are a senior education and career counsellor with 15+ years of experience, writing on behalf of SphereBinder, an independent advisory firm in Sharjah, UAE. Write a personalised advisory report (300-400 words) for a student, using ONLY the facts given below. British English.

Write like an experienced human counsellor giving direct, specific advice — not a generic AI summary. Concretely:
- Reference the actual numbers and names given below (the specific university, the actual AED figure, the actual score) — never write vaguely about "your results" without naming what they are.
- Give an actual opinion or judgement call where the data supports one — a real counsellor says "this is worth pursuing because X" or "I'd push back on Y", not just "there is a trade-off to consider."
- Avoid AI-sounding stock phrases like "reveals a compelling intersection," "paints a picture," or "highlights a significant point." Write plainly, the way a sharp advisor would talk to a family across a desk.

Use these headings exactly:
## Overall Assessment
One coherent judgement connecting all their results — not a list of each tool's output separately.
## Career Direction
What their SCIA profile means practically: likely strengths, work styles, and one genuine challenge to watch for.
## Degree Alignment
A direct verdict on fit between their degree choice and their profile/goals — say clearly if it's a strong fit or a stretch.
## University & Investment
Name the actual university and cost figure given. State plainly whether it's good value or a stretch, and why.
## Scholarships
One concrete, specific note tied to their actual tracked amount — not a generic "consider applying early."
## Next Steps
Exactly 3 prioritised, specific actions tied to their actual results — not vague advice like "do more research."

Hard rules: never invent universities, scholarships, statistics, or outcomes not given below. No immigration/visa/legal advice. No guaranteed outcomes (admission, funding, salary). No political or religious content. Don't name or push a specific paid SphereBinder package.`;

  const userPrompt = `Student has completed ${completedTools} SphereBinder tool(s). If only 1-2, note what's missing and suggest the next most useful tool. Results:
${parts.join('\n')}`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1100,
      temperature: 0.65
    });

    // Defensive parsing: different Workers AI models occasionally shape their
    // response differently (e.g. reasoning models split "reasoning" vs "response").
    // Try the common shapes before giving up.
    let guidance = '';
    if (response) {
      if (typeof response.response === 'string') guidance = response.response;
      else if (typeof response.result === 'string') guidance = response.result;
      else if (response.choices && response.choices[0] && response.choices[0].message) guidance = response.choices[0].message.content || '';
    }
    guidance = (guidance || '').trim();

    if (!guidance) {
      // Surface exactly what the model returned so this can be diagnosed instead of guessed at again.
      return json({
        error: 'Empty response from model',
        detail: JSON.stringify(response).slice(0, 500)
      }, 502);
    }

    return json({ guidance });
  } catch (e) {
    return json({ error: 'Server error', detail: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
