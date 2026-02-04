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

  // --- Step 1: Log invocation detection ---
  console.log("Invocation detected", {
    event,
    action: payload.action,
    comment: payload.comment.body,
    isPR: Boolean(payload.issue.pull_request),
  });

  // --- GitHub context ---
  const installationId = payload.installation.id;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;

  // --- Step 2: Log GitHub context ---
  console.log("GitHub context", {
    installationId,
    owner,
    repo,
    issueNumber,
  });

  // --- Step 3: Auth as the app with error handling ---
  let token: string;
  try {
    token = await getInstallationToken(installationId);
    console.log("Installation token acquired");
  } catch (err) {
    console.error("Failed to get installation token", err);
    return NextResponse.json({ error: "auth failed" }, { status: 500 });
  }

  // --- Step 4: Post test comment with error handling ---
  const res = await fetch(
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

  const text = await res.text();

  console.log("GitHub comment response", {
    status: res.status,
    body: text,
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "comment failed", status: res.status, body: text },
      { status: 500 }
    );
  }

  return NextResponse.json({ posted: true });
}
