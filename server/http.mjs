/**
 * Convert a Web `Response`'s headers into the shape `res.writeHead` wants.
 *
 * `Set-Cookie` is the one header a response may legitimately repeat, and the
 * `Headers` iterator yields each copy as its own entry. Collecting those into a
 * plain object keeps only the last one, which silently dropped the session
 * cookie from the Google callback — it sets the session and clears the OAuth
 * state in the same response, so the person was signed in and immediately
 * bounced back to the sign-in page. Node accepts an array for a repeated
 * header, so pass every cookie through.
 *
 * @param {Response} response
 * @returns {Record<string, string | string[]>}
 */
export function toNodeHeaders(response) {
  /** @type {Record<string, string | string[]>} */
  const headers = {};
  for (const [key, value] of response.headers)
    if (key.toLowerCase() !== 'set-cookie') headers[key] = value;
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers['set-cookie'] = cookies;
  return headers;
}
