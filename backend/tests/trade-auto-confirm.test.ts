import { extractTradeOfferStatus, isIncomingOnlyTradeStatus } from '../src/services/steamService';

describe('incoming-only trade auto-confirm guard', () => {
  it('accepts a Steam offer page with incoming assets and no outgoing assets', () => {
    const status = extractTradeOfferStatus(`
      <script>
        var g_rgCurrentTradeStatus = {"me":{"assets":[]},"them":{"assets":[{"assetid":"1"}]}};
      </script>
    `);

    expect(isIncomingOnlyTradeStatus(status)).toBe(true);
  });

  it.each([
    '{"me":{"assets":[{"assetid":"1"}]},"them":{"assets":[{"assetid":"2"}]}}',
    '{"me":{"assets":[]},"them":{"assets":[]}}'
  ])('rejects offers that are not strictly incoming-only', (payload) => {
    const status = extractTradeOfferStatus(`<script>g_rgCurrentTradeStatus = ${payload};</script>`);
    expect(isIncomingOnlyTradeStatus(status)).toBe(false);
  });

  it('rejects malformed or missing page payloads', () => {
    expect(extractTradeOfferStatus('<html></html>')).toBeNull();
    expect(extractTradeOfferStatus('<script>g_rgCurrentTradeStatus = {bad};</script>')).toBeNull();
    expect(isIncomingOnlyTradeStatus(null)).toBe(false);
  });
});
