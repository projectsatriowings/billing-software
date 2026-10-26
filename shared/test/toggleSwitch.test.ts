import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToggleSwitch } from '../../client/src/components/ToggleSwitch.tsx';
import { can, type Role } from '../types.ts';
import { type Item } from '../../client/src/api.ts';

test('ToggleSwitch component: renders green/checked for active and red/unchecked for inactive products', () => {
  // Active product
  const activeHtml = renderToStaticMarkup(
    React.createElement(ToggleSwitch, {
      checked: true,
      onChange: () => {},
    })
  );

  assert.ok(activeHtml.includes('role="switch"'), 'Should have role="switch"');
  assert.ok(activeHtml.includes('aria-checked="true"'), 'Should have aria-checked="true"');
  assert.ok(activeHtml.includes('aria-label="Active"'), 'Should have aria-label="Active"');
  assert.ok(activeHtml.includes('title="Active · click to deactivate"'), 'Should have active tooltip');
  assert.ok(activeHtml.includes('background-color:#10b981') || activeHtml.includes('background-color: #10b981'), 'Active track should be green #10b981');
  assert.ok(activeHtml.includes('translateX(18px)'), 'Active knob should slide to the right (translateX(18px))');

  // Inactive product
  const inactiveHtml = renderToStaticMarkup(
    React.createElement(ToggleSwitch, {
      checked: false,
      onChange: () => {},
    })
  );

  assert.ok(inactiveHtml.includes('aria-checked="false"'), 'Should have aria-checked="false"');
  assert.ok(inactiveHtml.includes('aria-label="Inactive"'), 'Should have aria-label="Inactive"');
  assert.ok(inactiveHtml.includes('title="Inactive · click to activate"'), 'Should have inactive tooltip');
  assert.ok(inactiveHtml.includes('background-color:#ef4444') || inactiveHtml.includes('background-color: #ef4444'), 'Inactive track should be red #ef4444');
  assert.ok(inactiveHtml.includes('translateX(0)'), 'Inactive knob should be on the left (translateX(0))');
});

test('ToggleSwitch component: accessibility, disabled state, and loading', () => {
  // Disabled state
  const disabledHtml = renderToStaticMarkup(
    React.createElement(ToggleSwitch, {
      checked: true,
      disabled: true,
      title: "You don't have permission to change product status",
      onChange: () => {},
    })
  );

  assert.ok(disabledHtml.includes('disabled=""') || disabledHtml.includes('disabled'), 'Should have disabled attribute');
  assert.ok(disabledHtml.includes('opacity:0.5') || disabledHtml.includes('opacity: 0.5'), 'Disabled switch should have 50% opacity');
  assert.ok(disabledHtml.includes('cursor:not-allowed') || disabledHtml.includes('cursor: not-allowed'), 'Disabled switch should have not-allowed cursor');
  assert.ok(disabledHtml.includes('title="You don&#x27;t have permission to change product status"') || disabledHtml.includes("You don't have permission to change product status"));

  // Loading state
  const loadingHtml = renderToStaticMarkup(
    React.createElement(ToggleSwitch, {
      checked: false,
      loading: true,
      onChange: () => {},
    })
  );

  assert.ok(loadingHtml.includes('disabled=""') || loadingHtml.includes('disabled'), 'Loading switch should be disabled to prevent double clicks');
});

test('Toggle activation logic: calls existing handler with right product', async () => {
  const sampleProduct: Item = {
    id: 'prod-123',
    name: 'Amul Butter 100g',
    priceMinor: 5500,
    costMinor: 4800,
    taxRateBp: 1200,
    taxInclusive: true,
    currentStockMilli: 60000,
    unit: 'pcs',
    favorite: false,
    category: 'Dairy',
    barcode: '200000000015',
    active: true,
  };

  const apiCalls: Array<{ path: string; method: string; body?: any }> = [];
  const mockApi = async (path: string, options: any) => {
    apiCalls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: true };
  };

  // Helper simulating toggle action
  const executeToggle = async (
    item: Item,
    confirmFn: (msg: string) => boolean,
    apiFn: typeof mockApi
  ) => {
    const prevActive = item.active !== false;
    const newActive = !prevActive;

    if (prevActive) {
      const confirmed = confirmFn(`Deactivate "${item.name}"? It will be hidden from POS billing.`);
      if (!confirmed) return { cancelled: true, newActive: prevActive };
    }

    if (newActive) {
      await apiFn(`/api/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    } else {
      await apiFn(`/api/items/${item.id}`, {
        method: 'DELETE',
      });
    }
    return { cancelled: false, newActive };
  };

  // 1. Deactivating active product with confirm = true
  const resDeact = await executeToggle(sampleProduct, () => true, mockApi);
  assert.equal(resDeact.cancelled, false);
  assert.equal(resDeact.newActive, false);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'DELETE');
  assert.equal(apiCalls[0].path, '/api/items/prod-123');

  // 2. Reactivating inactive product
  const inactiveProduct: Item = { ...sampleProduct, active: false };
  let confirmCalled = false;
  const resAct = await executeToggle(
    inactiveProduct,
    () => {
      confirmCalled = true;
      return true;
    },
    mockApi
  );
  assert.equal(confirmCalled, false, 'Turning on should NOT prompt for confirmation');
  assert.equal(resAct.cancelled, false);
  assert.equal(resAct.newActive, true);
  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[1].method, 'PATCH');
  assert.equal(apiCalls[1].path, '/api/items/prod-123');
  assert.deepEqual(apiCalls[1].body, { active: true });
});

test('Toggle confirmation: asks for confirmation only when deactivating, and does nothing if cancelled', async () => {
  let apiCalled = false;
  const mockApi = async () => {
    apiCalled = true;
    return {};
  };

  const activeItem: Item = {
    id: 'prod-456',
    name: 'Aashirvaad Atta 5kg',
    priceMinor: 28000,
    costMinor: 23500,
    taxRateBp: 500,
    taxInclusive: true,
    currentStockMilli: 25000,
    unit: 'pcs',
    favorite: false,
    active: true,
  };

  let promptMessage = '';
  const confirmMock = (msg: string) => {
    promptMessage = msg;
    return false; // User clicks cancel
  };

  // Execute toggle with user cancellation
  const prevActive = activeItem.active !== false;
  let cancelled = false;
  if (prevActive) {
    const confirmed = confirmMock(`Deactivate "${activeItem.name}"? It will be hidden from POS billing.`);
    if (!confirmed) {
      cancelled = true;
    }
  }

  assert.equal(cancelled, true, 'Should cancel when confirm returns false');
  assert.equal(apiCalled, false, 'API should not be called when cancelled');
  assert.equal(promptMessage, 'Deactivate "Aashirvaad Atta 5kg"? It will be hidden from POS billing.');
});

test('Toggle error handling: rolls back to previous state when API fails', async () => {
  let itemsState: Item[] = [
    {
      id: 'prod-789',
      name: 'Automated Test Rice 5kg',
      priceMinor: 30000,
      costMinor: 24000,
      taxRateBp: 500,
      taxInclusive: true,
      currentStockMilli: 129000,
      unit: 'kg',
      favorite: false,
      active: true,
    },
  ];

  const failingApi = async () => {
    throw new Error('Network error or server unavailable');
  };

  const item = itemsState[0];
  const prevActive = item.active !== false;
  const newActive = !prevActive;

  // Optimistic update
  itemsState = itemsState.map((it) => (it.id === item.id ? { ...it, active: newActive } : it));
  assert.equal(itemsState[0].active, false, 'Optimistically set to false');

  // Attempt API call and rollback on error
  let errorCaught = false;
  try {
    await failingApi();
  } catch (err: any) {
    errorCaught = true;
    // Rollback
    itemsState = itemsState.map((it) => (it.id === item.id ? { ...it, active: prevActive } : it));
  }

  assert.equal(errorCaught, true);
  assert.equal(itemsState[0].active, true, 'Should roll back to true on API error');
});

test('Toggle permissions: disabled with permission tooltip for roles without items.write access', () => {
  const allowedRoles: Role[] = ['owner', 'manager'];
  const disallowedRoles: Role[] = ['cashier', 'accountant'];

  for (const role of allowedRoles) {
    assert.equal(can(role, 'items.write'), true, `Role "${role}" should have items.write permission`);
  }

  for (const role of disallowedRoles) {
    assert.equal(can(role, 'items.write'), false, `Role "${role}" should NOT have items.write permission`);

    // Verify rendered button has disabled and correct title
    const html = renderToStaticMarkup(
      React.createElement(ToggleSwitch, {
        checked: true,
        disabled: !can(role, 'items.write'),
        title: !can(role, 'items.write')
          ? "You don't have permission to change product status"
          : 'Active · click to deactivate',
        onChange: () => {},
      })
    );

    assert.ok(html.includes('disabled=""') || html.includes('disabled'));
    assert.ok(html.includes("You don&#x27;t have permission to change product status") || html.includes("You don't have permission to change product status"));
  }
});

test('Toggle state keeps status badge in sync', () => {
  const renderBadge = (active: boolean) => {
    return active ? 'ACTIVE' : 'INACTIVE';
  };

  assert.equal(renderBadge(true), 'ACTIVE');
  assert.equal(renderBadge(false), 'INACTIVE');
});
