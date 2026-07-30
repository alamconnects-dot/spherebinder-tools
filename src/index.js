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

  const systemPrompt = `You are a senior education and career advisor for SphereBinder, an independent advisory firm in Sharjah, UAE. Write a personalised advisory report (250-350 words total) for a student, using ONLY the facts given below. Warm but realistic tone, British English.

Use these headings exactly:
## Overall Assessment
Synthesise all their results into one coherent picture — don't discuss each tool separately.
## Career Direction
What their SCIA profile means practically: likely strengths, work styles, and challenges.
## Degree Alignment
Whether their chosen degree fits their profile and stated goals.
## University & Investment
Note any cost-vs-fit trade-off. No financial or investment advice.
## Scholarships
One short note on priority. Never guarantee funding.
## Next Steps
Exactly 3 prioritised, specific actions — not vague advice like "do more research."

Hard rules: never invent universities, scholarships, statistics, or outcomes not given below. No immigration/visa/legal advice. No guaranteed outcomes (admission, funding, salary). No political or religious content. Don't name or push a specific paid SphereBinder package.`;

  const userPrompt = `Student has completed ${completedTools} SphereBinder tool(s). If only 1-2, note what's missing and suggest the next most useful tool. Results:
${parts.join('\n')}`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 900,
      temperature: 0.65
    });

    const guidance = (response && response.response) ? response.response.trim() : '';

    return json({ guidance: guidance || "Couldn't generate guidance right now — please try again in a moment." });
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
