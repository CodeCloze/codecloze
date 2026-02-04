/**
 * Post a comment to a GitHub PR/issue
 * 
 * @param token - GitHub installation token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - PR/issue number
 * @param commentBody - Comment text to post
 * @returns Promise that resolves when comment is posted
 */
export async function postComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  commentBody: string
): Promise<void> {
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
        body: commentBody,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to post comment: ${res.status} ${text}`
    );
  }
}
