import { callResponsesAPI, TextFormatJsonSchema } from "./client";

/**
 * Stage 2: Main Review Model
 * 
 * Identifies concrete bug risks and explains failure modes.
 * Uses a mid-tier code reasoning model.
 */

const REVIEW_SYSTEM_MESSAGE = `You are a senior engineer reviewing a pull request diff.

Identify realistic bug risks only.
Each finding must:
- Reference specific lines or hunks from the diff
- Explain how the issue could manifest at runtime
- Be grounded in the actual change, not speculation

Do NOT comment on:
- style
- formatting
- refactors
- naming
- best practices unless tied directly to a concrete failure

Use the structured schema enforced by the Responses API to reply. Do not add extra text beyond the schema.

If no meaningful bug risk exists, return:
{"findings": []}

Otherwise, return JSON matching this schema:
{
  "findings": [
    {
      "summary": "short description",
      "lines": "diff context or hunk",
      "failure_mode": "how this could break at runtime",
      "confidence": 0.0-1.0
    }
  ]
}`;

const REVIEW_RESPONSE_FORMAT: TextFormatJsonSchema = {
  type: "json_schema",
  name: "review_findings",
  strict: true,
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        description: "List of plausible bug risks grounded in the diff",
        items: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Short description of the issue",
            },
            lines: {
              type: "string",
              description: "Diff context or hunk associated with the risk",
            },
            failure_mode: {
              type: "string",
              description: "How the issue could fail at runtime",
            },
            confidence: {
              type: "number",
              description: "Confidence between 0 and 1",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["summary", "lines", "failure_mode", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  },
};

export interface Finding {
  summary: string;
  lines: string;
  failure_mode: string;
  confidence: number;
}

export interface ReviewResponse {
  findings: Finding[];
}

/**
 * Run Stage 2 main review model
 * 
 * @param diffText - The PR diff text
 * @returns Review response with findings
 */
export async function runReviewModel(diffText: string): Promise<ReviewResponse> {
  const deploymentName = process.env.AZURE_OPENAI_REVIEW_DEPLOYMENT;
  if (!deploymentName) {
    throw new Error("AZURE_OPENAI_REVIEW_DEPLOYMENT not set");
  }

  const messages = [
    { role: "system", content: REVIEW_SYSTEM_MESSAGE },
    {
      role: "user",
      content: `Diff:\n---\n${diffText}\n---`,
    },
  ];

  try {
    const response = await callResponsesAPI(deploymentName, messages, 4000, REVIEW_RESPONSE_FORMAT);

    let parsed: ReviewResponse;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("Failed to parse review response", {
        response,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return { findings: [] };
    }

    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      console.error("Invalid review response structure", parsed);
      return { findings: [] };
    }

    const validFindings: Finding[] = [];
    for (const finding of parsed.findings) {
      if (
        typeof finding.summary === "string" &&
        typeof finding.lines === "string" &&
        typeof finding.failure_mode === "string" &&
        typeof finding.confidence === "number" &&
        finding.confidence >= 0 &&
        finding.confidence <= 1
      ) {
        validFindings.push({
          summary: finding.summary,
          lines: finding.lines,
          failure_mode: finding.failure_mode,
          confidence: finding.confidence,
        });
      }
    }

    return { findings: validFindings };
  } catch (err) {
    console.error("Review model error", err);
    return { findings: [] };
  }
}
