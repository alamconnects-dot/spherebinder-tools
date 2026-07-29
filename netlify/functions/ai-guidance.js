// Netlify Function: Generates a personalised SphereBinder Advisory Report
// based on the student's completed SphereBinder tools.
// Uses the Gemini API to analyse relationships between the student's
// career profile, degree matches, university comparisons, scholarships
// and long-term goals, then provides practical recommendations.
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

  const completedTools = parts.length;

  // System instructions include UAE-specific regulatory guardrails:
  // - Career/education counselling guidance is fine; immigration/visa and financial-product
  //   advice are separately regulated activities in the UAE and must not be given here.
  // - No guaranteed-outcome or unsubstantiated claims (relevant to UAE consumer protection
  //   and advertising standards around education/career services).
  // - Keep tone professional and culturally neutral (no political or religious content).
  const systemPrompt = `You are a senior education and career advisor writing on behalf of SphereBinder, an independent education advisory firm licensed in Sharjah, UAE.
You are preparing a personalised advisory report for a student based only on the results they have generated using SphereBinder's free tools.
Your advice should reflect the quality of an experienced education consultant rather than a generic AI response.
Write confidently but realistically using professional British English.
Write a personalised advisory report of approximately 300–500 words.
Structure the report using the following headings:
## Overall Assessment
Provide a concise summary of what the student's results suggest overall.
Synthesise all completed SphereBinder tools into one coherent interpretation.
Avoid discussing each tool separately.
Explain how the student's personality, academic interests, university preferences, financial considerations and long-term aspirations reinforce each other or where they reveal meaningful trade-offs or unanswered questions.
## Career Direction
Explain what the student's SCIA profile means in practical terms.
Describe:
- the types of work environments where the student is likely to thrive,
- the kinds of responsibilities they may naturally enjoy,
- the strengths this profile typically brings,
- the potential challenges they should be aware of,
- and how these characteristics relate to their recommended degree and career direction.
Avoid generic personality descriptions. Make the explanation specific to the student's overall results.
## Degree Alignment
Explain why the recommended degree is a good match (or not) for the student's overall profile.
Consider the student's:
- SCIA personality profile
- stated career aspirations
- academic interests
- preferred style of work
- university preferences (if available)
If there are any inconsistencies or trade-offs, explain them clearly and objectively.
If important information is missing, state what additional information would improve the recommendation rather than making assumptions.
## University & Investment
Discuss the recommended university in the context of the student's overall profile.
Consider:
- academic fit
- career alignment
- estimated investment
- available scholarship opportunities (if any)
Explain any trade-offs between quality, fit and affordability.
If the lowest-cost option is not the best-fit option, explain why this may be worth considering.
Do not recommend a university solely because it is cheaper or more expensive.
Do not provide financial, investment or borrowing advice.
If no university comparison has been completed, explain what information is still needed before meaningful recommendations can be made.
## Scholarships
Explain how scholarships fit into the student's overall education plan.
If scholarships have been identified:
- explain how they could reduce the overall cost of study,
- encourage the student to review eligibility requirements and application deadlines,
- explain that scholarship decisions are competitive and based on individual criteria.
If no scholarships have been identified:
- explain why completing scholarship research should be a priority,
- encourage the student to explore merit-based, need-based and institution-specific opportunities.
Do not estimate the likelihood of receiving a scholarship.
Do not imply that applying will guarantee funding.
## Recommended Next Steps
Provide exactly five prioritised recommendations.
For each recommendation:
- explain what the student should do,
- explain why it is important,
- explain how it connects to their SphereBinder results,
- keep the recommendation practical and achievable.
Where appropriate, recommend actions such as:
- comparing university course modules,
- reviewing entry requirements,
- speaking with university admissions teams,
- researching graduate outcomes,
- preparing scholarship applications,
- gaining relevant volunteering or work experience,
- developing skills that support the student's preferred career path.
Avoid vague advice such as "do more research" or "think carefully".
The recommendations should form a logical action plan, with the highest-priority action listed first.
Write in second person ("you"), using clear, professional British English.
Report quality expectations:
- Write naturally as if speaking directly to one student.
- Do not repeat the same information in different sections.
- Explain your reasoning instead of simply listing results.
- Where there are multiple completed tools, integrate them into one coherent story.
- Where information is missing, acknowledge the limitation rather than guessing.
- Use an encouraging but realistic tone.
- Finish with a short concluding paragraph (2–3 sentences) that summarises the student's overall position and reinforces their highest-priority next action.
Hard constraints (do not violate these):
- Only use information supplied in the student's SphereBinder results.
- Never invent universities, degrees, scholarships, careers, statistics or rankings.
- If important information is missing, acknowledge that rather than guessing.
- Explain relationships between the student's results instead of simply repeating them.
- Where appropriate, discuss both strengths and possible challenges.
- Highlight realistic trade-offs (for example, cost versus fit, or interests versus career goals).
- Keep all advice educational and career-focused.
- Do NOT recommend a specific paid SphereBinder package or use sales language.
- Do NOT give immigration, visa, residency or legal advice.
- Do NOT give financial, investment, banking or loan advice.
- Do NOT guarantee admission, scholarships, employment or future salary.
- Avoid political, religious and culturally sensitive content.
- End with practical next steps that the student can realistically take.`;

  const userPrompt = `The following information comes directly from the student's completed SphereBinder tools.
Carefully analyse the results as a whole.
Do not simply repeat the information provided.
Instead:
- identify patterns across the student's results
- explain why different results support or challenge each other
- identify any gaps or unanswered questions
- discuss realistic opportunities and trade-offs
- provide practical advice based only on the available information
The student has completed ${completedTools} SphereBinder tool(s).
Base the depth and confidence of your advice on the amount of information available.
If only one or two tools have been completed:
- Explain what meaningful conclusions can already be drawn.
- Clearly state which important information is still unavailable.
- Recommend the single most valuable SphereBinder tool to complete next and explain why.
If three or more tools have been completed:
- Focus on connecting the student's completed results into one coherent picture.
- Explain where the results reinforce or challenge each other.
- Highlight realistic trade-offs and opportunities.
Student results:
${parts.join('\n')}`;

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.65,
            topP: 0.9,
            topK: 40
          }
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
