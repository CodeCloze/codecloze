import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getInstallationToken } from "@/lib/github/installationToken";
import { postComment } from "@/lib/github/postComment";
import { runGatingModel } from "@/lib/llm/stage1Gating";
import { runReviewModel } from "@/lib/llm/stage2Review";

/**
 * GitHub Webhook Handler
 * 
 * This endpoint receives webhook events from GitHub and processes issue comment events
 * that explicitly invoke CodeCloze with "@codecloze review" in a PR comment.
 * 
 * Flow:
 * 1. Verify webhook signature to ensure request is from GitHub
 * 2. Parse and validate the payload
 * 3. Filter for issue_comment.created events on PRs with explicit invocation
 * 4. Authenticate as GitHub App and get installation token
 * 5. Fetch the PR diff
 * 6. Run Stage 1 gating model to determine if review is needed
 * 7. If review needed, run Stage 2 main review model
 * 8. Post exactly one comment to the PR
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Read the raw request body - we need this for signature verification
    // and parsing the webhook payload
    const rawBody = await request.text();
    
    // Extract GitHub webhook headers
    // x-hub-signature-256: HMAC SHA256 signature of the payload
    // x-github-event: The type of GitHub event (e.g., "issue_comment")
    const signature = request.headers.get("x-hub-signature-256");
    const event = request.headers.get("x-github-event");

    // --- Signature verification ---
    // Verify that the request is actually from GitHub by checking the HMAC signature
    // This prevents unauthorized requests from triggering the webhook
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error("GITHUB_WEBHOOK_SECRET is not set");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // Compute the expected signature using the same secret GitHub uses
    // GitHub signs the payload with HMAC SHA256 and sends it as "sha256=<hash>"
    const expectedSignature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    // Use timing-safe comparison to prevent timing attacks
    // This compares the signatures in constant time regardless of where they differ
    if (
      !signature ||
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      console.error("Invalid signature", {
        hasSignature: !!signature,
        signatureLength: signature?.length,
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // --- Parse JSON payload ---
    // Parse the webhook payload JSON. GitHub sends structured data about the event.
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error("Failed to parse JSON payload", err);
      return NextResponse.json(
        { error: "Invalid JSON payload", details: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    // --- Event filtering ---
    // Only process issue_comment events where a new comment was created
    // Ignore other events (edits, deletions, other event types) silently
    if (event !== "issue_comment" || payload.action !== "created") {
      return NextResponse.json({ ignored: true });
    }

    // --- Explicit invocation check ---
    // Require users to explicitly invoke CodeCloze with "@codecloze review"
    // This prevents the bot from responding to every comment
    // Use optional chaining to safely access nested properties
    const invocationComment: string = payload.comment?.body || "";
    if (!invocationComment.includes("@codecloze review")) {
      return NextResponse.json({ ignored: true });
    }

    // --- PR validation ---
    // Only process comments on pull requests, not regular issues
    // The pull_request field indicates this is a PR comment
    if (!payload.issue?.pull_request) {
      return NextResponse.json({ ignored: true });
    }

    // --- Step 1: Log invocation detection ---
    // Log that we've detected a valid invocation to help with debugging
    console.log("Invocation detected", {
      event,
      action: payload.action,
      comment: invocationComment,
      isPR: Boolean(payload.issue?.pull_request),
    });

    // --- Extract GitHub context ---
    // Extract the necessary identifiers from the webhook payload:
    // - installation.id: The GitHub App installation ID (needed for authentication)
    // - repository.owner.login: The repository owner (user or org)
    // - repository.name: The repository name
    // - issue.number: The PR/issue number (same for PRs)
    const installationId = payload.installation?.id;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const issueNumber = payload.issue?.number;

    // Validate that all required fields are present
    // If any are missing, the payload structure is unexpected and we can't proceed
    if (!installationId || !owner || !repo || !issueNumber) {
      console.error("Missing required payload fields", {
        installationId,
        owner,
        repo,
        issueNumber,
        hasInstallation: !!payload.installation,
        hasRepository: !!payload.repository,
        hasRepositoryOwner: !!payload.repository?.owner,
        hasIssue: !!payload.issue,
      });
      return NextResponse.json(
        { error: "Invalid payload: missing required fields" },
        { status: 400 }
      );
    }

    // --- Step 2: Log GitHub context ---
    // Log the extracted context for debugging and monitoring
    console.log("GitHub context", {
      installationId,
      owner,
      repo,
      issueNumber,
    });

    // --- Step 3: Authenticate as GitHub App ---
    // Get an installation access token for this specific installation
    // This token allows us to make API calls on behalf of the app installation
    // The token is scoped to the permissions granted during app installation
    let token: string;
    try {
      token = await getInstallationToken(installationId);
      console.log("Installation token acquired");
    } catch (err) {
      // If authentication fails, log detailed error information
      // This helps diagnose issues with app credentials or installation access
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      console.error("Failed to get installation token", {
        error: errorMessage,
        stack: errorStack,
        installationId,
        hasAppId: !!process.env.GITHUB_APP_ID,
        hasPrivateKey: !!process.env.GITHUB_PRIVATE_KEY_BASE64,
      });
      return NextResponse.json(
        { error: "auth failed", details: errorMessage },
        { status: 500 }
      );
    }

    // Log additional context about the installation
    console.log({
      installationAccount: payload.installation?.account?.login,
      repoOwner: owner,
    });
    
    // --- Step 4: Fetch PR diff ---
    // Fetch the raw unified diff for the pull request
    // Using the diff format is simpler and more reliable than parsing individual files
    // The Accept header requests the diff format directly from GitHub
    const diffRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`, // Use the installation token for authentication
          Accept: "application/vnd.github.v3.diff", // Request unified diff format (plain text)
          "User-Agent": "CodeCloze", // Identify our app in API requests
        },
      }
    );

    // Check if the diff fetch was successful
    if (!diffRes.ok) {
      const text = await diffRes.text();
      console.error("Failed to fetch diff", diffRes.status, text);
      return NextResponse.json(
        { error: "diff fetch failed", status: diffRes.status, details: text },
        { status: 500 }
      );
    }

    // Read the diff as plain text (not JSON)
    // This is the entire PR diff in unified diff format
    const diffText = await diffRes.text();

    // --- Step 5: Calculate basic diff statistics ---
    // These metrics are intentionally simple and sufficient for gating logic later
    // We use regex matching on the diff format:
    // - "diff --git" marks the start of each file's diff
    // - "@@" marks the start of each hunk within a file
    const diffBytes = Buffer.byteLength(diffText, "utf8");
    const fileCount = (diffText.match(/^diff --git /gm) || []).length;
    const hunkCount = (diffText.match(/^@@/gm) || []).length;

    // Log the statistics for monitoring and debugging
    console.log("PR diff stats", {
      diffBytes,
      fileCount,
      hunkCount,
    });

    // Log a preview of the first 20 lines of the diff
    // This helps confirm the format is correct (temporary, can be removed later)
    console.log(
      "Diff preview:",
      diffText.split("\n").slice(0, 20).join("\n")
    );

    // --- Step 6: Stage 1 - Gating Model ---
    // Determine if deeper review is warranted
    // This uses the cheapest model to quickly filter out low-risk changes
    let needsReview: boolean;
    try {
      needsReview = await runGatingModel(diffText);
      console.log("Gating model result", { needsReview });
    } catch (err) {
      console.error("Gating model failed", err);
      // Fail open - assume review is needed
      needsReview = true;
    }

    // --- Step 7: Post comment based on gating result ---
    let commentBody: string;
    let reviewResponse: { findings: Array<{ summary: string; lines: string; failure_mode: string; confidence: number }> } | null = null;

    if (!needsReview) {
      // Stage 1 says no review needed - post reassurance comment
      commentBody = `✅ No major issues detected

I reviewed this diff for realistic runtime, logic, and state-related risks.
Nothing stood out as likely to cause production issues.

This change appears low risk to merge.`;
    } else {
      // Stage 1 says review needed - run Stage 2 main review model
      try {
        reviewResponse = await runReviewModel(diffText);
        console.log("Review model result", {
          findingsCount: reviewResponse.findings.length,
        });
      } catch (err) {
        console.error("Review model failed", err);
        // On error, return empty findings (will post reassurance)
        reviewResponse = { findings: [] };
      }

      // Format comment based on findings
      if (reviewResponse.findings.length === 0) {
        // No findings - post reassurance comment (same as Stage 1)
        commentBody = `✅ No major issues detected

I reviewed this diff for realistic runtime, logic, and state-related risks.
Nothing stood out as likely to cause production issues.

This change appears low risk to merge.`;
      } else {
        // Sort findings by confidence (descending) and take top 3
        const sortedFindings = [...reviewResponse.findings]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 3);

        // Format findings as bullet points
        const findingsText = sortedFindings
          .map(
            (finding) => `**${finding.summary}**

Why this could break:
${finding.failure_mode}

Relevant diff:
\`\`\`
${finding.lines}
\`\`\``
          )
          .join("\n\n---\n\n");

        commentBody = `⚠️ Possible bug risk

${findingsText}`;
      }
    }

    // --- Step 8: Post exactly one comment ---
    // Post the comment to the PR
    // This is the only comment posted per invocation
    try {
      await postComment(token, owner, repo, issueNumber, commentBody);
      console.log("Comment posted successfully");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to post comment", err);
      return NextResponse.json(
        { error: "comment failed", details: errorMessage },
        { status: 500 }
      );
    }

    // Success - return response
    return NextResponse.json({
      success: true,
      needsReview,
      findingsCount: needsReview && reviewResponse ? reviewResponse.findings.length : 0,
    });
  } catch (err) {
    // --- Global error handler ---
    // Catch any unhandled errors that weren't caught by specific try-catch blocks
    // This ensures we always return a proper HTTP response, even for unexpected errors
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error("Unhandled error in webhook handler", {
      error: errorMessage,
      stack: errorStack,
    });
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
