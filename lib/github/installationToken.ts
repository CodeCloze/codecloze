import { createAppJwt } from "./appAuth";

export async function getInstallationToken(
  installationId: number
): Promise<string> {
  let jwt: string;
  try {
    jwt = createAppJwt();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create JWT: ${errorMessage}`);
  }

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "CodeCloze",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub API error response", {
      status: res.status,
      statusText: res.statusText,
      body: text,
      installationId,
    });
    throw new Error(
      `Failed to get installation token: ${res.status} ${text}`
    );
  }

  const data = await res.json();
  return data.token;
}
