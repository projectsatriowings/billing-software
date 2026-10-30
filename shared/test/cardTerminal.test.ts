import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalEngine } from '../../server/src/services/terminal/terminalEngine.ts';
import { StandaloneTerminalAdapter } from '../../server/src/services/terminal/adapters/standaloneAdapter.ts';
import { MockTerminalAdapter } from '../../server/src/services/terminal/adapters/mockTerminalAdapter.ts';
import { PaytmPosAdapter } from '../../server/src/services/terminal/adapters/paytmPosAdapter.ts';
import { PineLabsAdapter } from '../../server/src/services/terminal/adapters/pineLabsAdapter.ts';
import { HdfcPosAdapter } from '../../server/src/services/terminal/adapters/hdfcPosAdapter.ts';
import { IciciPosAdapter } from '../../server/src/services/terminal/adapters/iciciPosAdapter.ts';
import { VerifoneAdapter } from '../../server/src/services/terminal/adapters/verifoneAdapter.ts';
import {
  TERMINAL_PROVIDERS,
  TERMINAL_CONNECTION_MODES,
  type CardTerminal,
  type TerminalTransaction,
} from '../types.ts';

describe('Universal Payment Engine & Card Terminal Integration', () => {
  it('supports all required providers and connection modes', () => {
    assert.deepEqual(
      [...TERMINAL_PROVIDERS],
      ['paytm', 'pinelabs', 'hdfc', 'icici', 'verifone', 'standalone', 'mock'],
    );
    assert.deepEqual([...TERMINAL_CONNECTION_MODES], ['integrated', 'standalone']);
  });

  it('TerminalEngine initializes and registers all 7 provider adapters', () => {
    const engine = new TerminalEngine();
    for (const p of TERMINAL_PROVIDERS) {
      const adapter = engine.getAdapter(p);
      assert.ok(adapter, `Adapter for provider ${p} must exist`);
      assert.equal(adapter.provider, p);
    }
  });

  it('Standalone Terminal Adapter creates pending transaction and provides cashier instructions', async () => {
    const adapter = new StandaloneTerminalAdapter();
    const mockTerminalRecord: any = {
      id: 'term_std_1',
      tenant_id: 't_demo',
      branch_id: 'b_main',
      name: 'Counter 1 Standalone EDC',
      provider: 'standalone',
      connection_mode: 'standalone',
      active: true,
      status: 'online',
    };

    const res = await adapter.initiatePayment({
      terminal: mockTerminalRecord,
      amountMinor: 250000, // ₹2,500.00
      cashierId: 'u_cashier',
      decryptedSecrets: {},
    });

    assert.equal(res.status, 'pending');
    assert.ok(res.instructions?.includes('₹2500.00'));
    assert.ok(res.instructions?.includes('RRN'));
  });

  it('Mock Terminal Adapter simulates card tap and successful authorization', async () => {
    const mock = new MockTerminalAdapter();
    const mockTerminalRecord: any = {
      id: 'term_mock_1',
      tenant_id: 't_demo',
      branch_id: 'b_main',
      name: 'Sandbox EDC',
      provider: 'mock',
      connection_mode: 'integrated',
      active: true,
      status: 'online',
    };

    const initRes = await mock.initiatePayment({
      terminal: mockTerminalRecord,
      amountMinor: 150000, // ₹1,500.00
      cashierId: 'u_cashier',
      decryptedSecrets: {},
    });

    assert.equal(initRes.status, 'processing');
    assert.ok(initRes.providerTxId);

    const statusRes = await mock.getPaymentStatus({
      terminal: mockTerminalRecord,
      transaction: {
        id: 'ttx_1',
        tenant_id: 't_demo',
        branch_id: 'b_main',
        terminal_id: 'term_mock_1',
        invoice_id: null,
        counter: 'COUNTER-1',
        amount_minor: 150000,
        currency: 'INR',
        provider: 'mock',
        connection_mode: 'integrated',
        provider_tx_id: initRes.providerTxId,
        provider_ref_no: null,
        card_network: null,
        card_last4: null,
        auth_code: null,
        status: 'processing',
        error_reason: null,
        idempotency_key: null,
        cashier_id: 'u_cashier',
        cashier_name: 'Cashier',
        verified_at: null,
        verified_by: null,
        reconciled: false,
        reconciled_at: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any,
      decryptedSecrets: {},
    });

    assert.equal(statusRes.status, 'success');
    assert.ok(statusRes.providerRefNo, 'Must return bank RRN');
    assert.ok(statusRes.authCode, 'Must return approval code');
    assert.ok(statusRes.cardLast4, 'Must return masked card last 4 digits');
    assert.equal(statusRes.cardLast4?.length, 4, 'Never store more than last 4 digits');
  });

  it('Mock Terminal Adapter simulates bank card decline on trigger amount', async () => {
    const mock = new MockTerminalAdapter();
    const res = await mock.initiatePayment({
      terminal: { id: 'term_mock', provider: 'mock' } as any,
      amountMinor: 888800, // Trigger for Insufficient Funds
      cashierId: 'u_cashier',
      decryptedSecrets: {},
    });

    assert.equal(res.status, 'failed');
    assert.ok(res.errorReason?.includes('Card Declined'));
  });

  it('Mock Terminal Adapter simulates timeout/waiting PIN on trigger amount', async () => {
    const mock = new MockTerminalAdapter();
    const res = await mock.initiatePayment({
      terminal: { id: 'term_mock', provider: 'mock' } as any,
      amountMinor: 999900, // Trigger for Long Wait
      cashierId: 'u_cashier',
      decryptedSecrets: {},
    });

    assert.equal(res.status, 'pending');
    assert.ok(res.instructions?.includes('Customer presented card'));
  });

  it('PCI DSS Security: Adapters strictly mask card PAN and extract only last 4 digits', () => {
    const paytm = new PaytmPosAdapter();
    const pine = new PineLabsAdapter();
    const hdfc = new HdfcPosAdapter();
    const icici = new IciciPosAdapter();
    const vfi = new VerifoneAdapter();

    // Verify helper methods extract exactly last 4 digits from masked PAN strings
    assert.equal((paytm as any).extractLast4('411111XXXXXX1234'), '1234');
    assert.equal((pine as any).extractLast4('XXXX-XXXX-XXXX-9876'), '9876');
    assert.equal((hdfc as any).extractLast4('5424XXXXXXXX4321'), '4321');
    assert.equal((icici as any).extractLast4('6071XXXXXXXX5555'), '5555');
    assert.equal((vfi as any).extractLast4('3714XXXXXX1005'), '1005');
  });

  it('Adapters normalize card network names to standard types', () => {
    const paytm = new PaytmPosAdapter();
    assert.equal((paytm as any).normalizeCardNetwork('VISA_CREDIT'), 'VISA');
    assert.equal((paytm as any).normalizeCardNetwork('MasterCard Debit'), 'MASTERCARD');
    assert.equal((paytm as any).normalizeCardNetwork('RuPay Platinum'), 'RUPAY');
    assert.equal((paytm as any).normalizeCardNetwork('American Express'), 'AMEX');
    assert.equal((paytm as any).normalizeCardNetwork('UNKNOWN'), 'OTHER');
  });
});

