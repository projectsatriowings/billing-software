import React, { useState, useEffect, useMemo } from 'react';
import type { Shop, User, PublicPaymentSettings } from '../../api';
import { getPaymentSettings, updatePaymentSettings } from '../../api';
import { ToggleSwitch } from '../ToggleSwitch';
import { STATES } from '../../../../shared/states.ts';
import { qrSvg, upiUri } from '../../../../shared/qr.ts';
import { billMessage } from '../../../../shared/whatsapp.ts';
import { StrictIsolationBanner } from '../StrictIsolationBanner';
import {
  CreditCardIcon,
  QrCodeIcon,
  ZapIcon,
  WhatsAppIcon,
} from '../terminal/PaymentIcons.tsx';

export interface StoreSettingsViewProps {
  shop: Shop | null;
  user: User;
  onSaveShop: (fields: Partial<Shop>) => Promise<Shop | void>;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onNavigateTab?: (tab: string) => void;
}

type SettingsSection = 'profile' | 'billing' | 'inventory' | 'payments' | 'whatsapp' | 'security';

const BUSINESS_TYPE_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  retail: { label: 'Retail / Kirana / Supermarket', icon: '🛒', desc: 'Barcode scanning, standard inventory, fast POS checkout' },
  pharmacy: { label: 'Pharmacy & Healthcare', icon: '💊', desc: 'Batch tracking, expiry dates, HSN schedule validation' },
  restaurant: { label: 'Restaurant / Cafe / Bakery', icon: '🍽️', desc: 'Table tickets, kitchen orders, flexible stock handling' },
  wholesale: { label: 'Wholesale & Distribution', icon: '📦', desc: 'Bulk pricing, cartons/boxes, B2B tax invoices' },
  service: { label: 'Professional & Technical Services', icon: '💼', desc: 'Hourly/milestone billing, SAC codes, service contracts' },
  general: { label: 'General Business', icon: '🏢', desc: 'Standard retail & service invoicing' },
};

export function StoreSettingsView({
  shop,
  user,
  onSaveShop,
  showToast,
  onNavigateTab,
}: StoreSettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form Fields State
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('retail');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [upiId, setUpiId] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('INV');

  // WhatsApp
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [whatsappDefaultLang, setWhatsappDefaultLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [whatsappIncludeLink, setWhatsappIncludeLink] = useState(false);

  // Loyalty
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [loyaltyPointsPer100, setLoyaltyPointsPer100] = useState(10);
  const [loyaltyPointValueRupees, setLoyaltyPointValueRupees] = useState(0.10);
  const [loyaltyMinPointsRedeem, setLoyaltyMinPointsRedeem] = useState(10);

  // Receipt / Billing Preferences (Local UI preferences aligned with shared types)
  // Shop-specific Payment Settings & QR Configuration
  const [paymentSettingsLoaded, setPaymentSettingsLoaded] = useState(false);
  const [upiEnabled, setUpiEnabled] = useState(true);
  const [qrType, setQrType] = useState<'static' | 'dynamic'>('static');
  const [qrProvider, setQrProvider] = useState<'manual' | 'razorpay' | 'paytm' | 'phonepe'>('manual');
  const [staticUpiId, setStaticUpiId] = useState('');
  const [staticMerchantName, setStaticMerchantName] = useState('');
  const [rzpEnabled, setRzpEnabled] = useState(false);
  const [rzpMode, setRzpMode] = useState<'test' | 'live'>('test');
  const [rzpKeyId, setRzpKeyId] = useState('');
  const [rzpKeySecret, setRzpKeySecret] = useState('');
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState('');
  const [hasStoredKeySecret, setHasStoredKeySecret] = useState(false);
  const [hasStoredWebhookSecret, setHasStoredWebhookSecret] = useState(false);
  const [showKeySecret, setShowKeySecret] = useState(false);
  const [rzpQrExpiryMinutes, setRzpQrExpiryMinutes] = useState(10);
  const [integrationStatus, setIntegrationStatus] = useState<'not_configured' | 'connected' | 'error'>('not_configured');
  const [integrationStatusMsg, setIntegrationStatusMsg] = useState<string | null>(null);
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['cash', 'upi', 'card', 'credit']);
  const [paymentSubTab, setPaymentSubTab] = useState<'methods' | 'qr' | 'razorpay'>('methods');
  const [isSavingPayments, setIsSavingPayments] = useState(false);

  // Load shop payment settings
  const loadPaymentSettings = async () => {
    try {
      const cfg = await getPaymentSettings();
      setUpiEnabled(cfg.upiEnabled);
      setQrType(cfg.qrType);
      setQrProvider(cfg.provider);
      setStaticUpiId(cfg.staticUpiId || shop?.upiId || '');
      setStaticMerchantName(cfg.staticMerchantName || shop?.name || '');
      setRzpEnabled(cfg.rzpEnabled);
      setRzpMode(cfg.rzpMode);
      setRzpKeyId(cfg.rzpKeyId || '');
      setHasStoredKeySecret(cfg.hasKeySecret);
      setHasStoredWebhookSecret(cfg.hasWebhookSecret);
      setRzpQrExpiryMinutes(cfg.rzpQrExpiryMinutes || 10);
      setIntegrationStatus(cfg.status);
      setIntegrationStatusMsg(cfg.statusMessage);
      setEnabledMethods((cfg.enabledMethods || []).filter((m) => m !== 'bank'));
      setPaymentSettingsLoaded(true);
    } catch (e: any) {
      console.warn('Could not load payment settings', e);
    }
  };

  useEffect(() => {
    if (activeSection === 'payments' && !paymentSettingsLoaded) {
      loadPaymentSettings();
    }
  }, [activeSection, paymentSettingsLoaded]);

  const handleSavePaymentSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (user.role !== 'owner' && user.role !== 'manager') {
      showToast('Only Owner or authorized Manager can modify payment configuration.', 'error');
      return;
    }

    setIsSavingPayments(true);
    try {
      const updated = await updatePaymentSettings({
        upiEnabled,
        qrType,
        provider: qrProvider,
        staticUpiId: staticUpiId.trim() || null,
        staticMerchantName: staticMerchantName.trim() || null,
        rzpEnabled,
        rzpMode,
        rzpKeyId: rzpKeyId.trim() || null,
        rzpKeySecret: rzpKeySecret.trim() || undefined,
        rzpWebhookSecret: rzpWebhookSecret.trim() || undefined,
        rzpQrExpiryMinutes: Number(rzpQrExpiryMinutes) || 10,
        enabledMethods,
      });

      setIntegrationStatus(updated.status);
      setIntegrationStatusMsg(updated.statusMessage);
      setHasStoredKeySecret(updated.hasKeySecret);
      setHasStoredWebhookSecret(updated.hasWebhookSecret);
      setRzpKeySecret('');
      showToast('Payment & QR settings updated successfully!', 'success');
      if (staticUpiId && staticUpiId !== shop?.upiId) {
        onSaveShop({ upiId: staticUpiId });
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to update payment settings', 'error');
    } finally {
      setIsSavingPayments(false);
    }
  };

  const [paperFormat, setPaperFormat] = useState<'thermal80' | 'thermal58'>('thermal80');
  const [receiptShowTaxBreakup, setReceiptShowTaxBreakup] = useState(true);
  const [receiptShowHsn, setReceiptShowHsn] = useState(true);
  const [receiptFooterNote, setReceiptFooterNote] = useState('Thank you for shopping with us! Visit again.');

  // Initialize from Shop prop
  useEffect(() => {
    if (shop) {
      setName(shop.name || '');
      setBusinessType(shop.businessType || 'retail');
      setGstin(shop.gstin || '');
      setPhone(shop.phone || '');
      setAddress(shop.address || '');
      setUpiId(shop.upiId || '');
      setInvoicePrefix(shop.invoicePrefix || 'INV');
      setWhatsappEnabled(shop.whatsappEnabled !== false);
      setWhatsappDefaultLang(shop.whatsappDefaultLang || 'en');
      setWhatsappIncludeLink(Boolean(shop.whatsappIncludeLink));
      setLoyaltyEnabled(shop.loyaltyEnabled !== false);
      setLoyaltyPointsPer100(shop.loyaltyPointsPer100 ?? 10);
      setLoyaltyPointValueRupees((shop.loyaltyPointValueMinor ?? 10) / 100);
      setLoyaltyMinPointsRedeem(shop.loyaltyMinPointsRedeem ?? 10);
    }
  }, [shop]);

  // Derived state from GSTIN
  const gstinState = useMemo(() => {
    const clean = gstin.trim().toUpperCase();
    if (clean.length >= 2) {
      const code = clean.slice(0, 2);
      const s = STATES.find((st: { code: string; name: string }) => st.code === code);
      if (s) return `${s.name} (State Code ${s.code})`;
    }
    return null;
  }, [gstin]);

  // Live UPI QR SVG Preview
  const upiQrSvgData = useMemo(() => {
    const cleanVpa = upiId.trim();
    if (!cleanVpa || !cleanVpa.includes('@')) return null;
    try {
      const uri = upiUri({
        vpa: cleanVpa,
        name: name.trim() || 'Store Payment',
      });
      return qrSvg(uri, { size: 140, margin: 1 });
    } catch {
      return null;
    }
  }, [upiId, name]);

  // Live WhatsApp Bill Message Preview
  const previewWhatsAppMessage = useMemo(() => {
    return billMessage({
      shopName: name.trim() || 'My Retail Store',
      number: `${invoicePrefix}-1024`,
      totalMinor: 149900, // ₹1,499.00
      balanceMinor: 0,
      url: whatsappIncludeLink ? 'https://bill.store/v/inv_demo' : '',
      lang: whatsappDefaultLang,
      kind: 'sale',
    });
  }, [name, invoicePrefix, whatsappIncludeLink, whatsappDefaultLang]);

  // Save handler
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (user.role !== 'owner' && user.role !== 'manager') {
      setStatusMsg({ type: 'error', text: 'You do not have permission to modify store settings.' });
      return;
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      const payload: Partial<Shop> = {
        name: name.trim(),
        businessType: businessType as any,
        gstin: gstin.trim().toUpperCase() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        upiId: upiId.trim() || undefined,
        invoicePrefix: (invoicePrefix.trim().toUpperCase() || 'INV').slice(0, 6),
        whatsappEnabled,
        whatsappDefaultLang,
        whatsappIncludeLink,
        loyaltyEnabled,
        loyaltyPointsPer100: Math.max(0, Math.min(1000, Number(loyaltyPointsPer100) || 0)),
        loyaltyPointValueMinor: Math.max(1, Math.min(10000, Math.round((Number(loyaltyPointValueRupees) || 0.10) * 100))),
        loyaltyMinPointsRedeem: Math.max(0, Math.min(10000, Number(loyaltyMinPointsRedeem) || 0)),
      };

      await onSaveShop(payload);
      setStatusMsg({ type: 'success', text: 'Store settings successfully validated and saved to backend.' });
      showToast('Store settings saved successfully!', 'success');
    } catch (err: any) {
      const msg = err.message || 'Failed to save store settings';
      setStatusMsg({ type: 'error', text: msg });
      showToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEditable = user.role === 'owner' || user.role === 'manager';

  return (
    <div className="store-settings-container" style={{ padding: '0 0.5rem' }}>
      {/* Top Banner & Status Feedback */}
      {statusMsg && (
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            fontSize: '0.9rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: statusMsg.type === 'success' ? '#ecfdf5' : '#fef2f2',
            color: statusMsg.type === 'success' ? '#065f46' : '#991b1b',
            border: `1px solid ${statusMsg.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span>{statusMsg.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{statusMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {!isEditable && (
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>🔒</span>
          <span>
            You are signed in as <strong>{user.role}</strong>. Store configuration can only be modified by Business Owners and Store Managers.
          </span>
        </div>
      )}

      {/* 6 Section Navigation Tabs */}
      <div
        className="settings-nav-strip"
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          background: '#ffffff',
          padding: '0.5rem',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        {[
          { id: 'profile', icon: '🏢', label: 'Store Profile' },
          { id: 'billing', icon: '📜', label: 'Business & Billing Rules' },
          { id: 'inventory', icon: '📦', label: 'Inventory & Purchase' },
          { id: 'payments', icon: '💳', label: 'Payments & Integrations' },
          { id: 'whatsapp', icon: '📲', label: 'WhatsApp & Notifications' },
          { id: 'security', icon: '🛡️', label: 'Users, Security & Audit' },
        ].map((tab) => {
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id as SettingsSection)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.1rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
                background: isActive ? '#6d4aff' : 'transparent',
                color: isActive ? '#ffffff' : '#64748b',
                boxShadow: isActive ? '0 2px 6px rgba(109,74,255,0.25)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION 1: STORE PROFILE */}
      {activeSection === 'profile' && (
        <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
            <div>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>🏢 Store & Enterprise Profile</span>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Primary legal and operational identifiers printed on statutory invoices, tax registers, and thermal receipts.
              </div>
            </div>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 700,
                background: '#f3f0ff',
                color: '#6d4aff',
                border: '1px solid #e9d5ff',
              }}
            >
              {BUSINESS_TYPE_LABELS[businessType]?.icon} {BUSINESS_TYPE_LABELS[businessType]?.label.split('/')[0]}
            </span>
          </div>

          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Store / Enterprise Name <span style={{ color: '#e11d48' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  disabled={!isEditable}
                  placeholder="e.g. Modern Retail Store"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  Legal trade name displayed at top of printed bills and customer displays.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Business Category & Pack
                </label>
                <select
                  className="form-input"
                  disabled={!isEditable}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                >
                  {Object.entries(BUSINESS_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.icon} {v.label}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  {BUSINESS_TYPE_LABELS[businessType]?.desc}
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  GSTIN (15-digit GST Number)
                </label>
                <input
                  type="text"
                  className="form-input"
                  disabled={!isEditable}
                  placeholder="e.g. 33AABCP1234F1Z5"
                  maxLength={15}
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                />
                {gstinState ? (
                  <span style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '3px', display: 'block', fontWeight: 600 }}>
                    ✓ State Identified: {gstinState}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                    Leave blank if composition dealer or unregistered B2C retail counter.
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Primary Phone / Mobile
                </label>
                <input
                  type="text"
                  className="form-input"
                  disabled={!isEditable}
                  placeholder="e.g. 9876543210"
                  maxLength={13}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  10-digit customer helpline printed on receipts.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Store Operating Address
                </label>
                <input
                  type="text"
                  className="form-input"
                  disabled={!isEditable}
                  placeholder="Street, City, PIN Code"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Invoice Number Prefix
                </label>
                <input
                  type="text"
                  className="form-input"
                  disabled={!isEditable}
                  placeholder="e.g. INV or STORE"
                  maxLength={6}
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  Generates sequential bill numbers like <strong>{invoicePrefix || 'INV'}-0001</strong>. Historical invoices are permanently preserved.
                </span>
              </div>
            </div>

            {/* Active Locations & Multi-Counter Overview */}
            <div
              style={{
                marginTop: '1.5rem',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '1rem',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b', marginBottom: '0.4rem' }}>
                📍 Active Store Locations & Branches
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(shop?.locations || ['MAIN']).map((loc) => (
                  <span
                    key={loc}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#334155',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>🏪</span> {loc}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                Locations with recorded stock ledger movements are safeguarded from deletion to preserve audit history.
              </div>
            </div>

            {isEditable && (
              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary"
                  style={{ padding: '0.65rem 1.5rem', fontWeight: 600 }}
                >
                  {isSubmitting ? 'Saving Profile...' : 'Save Profile Changes'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* SECTION 2: BUSINESS & BILLING RULES */}
      {activeSection === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Customer Loyalty Rewards Program Card */}
          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>🎁 Customer Loyalty Rewards Program</span>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                  Auto-accrues points on paid retail bills and allows cash-equivalent redemption at checkout.
                </div>
              </div>
              <ToggleSwitch
                checked={loyaltyEnabled}
                disabled={!isEditable}
                onChange={() => setLoyaltyEnabled(!loyaltyEnabled)}
                ariaLabel="Toggle customer loyalty program"
              />
            </div>

            <form onSubmit={handleSave}>
              <div style={{ opacity: loyaltyEnabled ? 1 : 0.6, pointerEvents: loyaltyEnabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Points Earned per ₹100 Spent
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className="form-input"
                      disabled={!isEditable}
                      value={loyaltyPointsPer100}
                      onChange={(e) => setLoyaltyPointsPer100(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                      Recommended: 10 points per ₹100 spent (1 point per ₹10).
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Point Cash Value (in Rupees)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0.01}
                      max={100}
                      className="form-input"
                      disabled={!isEditable}
                      value={loyaltyPointValueRupees}
                      onChange={(e) => setLoyaltyPointValueRupees(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                      ₹{loyaltyPointValueRupees.toFixed(2)} discount per 1 redeemed loyalty point.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Minimum Points Required to Redeem
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      className="form-input"
                      disabled={!isEditable}
                      value={loyaltyMinPointsRedeem}
                      onChange={(e) => setLoyaltyMinPointsRedeem(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                      Threshold before redemption button activates in POS tender modal.
                    </span>
                  </div>
                </div>

                {/* Live Simulation Card */}
                <div
                  style={{
                    marginTop: '1.25rem',
                    padding: '1rem',
                    background: '#f8fafc',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: '#334155',
                  }}
                >
                  <strong style={{ color: '#1e293b' }}>💡 Loyalty Scheme Simulation:</strong>
                  <div style={{ marginTop: '4px' }}>
                    On a bill of <strong>₹1,000.00</strong>, the customer earns{' '}
                    <strong>{Math.floor(10 * (loyaltyPointsPer100 || 0))} loyalty points</strong>, redeemable for{' '}
                    <strong style={{ color: '#16a34a' }}>
                      ₹{(Math.floor(10 * (loyaltyPointsPer100 || 0)) * (loyaltyPointValueRupees || 0.1)).toFixed(2)}
                    </strong>{' '}
                    discount on subsequent purchases.
                  </div>
                </div>
              </div>

              {isEditable && (
                <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary"
                    style={{ padding: '0.65rem 1.5rem', fontWeight: 600 }}
                  >
                    {isSubmitting ? 'Saving Loyalty Settings...' : 'Save Loyalty Scheme'}
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Thermal Receipt & POS Checkout Rules */}
          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            <div className="card-title" style={{ marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>🖨️ Thermal Receipt & POS Checkout Preferences</span>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Hardware printer paper width and customer bill presentation rules.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Thermal Paper Width
                </label>
                <select
                  className="form-input"
                  value={paperFormat}
                  onChange={(e) => setPaperFormat(e.target.value as any)}
                >
                  <option value="thermal80">80mm Standard POS Thermal (Recommended)</option>
                  <option value="thermal58">58mm Compact Bluetooth Thermal Printer</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  Controls auto-formatting of columns, item names, and tax tables on receipt printers.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Receipt Footer Custom Note
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={receiptFooterNote}
                  onChange={(e) => setReceiptFooterNote(e.target.value)}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                  Closing greeting printed at bottom of every customer receipt.
                </span>
              </div>
            </div>

            {/* Price Edit & Discount Safeguards info */}
            <div
              style={{
                marginTop: '1.25rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1rem',
              }}
            >
              <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>🛡️ Cashier Discount Safeguard</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '4px' }}>
                  Standard cashier discount is capped at <strong>10%</strong>. Higher discounts require Store Manager or Owner authorization.
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>🏷️ Price Override Policy</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '4px' }}>
                  Catalog price edits require <code>items.write</code> permission. Enforces audit defense against arbitrary price tampering.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: INVENTORY & PURCHASE PREFERENCES */}
      {activeSection === 'inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            <div className="card-title" style={{ marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>📦 Inventory Control & Stock Policies</span>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                Server-side safeguards governing stock decrements, replenishment, and reorder levels.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
              {/* Negative Stock Policy */}
              <div style={{ padding: '1.25rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#1e293b' }}>
                    Negative Stock Policy
                  </span>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: businessType === 'restaurant' || businessType === 'service' ? '#fef3c7' : '#ecfdf5',
                      color: businessType === 'restaurant' || businessType === 'service' ? '#92400e' : '#065f46',
                    }}
                  >
                    {businessType === 'restaurant' || businessType === 'service' ? 'Flexible (Allowed)' : 'Strict (Prohibited)'}
                  </span>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
                  {businessType === 'restaurant' || businessType === 'service'
                    ? 'Restaurant and service businesses permit negative stock to accommodate dynamic kitchen preparation and order fulfillment before supplier inward entry.'
                    : 'Retail, pharmacy, and wholesale stores strictly prohibit negative stock. The backend API validates every transaction to prevent inventory drifting.'}
                </p>
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                  🔒 Enforced server-side in <code>/api/inventory</code>
                </div>
              </div>

              {/* Reorder Thresholds */}
              <div style={{ padding: '1.25rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#1e293b', marginBottom: '0.5rem' }}>
                  Automated Low-Stock Thresholds
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
                  Each SKU in your catalog maintains its own <strong>Reorder Level</strong>. When quantity falls at or below this threshold, automated alerts surface in the Inventory Hub and Replenishment Dashboard.
                </p>
                <div style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.('inventory')}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                  >
                    View Low-Stock Alerts in Inventory Hub →
                  </button>
                </div>
              </div>
            </div>

            {/* Batch & Expiry Traceability */}
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1rem',
                background: '#f1f5f9',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>
                  🏷️ Batch & Expiry Tracking Mode: {businessType === 'pharmacy' ? 'Active (Strict)' : 'Standard'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Pharmaceutical and perishable inward stock maintains lot numbers and expiry dates to prevent dispensing expired products.
                </div>
              </div>
              <span className="badge badge-emerald">Ready</span>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: PAYMENTS & INTEGRATIONS */}
      {activeSection === 'payments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Isolation & Tenant notice */}
          <div style={{ background: '#f8fafc', padding: '0.85rem 1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🔒</span>
              <div>
                <strong style={{ fontSize: '0.88rem', color: '#1e293b' }}>Shop-Isolated Payment Configuration</strong>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Changes apply strictly to {shop?.name || 'this shop'}. Secrets are encrypted at rest with zero client exposure.</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Integration Status:</span>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: integrationStatus === 'connected' ? '#dcfce7' : integrationStatus === 'error' ? '#fee2e2' : '#f1f5f9',
                color: integrationStatus === 'connected' ? '#166534' : integrationStatus === 'error' ? '#991b1b' : '#475569',
                border: `1px solid ${integrationStatus === 'connected' ? '#86efac' : integrationStatus === 'error' ? '#fca5a5' : '#cbd5e1'}`
              }}>
                {integrationStatus === 'connected' ? '● Connected' : integrationStatus === 'error' ? '✕ Error' : '○ Not Configured'}
              </span>
            </div>
          </div>

          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            {/* Top Sub-tabs Bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem', gap: '1rem' }}>
              {[
                { id: 'methods', label: 'Payment Methods', icon: <CreditCardIcon size={15} /> },
                { id: 'qr', label: 'UPI / QR Configuration', icon: <QrCodeIcon size={15} /> },
                { id: 'razorpay', label: 'Razorpay Integration', icon: <ZapIcon size={15} /> },
              ].map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setPaymentSubTab(sub.id as any)}
                  style={{
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderBottom: paymentSubTab === sub.id ? '2px solid #6d4aff' : '2px solid transparent',
                    background: 'transparent',
                    color: paymentSubTab === sub.id ? '#6d4aff' : '#64748b',
                    fontWeight: paymentSubTab === sub.id ? 700 : 500,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>{sub.icon}</span>
                  <span>{sub.label}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleSavePaymentSettings}>
              {/* SUBTAB 1: PAYMENT METHODS */}
              {paymentSubTab === 'methods' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.5 }}>
                    Enable or disable payment methods for this store. Only enabled methods will appear on the cashier POS checkout screen.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                    {[
                      { id: 'cash', label: 'Cash Payment', desc: 'Cash drawer register with change tracking' },
                      { id: 'upi', label: 'UPI / QR Payment', desc: 'Counter QR scan via GPay, PhonePe, Paytm' },
                      { id: 'card', label: 'Debit / Credit Card', desc: 'Swipe / tap terminal card processing' },
                      { id: 'credit', label: 'Customer Credit / Udhaar', desc: 'Post to customer dues account ledger' },
                    ].map((method) => {
                      const isChecked = enabledMethods.includes(method.id);
                      return (
                        <div
                          key={method.id}
                          style={{
                            background: '#f8fafc',
                            border: `1px solid ${isChecked ? '#cbd5e1' : '#e2e8f0'}`,
                            borderRadius: '10px',
                            padding: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>{method.label}</div>
                            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>{method.desc}</div>
                          </div>
                          <ToggleSwitch
                            checked={isChecked}
                            disabled={!isEditable || method.id === 'cash'}
                            onChange={() => {
                              if (isChecked) {
                                setEnabledMethods(enabledMethods.filter((m) => m !== method.id));
                              } else {
                                setEnabledMethods([...enabledMethods, method.id]);
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SUBTAB 2: UPI / QR CONFIGURATION */}
              {paymentSubTab === 'qr' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>Enable UPI QR Code at POS</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>Display QR code on checkout screen and printed receipts.</div>
                    </div>
                    <ToggleSwitch
                      checked={upiEnabled}
                      disabled={!isEditable}
                      onChange={() => setUpiEnabled(!upiEnabled)}
                    />
                  </div>

                  {upiEnabled && (
                    <>
                      {/* QR Type Selection */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.86rem' }}>QR Type Support</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginTop: '0.4rem' }}>
                          <label
                            style={{
                              border: `2px solid ${qrType === 'static' ? '#6d4aff' : '#e2e8f0'}`,
                              background: qrType === 'static' ? '#f5f3ff' : '#ffffff',
                              borderRadius: '10px',
                              padding: '1rem',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.3rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input
                                type="radio"
                                name="qrType"
                                value="static"
                                checked={qrType === 'static'}
                                onChange={() => setQrType('static')}
                                disabled={!isEditable}
                              />
                              <strong style={{ fontSize: '0.88rem', color: '#1e293b' }}>Static QR (Counter VPA)</strong>
                            </div>
                            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                              Fixed merchant UPI QR. Customer enters or confirms amount; Cashier verifies manually.
                            </span>
                          </label>

                          <label
                            style={{
                              border: `2px solid ${qrType === 'dynamic' ? '#6d4aff' : '#e2e8f0'}`,
                              background: qrType === 'dynamic' ? '#f5f3ff' : '#ffffff',
                              borderRadius: '10px',
                              padding: '1rem',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.3rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input
                                type="radio"
                                name="qrType"
                                value="dynamic"
                                checked={qrType === 'dynamic'}
                                onChange={() => setQrType('dynamic')}
                                disabled={!isEditable}
                              />
                              <strong style={{ fontSize: '0.88rem', color: '#1e293b' }}>Dynamic QR (Auto-reconciled)</strong>
                            </div>
                            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                              Unique QR created per bill with exact payable amount. Auto-marks invoice Paid via webhook.
                            </span>
                          </label>
                        </div>
                      </div>

                      {/* Provider Selection */}
                      <div className="form-group">
                        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.86rem' }}>QR Provider</label>
                        <select
                          className="form-input"
                          value={qrProvider}
                          disabled={!isEditable}
                          onChange={(e) => setQrProvider(e.target.value as any)}
                        >
                          <option value="manual">Shop UPI QR / Manual Verification</option>
                          <option value="razorpay">Razorpay (Dynamic UPI QR & Webhooks)</option>
                          <option value="paytm">Paytm (Dynamic UPI QR & Status API)</option>
                          <option value="phonepe">PhonePe (Dynamic UPI QR & Webhooks)</option>
                        </select>
                      </div>

                      {/* Static QR / Shop Details Box */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                        <div>
                          <div className="form-group">
                            <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>Shop UPI VPA / Address</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="e.g. yourstore@okaxis"
                              value={staticUpiId}
                              disabled={!isEditable}
                              onChange={(e) => setStaticUpiId(e.target.value.trim())}
                            />
                            <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                              Counter UPI ID for instant customer payments.
                            </span>
                          </div>

                          <div className="form-group">
                            <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>Merchant Display Name</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="e.g. Sri Krishna Supermarket"
                              value={staticMerchantName}
                              disabled={!isEditable}
                              onChange={(e) => setStaticMerchantName(e.target.value)}
                            />
                          </div>

                          {/* Static Manual Disclaimer */}
                          <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '0.85rem', borderRadius: '8px', fontSize: '0.78rem', color: '#92400e', lineHeight: 1.4 }}>
                            <strong>⚠️ Manual Verification Requirement:</strong> Manual verification does not automatically confirm actual bank credit. Cashiers must verify the incoming credit in their banking/UPI app. Invoices must not be settled based solely on a customer screenshot.
                          </div>
                        </div>

                        {/* Live QR Preview Box */}
                        <div style={{ background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.5rem' }}>Counter QR Preview</span>
                          {staticUpiId && staticUpiId.includes('@') ? (
                            <div
                              style={{ background: '#ffffff', padding: '8px', borderRadius: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}
                              dangerouslySetInnerHTML={{
                                __html: qrSvg(upiUri({ vpa: staticUpiId, name: staticMerchantName || 'Shop' }), { size: 140, margin: 1 })
                              }}
                            />
                          ) : (
                            <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '1.5rem' }}>Enter a valid UPI ID (e.g. store@bank) to preview QR.</div>
                          )}
                          <span style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.5rem' }}>{staticUpiId || 'No UPI ID'}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* SUBTAB 3: RAZORPAY INTEGRATION */}
              {paymentSubTab === 'razorpay' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>Enable Razorpay Gateway</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>Automates dynamic QR code generation, webhook verification, and instant bill payment reconciliation.</div>
                    </div>
                    <ToggleSwitch
                      checked={rzpEnabled}
                      disabled={!isEditable}
                      onChange={() => setRzpEnabled(!rzpEnabled)}
                    />
                  </div>

                  {/* Mode Selector */}
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.86rem' }}>Gateway Environment Mode</label>
                    <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.3rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                        <input
                          type="radio"
                          name="rzpMode"
                          value="test"
                          checked={rzpMode === 'test'}
                          onChange={() => setRzpMode('test')}
                          disabled={!isEditable}
                        />
                        <span>🧪 <strong>Test Mode</strong> (Sandbox / rzp_test_*)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                        <input
                          type="radio"
                          name="rzpMode"
                          value="live"
                          checked={rzpMode === 'live'}
                          onChange={() => setRzpMode('live')}
                          disabled={!isEditable}
                        />
                        <span>🚀 <strong>Live Mode</strong> (Production / rzp_live_*)</span>
                      </label>
                    </div>
                  </div>

                  {/* API Credentials */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        Razorpay Key ID <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder={rzpMode === 'test' ? 'rzp_test_XXXXXXXXXXXX' : 'rzp_live_XXXXXXXXXXXX'}
                        value={rzpKeyId}
                        disabled={!isEditable}
                        onChange={(e) => setRzpKeyId(e.target.value.trim())}
                      />
                    </div>

                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          Razorpay Key Secret <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        {hasStoredKeySecret && (
                          <span style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 600 }}>✓ Secret Configured</span>
                        )}
                      </div>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showKeySecret ? 'text' : 'password'}
                          className="form-input"
                          placeholder={hasStoredKeySecret ? '•••••••••••••••• (Leave blank to keep existing)' : 'Enter Razorpay Key Secret'}
                          value={rzpKeySecret}
                          disabled={!isEditable}
                          onChange={(e) => setRzpKeySecret(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeySecret(!showKeySecret)}
                          style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#64748b' }}
                        >
                          {showKeySecret ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Webhook & Expiry */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>Webhook Secret</label>
                        {hasStoredWebhookSecret && (
                          <span style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 600 }}>✓ Configured</span>
                        )}
                      </div>
                      <input
                        type="password"
                        className="form-input"
                        placeholder={hasStoredWebhookSecret ? '•••••••••••••••• (Leave blank to keep existing)' : 'Webhook signature secret'}
                        value={rzpWebhookSecret}
                        disabled={!isEditable}
                        onChange={(e) => setRzpWebhookSecret(e.target.value)}
                      />
                      <span style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                        Webhook URL: <code>{window.location.origin}/api/webhooks/razorpay/{shop?.id || 'tenant_id'}</code>
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>Dynamic QR Expiry (Minutes)</label>
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        className="form-input"
                        value={rzpQrExpiryMinutes}
                        disabled={!isEditable}
                        onChange={(e) => setRzpQrExpiryMinutes(Number(e.target.value))}
                      />
                      <span style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                        QR automatically expires at customer screen if not paid within this window.
                      </span>
                    </div>
                  </div>

                  {/* Live Key Change / Rotation Notice Card */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '2px' }}>🔄 Live Key Update & Rotation:</div>
                    Shop owner can update Razorpay live keys anytime. New keys are validated against Razorpay APIs server-side before activation. Existing pending transactions will still reconcile safely.
                  </div>

                  {integrationStatusMsg && (
                    <div style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      background: integrationStatus === 'connected' ? '#f0fdf4' : integrationStatus === 'error' ? '#fef2f2' : '#f8fafc',
                      color: integrationStatus === 'connected' ? '#166534' : integrationStatus === 'error' ? '#991b1b' : '#334155',
                      border: `1px solid ${integrationStatus === 'connected' ? '#bbf7d0' : integrationStatus === 'error' ? '#fecaca' : '#e2e8f0'}`
                    }}>
                      {integrationStatus === 'connected' ? '✓ ' : integrationStatus === 'error' ? '✕ ' : 'ℹ '} {integrationStatusMsg}
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Action Bar */}
              {isEditable && (
                <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                  <button
                    type="submit"
                    disabled={isSavingPayments}
                    className="btn btn-primary"
                    style={{ padding: '0.65rem 1.6rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    {isSavingPayments ? (
                      <span>Validating & Saving...</span>
                    ) : (
                      <>
                        <span>Save Payment Configuration</span>
                        <span>✓</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

{/* SECTION 5: WHATSAPP & NOTIFICATIONS */}
      {activeSection === 'whatsapp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b', display: 'inline-flex', alignItems: 'center', gap: '8px' }}><WhatsAppIcon size={18} style={{ color: '#16a34a' }} /> WhatsApp Bill Sharing</span>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                  Instant Click-to-Chat digital receipt sharing at POS checkout and historical invoice view.
                </div>
              </div>
              <ToggleSwitch
                checked={whatsappEnabled}
                disabled={!isEditable}
                onChange={() => setWhatsappEnabled(!whatsappEnabled)}
                ariaLabel="Toggle WhatsApp bill sharing"
              />
            </div>

            <form onSubmit={handleSave}>
              <div style={{ opacity: whatsappEnabled ? 1 : 0.6, pointerEvents: whatsappEnabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                  {/* Default Message Language */}
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Default Message Language
                    </label>
                    <select
                      className="form-input"
                      disabled={!isEditable}
                      value={whatsappDefaultLang}
                      onChange={(e) => setWhatsappDefaultLang(e.target.value as any)}
                    >
                      <option value="en">English (Default)</option>
                      <option value="hi">हिन्दी (Hindi)</option>
                      <option value="ta">தமிழ் (Tamil)</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                      Pre-selected language for POS checkout modal and resend popover.
                    </span>
                  </div>

                  {/* Include Hosted Bill Link */}
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Hosted Bill Link
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.4rem' }}>
                      <ToggleSwitch
                        checked={whatsappIncludeLink}
                        disabled={!isEditable}
                        onChange={() => setWhatsappIncludeLink(!whatsappIncludeLink)}
                        ariaLabel="Toggle hosted bill link in WhatsApp message"
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#334155' }}>
                        {whatsappIncludeLink ? 'Include public bill link' : 'Exclude link (text summary only)'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                      Allows customers to view and download full PDF bills online without account login.
                    </span>
                  </div>
                </div>

                {/* Click-to-Chat Delivery Architecture Info */}
                <div
                  style={{
                    marginTop: '1.25rem',
                    padding: '0.85rem 1rem',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    color: '#065f46',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span>⚡</span>
                  <span>
                    <strong>Direct Click-to-Chat Architecture:</strong> Links launch official <code>https://wa.me/</code> directly on cashier device. 100% free of external SMS/WhatsApp gateway charges.
                  </span>
                </div>

                {/* Live Message Template Preview */}
                <div
                  style={{
                    marginTop: '1.25rem',
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '1.25rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b', marginBottom: '0.5rem' }}>
                    💬 Live Message Preview ({whatsappDefaultLang.toUpperCase()})
                  </div>
                  <pre
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '1rem',
                      fontSize: '0.82rem',
                      fontFamily: 'inherit',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: '#1e293b',
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {previewWhatsAppMessage}
                  </pre>
                </div>
              </div>

              {isEditable && (
                <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-primary"
                    style={{ padding: '0.65rem 1.5rem', fontWeight: 600 }}
                  >
                    {isSubmitting ? 'Saving WhatsApp Settings...' : 'Save WhatsApp Preferences'}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* SECTION 6: USERS, SECURITY & AUDIT */}
      {activeSection === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Strict Isolation Banner */}
          <StrictIsolationBanner />

          {/* Role & Permission Matrix */}
          <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>🛡️ Role-Based Access Control (RBAC) Matrix</span>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                  System roles, capabilities, and tenant data isolation boundaries.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab?.('dashboard')}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
              >
                Manage Staff Users →
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>POS Checkout</th>
                    <th>Catalog & Pricing</th>
                    <th>Purchases & Expenses</th>
                    <th>GST Filings & ITC</th>
                    <th>Store Settings</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#6d4aff' }}>👑 Owner</td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full (All Sections)</span></td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#3b82f6' }}>👔 Store Manager</td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">Full</span></td>
                    <td><span className="badge badge-emerald">View & Review</span></td>
                    <td><span className="badge badge-emerald">Operational Rules</span></td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#10b981' }}>🛒 Cashier</td>
                    <td><span className="badge badge-emerald">Assigned Counter</span></td>
                    <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>Read-Only</span></td>
                    <td><span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>No Access</span></td>
                    <td><span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>No Access</span></td>
                    <td><span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Read-Only</span></td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#f59e0b' }}>📊 Accountant</td>
                    <td><span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>No Access</span></td>
                    <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>Read-Only</span></td>
                    <td><span className="badge badge-emerald">Full Ledger</span></td>
                    <td><span className="badge badge-emerald">Full (GSTR-1, 3B, ITC)</span></td>
                    <td><span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>No Access</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Audit Trail Guarantee Card */}
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1rem',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '0.82rem',
                color: '#334155',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>📋</span>
              <div>
                <strong style={{ color: '#1e293b' }}>Authoritative Immutable Audit Trail Active:</strong>
                <div style={{ marginTop: '3px', color: '#64748b', lineHeight: 1.5 }}>
                  Every configuration edit, profile update, and discount override is atomically recorded into the PostgreSQL <code>audit_log</code> table with user ID (<code>{user.id}</code>), user name, timestamp, and JSON difference tracking.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
