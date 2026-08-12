describe('verifyTurnstileToken', () => {
  async function loadService(options: { enabled: boolean; secret?: string; axiosResult?: unknown; axiosReject?: boolean }) {
    jest.resetModules();
    const post = jest.fn();
    if (options.axiosReject) {
      post.mockRejectedValueOnce(new Error('network'));
    } else if (options.axiosResult !== undefined) {
      post.mockResolvedValueOnce({ data: options.axiosResult });
    }

    jest.doMock('../src/config/env', () => ({
      env: {
        TURNSTILE_ENABLED: options.enabled,
        TURNSTILE_SECRET_KEY: options.secret ?? ''
      }
    }));
    jest.doMock('axios', () => ({ post }));

    const service = await import('../src/services/turnstileService');
    return { verifyTurnstileToken: service.verifyTurnstileToken, post };
  }

  afterEach(() => {
    jest.dontMock('../src/config/env');
    jest.dontMock('axios');
  });

  it('allows registration when Turnstile is disabled', async () => {
    const { verifyTurnstileToken, post } = await loadService({ enabled: false });

    await expect(verifyTurnstileToken(undefined, '127.0.0.1')).resolves.toEqual({ ok: true });
    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed when enabled without server secret', async () => {
    const { verifyTurnstileToken, post } = await loadService({ enabled: true, secret: '' });

    await expect(verifyTurnstileToken('token')).resolves.toEqual({
      ok: false,
      message: 'Turnstile is enabled but not configured on the server.'
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a browser token when enabled', async () => {
    const { verifyTurnstileToken, post } = await loadService({ enabled: true, secret: 'secret' });

    await expect(verifyTurnstileToken(undefined)).resolves.toEqual({
      ok: false,
      message: 'Complete the anti-bot check and try again.'
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('accepts successful Cloudflare verification and sends remote IP', async () => {
    const { verifyTurnstileToken, post } = await loadService({
      enabled: true,
      secret: 'secret',
      axiosResult: { success: true }
    });

    await expect(verifyTurnstileToken('browser-token', '203.0.113.10')).resolves.toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.any(URLSearchParams),
      expect.objectContaining({ timeout: 5000 })
    );
    const body = post.mock.calls[0][1] as URLSearchParams;
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe('browser-token');
    expect(body.get('remoteip')).toBe('203.0.113.10');
  });

  it('rejects failed Cloudflare verification and temporary network errors', async () => {
    const failed = await loadService({ enabled: true, secret: 'secret', axiosResult: { success: false } });
    await expect(failed.verifyTurnstileToken('bad-token')).resolves.toEqual({
      ok: false,
      message: 'Anti-bot verification failed. Please try again.'
    });

    const unavailable = await loadService({ enabled: true, secret: 'secret', axiosReject: true });
    await expect(unavailable.verifyTurnstileToken('token')).resolves.toEqual({
      ok: false,
      message: 'Anti-bot verification is temporarily unavailable. Please try again.'
    });
  });
});
