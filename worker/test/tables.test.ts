import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, ME, sessionFor, setup } from './harness.js';

async function asMe(): Promise<RequestInit> {
  return { headers: { Authorization: `Bearer ${await sessionFor(ME, 'sklepmistr')}`, Origin: APP_ORIGIN } };
}

const ITEM = 'name=Voda&category=water&quantity=6&packageSize=1.5';

describe('apps with several tables', () => {
  it('requires ?table= when the app has more than one table', async () => {
    const { send, backends } = setup();

    const response = await send(`/sklepmistr?action=fetch`, await asMe());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR', message: 'table is required' });
    expect(backends.gristCalls()).toHaveLength(0);
  });

  it('rejects a table the app does not define', async () => {
    const { send } = setup();

    const response = await send(`/sklepmistr?action=fetch&table=secrets`, await asMe());

    expect(await response.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR', message: 'Unknown table secrets' });
  });

  it('reads the Grist table that ?table= names', async () => {
    const { send, backends } = setup();

    await send(`/sklepmistr?action=fetch&table=household`, await asMe());

    expect(backends.gristCalls()[0]?.url.pathname).toMatch(/\/tables\/Household\/records$/);
  });

  it('maps API field names to their Grist columns', async () => {
    const { send, backends } = setup();

    const response = await send(`/sklepmistr?action=add&table=items&${ITEM}&dailyUse=2&expiry=2027-05-01`, await asMe());

    expect(await response.json()).toMatchObject({
      data: { name: 'Voda', quantity: 6, packageSize: 1.5, dailyUse: 2, expiry: '2027-05-01', location: '', note: '' }
    });
    expect(backends.rows.get(1)).toMatchObject({ package_size: 1.5, daily_use: 2, expiry: '2027-05-01' });
  });

  it('returns an empty string for an optional date that was left out', async () => {
    const { send } = setup();

    const response = await send(`/sklepmistr?action=add&table=items&${ITEM}`, await asMe());

    expect(await response.json()).toMatchObject({ data: { expiry: '', dailyUse: null } });
  });
});

describe('field rules', () => {
  it('rejects a value outside the allowed list', async () => {
    const { send, backends } = setup();

    const response = await send(`/sklepmistr?action=add&table=items&name=X&category=weapons&quantity=1`, await asMe());

    expect(await response.json()).toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'category must be one of water, food, hygiene, medicine, energy, other'
    });
    expect(backends.gristCalls()).toHaveLength(0);
  });

  it('rejects a number below the minimum', async () => {
    const { send } = setup();

    const response = await send(`/sklepmistr?action=add&table=items&name=X&category=food&quantity=-1`, await asMe());

    expect(await response.json()).toMatchObject({ message: 'quantity must be at least 0' });
  });

  it('accepts a decimal comma typed on a Czech keyboard', async () => {
    const { send, backends } = setup();

    await send(`/sklepmistr?action=add&table=items&name=Voda&category=water&quantity=2&packageSize=1,5`, await asMe());

    expect(backends.rows.get(1)).toMatchObject({ package_size: 1.5 });
  });
});
