import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getInstallationToken } from "@/lib/github/installationToken";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event");

  // --- Signature verification ---
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  if (
    !signature ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // --- Only handle issue comments ---
  if (event !== "issue_comment" || payload.action !== "created") {
    return NextResponse.json({ ignored: true });
  }

  // --- Require explicit invocation ---
  const commentBody: string = payload.comment.body;
  if (!commentBody.includes("@codecloze review")) {
    return NextResponse.json({ ignored: true });
  }

  // --- Must be a PR ---
  if (!payload.issue.pull_request) {
    return NextResponse.json({ ignored: true });
  }

  // --- GitHub context ---
  const installationId = payload.installation.id;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;

  // --- Auth as the app ---
  const token = await getInstallationToken(installationId);

  // --- Post test comment ---
  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "CodeCloze",
      },
      body: JSON.stringify({
        body: "👋 CodeCloze is connected and ready. Review logic coming next.",
      }),
    }
  );

  return NextResponse.json({ posted: true });
}
