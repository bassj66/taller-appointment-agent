'use strict';

/**
 * Tiny Anthropic Messages API client using the built-in fetch (Node 18+).
 * Exposes the same `messages.create()` shape as the official SDK, so you can
 * swap it for `new (require('@anthropic-ai/sdk'))()` without touching the agent.
 */
class AnthropicClient {
  constructor({ apiKey, baseUrl = 'https://api.anthropic.com', timeoutMs = 30000 }) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.messages = { create: (body) => this._post('/v1/messages', body) };
  }

  async _post(pathname, body) {
    const res = await fetch(this.baseUrl + pathname, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      throw new Error(`Anthropic API ${res.status}: ${msg}`);
    }
    return data;
  }
}

module.exports = { AnthropicClient };
