import { callResponsesAPI } from "./client";

/**
 * Stage 2: Main Review Model
 * 
 * Identifies concrete bug risks and explains failure modes.
 * Uses a mid-tier code reasoning model.
 */

const REVIEW_PROMPT = `You are a senior engineer reviewing a pull request diff.

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
}

Diff:
---
{DIFF}
---`;

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
  // Get deployment name from environment (e.g., "gpt-5.1-codex-mini" or equivalent)
  const deploymentName = process.env.AZURE_OPENAI_REVIEW_DEPLOYMENT;
  if (!deploymentName) {
    throw new Error("AZURE_OPENAI_REVIEW_DEPLOYMENT not set");
  }

  // Replace {DIFF} placeholder in prompt
  const prompt = REVIEW_PROMPT.replace("{DIFF}", diffText);

  try {
    // Call Responses API with token limit for review
    // Note: Reasoning models use reasoning tokens that count against max_completion_tokens
    // We need higher limits to account for reasoning + completion tokens
    // Using 2000 tokens to ensure we get completion text even with reasoning
    const response = await callResponsesAPI(deploymentName, prompt, 2000);

    // Parse JSON response
    let parsed: ReviewResponse;
    try {
      // Try to extract JSON from response
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
      // Return empty findings on parse failure
      return { findings: [] };
    }

    // Validate response structure
    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      console.error("Invalid review response structure", parsed);
      return { findings: [] };
    }

    // Validate and filter findings
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
    // Return empty findings on error
    return { findings: [] };
  }
}
