import jwt from "jsonwebtoken";

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyBase64 = process.env.GITHUB_PRIVATE_KEY_BASE64;

  if (!appId || !privateKeyBase64) {
    throw new Error("GitHub App credentials are not set");
  }

  // Decode Base64 → PEM
  const privateKey = Buffer.from(
    privateKeyBase64,
    "base64"
  ).toString("utf8");

  // Log the beginning of the decoded private key for debugging
  console.log("Decoded private key start:", privateKey.substring(0, 50));

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,        // issued 1 min ago (clock skew safety)
      exp: now + 9 * 60,    // max 10 min
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" }
  );
}
