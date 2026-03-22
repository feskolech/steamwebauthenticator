import { mapLogRow } from '../src/services/logViewService';

describe('mapLogRow', () => {
  it('maps registration toggle system events', () => {
    const item = mapLogRow({
      id: 1,
      user_id: 10,
      user_email: 'admin@example.com',
      account_id: null,
      alias: null,
      type: 'system',
      details: JSON.stringify({ event: 'registration_toggle', enabled: false }),
      created_at: new Date('2026-03-22T10:00:00Z')
    });

    expect(item).toMatchObject({
      category: 'security',
      eventKey: 'security.registration.toggled',
      context: { enabled: false },
      userEmail: 'admin@example.com'
    });
  });

  it('maps admin user deletion events', () => {
    const item = mapLogRow({
      id: 2,
      user_id: 10,
      user_email: 'admin@example.com',
      account_id: null,
      alias: null,
      type: 'system',
      details: JSON.stringify({
        event: 'admin_user_deleted',
        targetUserId: 42,
        targetEmail: 'user@example.com'
      }),
      created_at: new Date('2026-03-22T10:00:00Z')
    });

    expect(item).toMatchObject({
      category: 'security',
      eventKey: 'security.admin.userDeleted',
      context: { targetUserId: 42, targetEmail: 'user@example.com' },
      userEmail: 'admin@example.com'
    });
  });
});
