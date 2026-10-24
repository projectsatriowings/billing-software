import React, { useState } from 'react';
import { BUSINESS_TYPES_META, type BusinessTypeMeta } from './businessTypes';
import { STATES } from '../../../shared/states';
import { api, setToken, type User, type Shop } from '../api';

interface RegisterWizardProps {
  initialBusinessType?: string;
  onSuccess: (data: { token: string; user: User; shop: Shop }) => void;
  onBackToHome: () => void;
  onNavigateLogin: () => void;
}

export const RegisterWizard: React.FC<RegisterWizardProps> = ({
  initialBusinessType = 'grocery',
  onSuccess,
  onBackToHome,
  onNavigateLogin,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<string>(initialBusinessType);
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Step 2: Common Business & Owner Information
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('33'); // Default Tamil Nadu
  const [pinCode, setPinCode] = useState('');
  const [country] = useState('India');
  const [gstin, setGstin] = useState('');

  // Step 3: Business-Specific Details (Dynamic per Type)
  const [businessModel, setBusinessModel] = useState<'retail' | 'wholesale' | 'both'>('retail');
  const [restaurantFormat, setRestaurantFormat] = useState<'dinein' | 'takeaway' | 'both'>('both');
  const [enableBarcode, setEnableBarcode] = useState(true);
  const [enableExpiry, setEnableExpiry] = useState(true);
  const [units, setUnits] = useState({ pieces: true, kg: true, grams: true, litres: false, ml: false });

  // Pharmacy details
  const [drugLicenceNo, setDrugLicenceNo] = useState('');
  const [drugExpiryDate, setDrugExpiryDate] = useState('');
  const [pharmacistName, setPharmacistName] = useState('');
  const [pharmacistLicenceNo, setPharmacistLicenceNo] = useState('');
  const [prescriptionWorkflow, setPrescriptionWorkflow] = useState(true);

  // Clothing details
  const [sizeVariants, setSizeVariants] = useState(true);
  const [colorVariants, setColorVariants] = useState(true);
  const [styleVariants, setStyleVariants] = useState(false);

  // Restaurant details
  const [tableManagement, setTableManagement] = useState(true);
  const [kitchenOrderManagement, setKitchenOrderManagement] = useState(true);

  // Electronics & Hardware details
  const [serialTracking, setSerialTracking] = useState(true);
  const [warrantyTracking, setWarrantyTracking] = useState(true);
  const [fractionalQty, setFractionalQty] = useState(true);

  // Services & Wholesale details
  const [sacCodeBilling, setSacCodeBilling] = useState(true);
  const [milestoneTracking, setMilestoneTracking] = useState(true);
  const [creditLimitEnforcement, setCreditLimitEnforcement] = useState(true);
  const [vehiclePoTracking, setVehiclePoTracking] = useState(true);

  // Other details
  const [otherDescription, setOtherDescription] = useState('');

  // Preferences
  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [language, setLanguage] = useState<'en' | 'ta' | 'hi'>('en');

  // Step 4: Account Credentials
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const steps = [
    { num: 1, title: 'Business Type', subtitle: 'Choose your trade' },
    { num: 2, title: 'Business & Owner Info', subtitle: 'Store and contact' },
    { num: 3, title: 'Trade Configuration', subtitle: 'Tailored features' },
    { num: 4, title: 'Account Credentials', subtitle: 'Security & login' },
    { num: 5, title: 'Review & Submit', subtitle: 'Confirm & launch' },
  ];

  const handleNext = () => {
    setError('');
    if (currentStep === 1) {
      if (!selectedType) {
        setError('Please select a business type to proceed.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!businessName.trim()) {
        setError('Business Name is required.');
        return;
      }
      if (!ownerName.trim()) {
        setError('Owner Name is required.');
        return;
      }
      if (!ownerPhone.trim() || ownerPhone.replace(/\D/g, '').length < 10) {
        setError('Please enter a valid 10-digit mobile phone number.');
        return;
      }
      if (!ownerEmail.trim() || !ownerEmail.includes('@')) {
        setError('Please enter a valid business email address.');
        return;
      }
      if (!businessAddress.trim()) {
        setError('Business Address is required.');
        return;
      }
      if (gstin.trim() && gstin.trim().length !== 15) {
        setError('GSTIN must be exactly 15 characters if provided.');
        return;
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      if (selectedType === 'pharmacy') {
        if (!drugLicenceNo.trim()) {
          setError('Drug Licence Number is required for Pharmacy setup.');
          return;
        }
      }
      setCurrentStep(4);
    } else if (currentStep === 4) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match. Please verify your password.');
        return;
      }
      if (!agreeTerms) {
        setError('Please accept the Terms of Service & Privacy Policy.');
        return;
      }
      setCurrentStep(5);
    }
  };

  const handleBack = () => {
    setError('');
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      onBackToHome();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!agreeTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fullAddress = `${businessAddress}${city ? ', ' + city : ''}${pinCode ? ' - ' + pinCode : ''}`;
      const payload: Record<string, any> = {
        name: businessName.trim(),
        businessType: selectedType,
        ownerName: ownerName.trim(),
        email: ownerEmail.trim().toLowerCase(),
        password,
        phone: ownerPhone.trim(),
        address: fullAddress,
        stateCode,
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : undefined,
        invoicePrefix: invoicePrefix.trim() || 'INV',
        language,
      };

      const res = await api<{ token: string; user: User; shop: Shop }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setToken(res.token);
      onSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check your information.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedMeta = BUSINESS_TYPES_META.find((b) => b.id === selectedType) || BUSINESS_TYPES_META[0];

  return (
    <div className="wizard-page-layout">
      {/* Wizard Topbar */}
      <header className="wizard-topbar">
        <div className="wizard-topbar-content">
          <div className="wizard-brand" onClick={onBackToHome} style={{ cursor: 'pointer' }}>
            <span className="brand-icon">⚡</span>
            <span className="brand-title">Adaptive Billing</span>
            <span className="brand-badge-tag">Dynamic Onboarding</span>
          </div>

          <div className="wizard-topbar-actions">
            <button type="button" onClick={onNavigateLogin} className="wizard-ghost-btn">
              Already Registered? Login
            </button>
            <button type="button" onClick={handleBack} className="wizard-back-btn">
              ← {currentStep === 1 ? 'Home' : 'Back'}
            </button>
          </div>
        </div>
      </header>

      <div className="wizard-body-container">
        {/* Left Stepper Sidebar */}
        <aside className="wizard-stepper-sidebar">
          <div className="stepper-header-box">
            <span className="stepper-badge-pill">Step {currentStep} of 5</span>
            <h3 className="stepper-headline">Business Setup</h3>
            <p className="stepper-desc">Multi-tenant business account generation</p>
          </div>

          <div className="stepper-list">
            {steps.map((s) => {
              const isDone = currentStep > s.num;
              const isCurrent = currentStep === s.num;
              return (
                <div
                  key={s.num}
                  className={`stepper-step ${isCurrent ? 'active' : ''} ${isDone ? 'completed' : ''}`}
                  onClick={() => {
                    if (isDone) setCurrentStep(s.num);
                  }}
                  style={{ cursor: isDone ? 'pointer' : 'default' }}
                >
                  <div className="step-indicator">
                    {isDone ? '✓' : s.num}
                  </div>
                  <div className="step-label-wrapper">
                    <span className="step-num-text">Step {s.num}</span>
                    <span className="step-title-text">{s.title}</span>
                    <span className="step-subtitle-text">{s.subtitle}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sidebar-help-card">
            <div className="help-icon-bubble">🛡️</div>
            <h4>Strict Isolation Active</h4>
            <p>Your business will be provisioned in an isolated cryptographic tenant workspace. No cross-store data leaks.</p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="wizard-main-content">
          <div className="wizard-card-surface">
            {/* STEP 1: Select Business Type */}
            {currentStep === 1 && (
              <div className="wizard-step-pane">
                <div className="step-header">
                  <span className="step-tag-pill">Step 1 • Business Architecture</span>
                  <h2 className="step-heading">Choose Your Business Type</h2>
                  <p className="step-subheading">
                    Adaptive Billing customizes POS keyboards, units, inventory batches, and GST invoices specifically for your trade.
                  </p>
                </div>

                <div className="business-selector-grid">
                  {BUSINESS_TYPES_META.map((b: BusinessTypeMeta) => {
                    const isSelected = selectedType === b.id;
                    return (
                      <div
                        key={b.id}
                        className={`biz-select-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedType(b.id)}
                      >
                        <div className="biz-select-top">
                          <span
                            className="biz-select-emoji"
                            style={{
                              background: `linear-gradient(135deg, ${b.badgeColor}18, ${b.badgeColor}30)`,
                              borderColor: `${b.badgeColor}40`,
                            }}
                          >
                            {b.icon}
                          </span>
                          {isSelected ? (
                            <span className="selection-checkmark">✓ Selected</span>
                          ) : (
                            <span className="select-radio-circle" />
                          )}
                        </div>
                        <h4 className="biz-select-title">{b.title}</h4>
                        <p className="biz-select-desc">{b.shortDesc}</p>
                        <div className="biz-select-meta-tag">
                          <span>Tailored POS</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {error && <div className="wizard-error-banner">{error}</div>}

                <div className="step-footer-actions">
                  <button type="button" onClick={onNavigateLogin} className="link-action-btn">
                    Already have an account? Sign In →
                  </button>
                  <button type="button" onClick={handleNext} className="wizard-btn-next">
                    <span>Next: Business Information</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Common Business & Owner Information */}
            {currentStep === 2 && (
              <div className="wizard-step-pane">
                <div className="step-header">
                  <div className="step-type-pill" style={{ color: selectedMeta.badgeColor }}>
                    <span>{selectedMeta.icon}</span>
                    <span>{selectedMeta.title} Setup</span>
                  </div>
                  <h2 className="step-heading">Business & Owner Profile</h2>
                  <p className="step-subheading">
                    Enter your shop details and primary owner contact. This information will appear on official GST invoices.
                  </p>
                </div>

                <div className="wizard-form-section">
                  <h3 className="section-divider-title">🏢 Store Information</h3>

                  <div className="form-two-col-grid">
                    <div className="form-field-group">
                      <label className="field-label">Business / Shop Name *</label>
                      <input
                        type="text"
                        className="text-input"
                        required
                        placeholder={selectedType === 'pharmacy' ? 'Apollo Lifecare Pharmacy' : selectedType === 'clothing' ? 'FabStyle Boutique' : 'Green Supermarket'}
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                      />
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">GSTIN (Optional)</label>
                      <input
                        type="text"
                        className="text-input"
                        maxLength={15}
                        placeholder="e.g. 33AABCU9603R1ZM (15 chars)"
                        value={gstin}
                        onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      />
                      <small className="field-hint">Leave blank if unregistered or composition dealer</small>
                    </div>
                  </div>

                  <div className="form-field-group">
                    <label className="field-label">Shop Street Address *</label>
                    <input
                      type="text"
                      className="text-input"
                      required
                      placeholder="Door No, Building, Street, Commercial Complex"
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                    />
                  </div>

                  <div className="form-three-col-grid">
                    <div className="form-field-group">
                      <label className="field-label">City *</label>
                      <input
                        type="text"
                        className="text-input"
                        required
                        placeholder="e.g. Chennai / Mumbai"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      />
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">State / UT (India) *</label>
                      <select
                        className="text-input"
                        value={stateCode}
                        onChange={(e) => setStateCode(e.target.value)}
                      >
                        {STATES.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.code} - {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">PIN / Postal Code</label>
                      <input
                        type="text"
                        className="text-input"
                        maxLength={6}
                        placeholder="e.g. 600001"
                        value={pinCode}
                        onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                  </div>

                  <h3 className="section-divider-title" style={{ marginTop: '1.5rem' }}>👤 Primary Owner Contact</h3>

                  <div className="form-three-col-grid">
                    <div className="form-field-group">
                      <label className="field-label">Owner Full Name *</label>
                      <input
                        type="text"
                        className="text-input"
                        required
                        placeholder="e.g. Ramesh Kumar"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                      />
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">Mobile Phone *</label>
                      <input
                        type="tel"
                        className="text-input"
                        required
                        maxLength={10}
                        placeholder="9876543210 (10 digits)"
                        value={ownerPhone}
                        onChange={(e) => setOwnerPhone(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">Business Email (Login Identifier) *</label>
                      <input
                        type="email"
                        className="text-input"
                        required
                        placeholder="owner@yourstore.in"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {error && <div className="wizard-error-banner">{error}</div>}

                <div className="step-footer-actions">
                  <button type="button" onClick={() => setCurrentStep(1)} className="wizard-btn-prev">
                    ← Change Business Type
                  </button>
                  <button type="button" onClick={handleNext} className="wizard-btn-next">
                    <span>Next: Trade Configuration</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Business-Specific Details (Dynamic Setup) */}
            {currentStep === 3 && (
              <div className="wizard-step-pane">
                <div className="step-header">
                  <div className="step-type-pill" style={{ color: selectedMeta.badgeColor }}>
                    <span>{selectedMeta.icon}</span>
                    <span>Specialized {selectedMeta.title} Modules</span>
                  </div>
                  <h2 className="step-heading">Trade-Specific Configuration</h2>
                  <p className="step-subheading">
                    Customize workflows for {selectedMeta.title}. You can always adjust these settings later from Business Packs.
                  </p>
                </div>

                <div className="wizard-form-section">
                  {/* GROCERY / SUPERMARKET */}
                  {(selectedType === 'grocery' || selectedType === 'supermarket') && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">🛒 Grocery & Supermarket Preferences</h4>
                      <div className="form-field-group">
                        <label className="field-label">Operating Model</label>
                        <div className="radio-option-row">
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="groceryModel"
                              checked={businessModel === 'retail'}
                              onChange={() => setBusinessModel('retail')}
                            />
                            <span>Retail Counter (Barcode & Thermal)</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="groceryModel"
                              checked={businessModel === 'wholesale'}
                              onChange={() => setBusinessModel('wholesale')}
                            />
                            <span>Wholesale Distribution</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="groceryModel"
                              checked={businessModel === 'both'}
                              onChange={() => setBusinessModel('both')}
                            />
                            <span>Both (Retail + B2B Wholesale)</span>
                          </label>
                        </div>
                      </div>

                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={enableBarcode}
                            onChange={(e) => setEnableBarcode(e.target.checked)}
                          />
                          <span>Fast USB / Bluetooth Barcode POS Mode</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={enableExpiry}
                            onChange={(e) => setEnableExpiry(e.target.checked)}
                          />
                          <span>Batch & Expiry Date Alert Tracking</span>
                        </label>
                      </div>

                      <div className="units-selection-group">
                        <label className="field-label">Active Units for Inventory</label>
                        <div className="chips-row">
                          <span className={`chip-pill ${units.pieces ? 'active' : ''}`} onClick={() => setUnits({ ...units, pieces: !units.pieces })}>Pieces (pcs)</span>
                          <span className={`chip-pill ${units.kg ? 'active' : ''}`} onClick={() => setUnits({ ...units, kg: !units.kg })}>Kilograms (kg)</span>
                          <span className={`chip-pill ${units.grams ? 'active' : ''}`} onClick={() => setUnits({ ...units, grams: !units.grams })}>Grams (g)</span>
                          <span className={`chip-pill ${units.litres ? 'active' : ''}`} onClick={() => setUnits({ ...units, litres: !units.litres })}>Litres (l)</span>
                          <span className={`chip-pill ${units.ml ? 'active' : ''}`} onClick={() => setUnits({ ...units, ml: !units.ml })}>Millilitres (ml)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PHARMACY */}
                  {selectedType === 'pharmacy' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">💊 Pharmacy & Drug Compliance</h4>
                      <div className="form-two-col-grid">
                        <div className="form-field-group">
                          <label className="field-label">Drug Licence Number (Form 20B/21B) *</label>
                          <input
                            type="text"
                            className="text-input"
                            required
                            placeholder="e.g. DL-TN-CHE-2024-5432"
                            value={drugLicenceNo}
                            onChange={(e) => setDrugLicenceNo(e.target.value)}
                          />
                        </div>
                        <div className="form-field-group">
                          <label className="field-label">Licence Expiry Date</label>
                          <input
                            type="date"
                            className="text-input"
                            value={drugExpiryDate}
                            onChange={(e) => setDrugExpiryDate(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="form-two-col-grid">
                        <div className="form-field-group">
                          <label className="field-label">Registered Pharmacist Name</label>
                          <input
                            type="text"
                            className="text-input"
                            placeholder="e.g. M. Anitha B.Pharm"
                            value={pharmacistName}
                            onChange={(e) => setPharmacistName(e.target.value)}
                          />
                        </div>
                        <div className="form-field-group">
                          <label className="field-label">Pharmacy Reg. No.</label>
                          <input
                            type="text"
                            className="text-input"
                            placeholder="e.g. TN-PC-87654"
                            value={pharmacistLicenceNo}
                            onChange={(e) => setPharmacistLicenceNo(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={enableExpiry}
                            onChange={(e) => setEnableExpiry(e.target.checked)}
                          />
                          <span>Mandatory Batch & Expiry Tracking (FEFO Rule)</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={prescriptionWorkflow}
                            onChange={(e) => setPrescriptionWorkflow(e.target.checked)}
                          />
                          <span>Prescription & Doctor Record on Patient Bill</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* CLOTHING */}
                  {selectedType === 'clothing' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">👔 Apparel, Size & Colour Variants</h4>
                      <div className="form-field-group">
                        <label className="field-label">Business Model</label>
                        <div className="radio-option-row">
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="clothingModel"
                              checked={businessModel === 'retail'}
                              onChange={() => setBusinessModel('retail')}
                            />
                            <span>Retail Boutique</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="clothingModel"
                              checked={businessModel === 'wholesale'}
                              onChange={() => setBusinessModel('wholesale')}
                            />
                            <span>Textile Wholesale</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="clothingModel"
                              checked={businessModel === 'both'}
                              onChange={() => setBusinessModel('both')}
                            />
                            <span>Both</span>
                          </label>
                        </div>
                      </div>

                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={sizeVariants}
                            onChange={(e) => setSizeVariants(e.target.checked)}
                          />
                          <span>Size Variants (XS, S, M, L, XL, XXL)</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={colorVariants}
                            onChange={(e) => setColorVariants(e.target.checked)}
                          />
                          <span>Colour Variants</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={styleVariants}
                            onChange={(e) => setStyleVariants(e.target.checked)}
                          />
                          <span>Style / Pattern Variants</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={enableBarcode}
                            onChange={(e) => setEnableBarcode(e.target.checked)}
                          />
                          <span>Barcode Garment Tag Printing</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* RESTAURANT */}
                  {selectedType === 'restaurant' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">🍽️ Restaurant & Dine-In Management</h4>
                      <div className="form-field-group">
                        <label className="field-label">Service Format</label>
                        <div className="radio-option-row">
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="restFormat"
                              checked={restaurantFormat === 'dinein'}
                              onChange={() => setRestaurantFormat('dinein')}
                            />
                            <span>Dine-In Tables</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="restFormat"
                              checked={restaurantFormat === 'takeaway'}
                              onChange={() => setRestaurantFormat('takeaway')}
                            />
                            <span>Takeaway / Quick Service</span>
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name="restFormat"
                              checked={restaurantFormat === 'both'}
                              onChange={() => setRestaurantFormat('both')}
                            />
                            <span>Both (Dine-In + Takeaway + Delivery)</span>
                          </label>
                        </div>
                      </div>

                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={tableManagement}
                            onChange={(e) => setTableManagement(e.target.checked)}
                          />
                          <span>Table Orders & Floor Layout Mapping</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={kitchenOrderManagement}
                            onChange={(e) => setKitchenOrderManagement(e.target.checked)}
                          />
                          <span>Kitchen Order Tickets (KOT) Thermal Dispatch</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ELECTRONICS */}
                  {selectedType === 'electronics' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">📱 Electronics & Serial Tracking</h4>
                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={serialTracking}
                            onChange={(e) => setSerialTracking(e.target.checked)}
                          />
                          <span>Serial Number & IMEI Tracking per Unit</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={warrantyTracking}
                            onChange={(e) => setWarrantyTracking(e.target.checked)}
                          />
                          <span>Warranty Coverage Months on Invoices</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* HARDWARE */}
                  {selectedType === 'hardware' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">🔧 Hardware & Fractional Quantities</h4>
                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={fractionalQty}
                            onChange={(e) => setFractionalQty(e.target.checked)}
                          />
                          <span>Fractional Quantities (e.g. 2.5 metres, 0.75 kg)</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={vehiclePoTracking}
                            onChange={(e) => setVehiclePoTracking(e.target.checked)}
                          />
                          <span>Vehicle Transport & E-Way Reference</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* WHOLESALE */}
                  {selectedType === 'wholesale' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">📦 Wholesale B2B & Credit Ledger</h4>
                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={creditLimitEnforcement}
                            onChange={(e) => setCreditLimitEnforcement(e.target.checked)}
                          />
                          <span>Buyer Credit Limits & Khata Overdue Alerts</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={vehiclePoTracking}
                            onChange={(e) => setVehiclePoTracking(e.target.checked)}
                          />
                          <span>Purchase Order (PO) & Lorry Receipt References</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* SERVICES */}
                  {selectedType === 'service' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">💼 Professional Services & SAC Billing</h4>
                      <div className="checkbox-option-row">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={sacCodeBilling}
                            onChange={(e) => setSacCodeBilling(e.target.checked)}
                          />
                          <span>SAC Codes & Consulting Hourly/Milestone Billing</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={milestoneTracking}
                            onChange={(e) => setMilestoneTracking(e.target.checked)}
                          />
                          <span>Project Reference & Payment Due Date Tracking</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* OTHER */}
                  {selectedType === 'other' && (
                    <div className="dynamic-module-box">
                      <h4 className="module-title">✨ Custom Business Setup</h4>
                      <div className="form-field-group">
                        <label className="field-label">Specialty Trade Description</label>
                        <textarea
                          className="text-input"
                          rows={3}
                          placeholder="Describe your unique billing and inventory needs..."
                          value={otherDescription}
                          onChange={(e) => setOtherDescription(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* INVOICE & PRINT PREFERENCES */}
                  <h3 className="section-divider-title" style={{ marginTop: '1.5rem' }}>🧾 Invoicing & Language</h3>
                  <div className="form-two-col-grid">
                    <div className="form-field-group">
                      <label className="field-label">Invoice Serial Prefix</label>
                      <input
                        type="text"
                        className="text-input"
                        maxLength={6}
                        placeholder="INV"
                        value={invoicePrefix}
                        onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                      />
                      <small className="field-hint">e.g. {invoicePrefix || 'INV'}-2026-0001</small>
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">Receipt & WhatsApp Language</label>
                      <select
                        className="text-input"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as any)}
                      >
                        <option value="en">English (Default)</option>
                        <option value="ta">Tamil (தமிழ்)</option>
                        <option value="hi">Hindi (हिंदी)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {error && <div className="wizard-error-banner">{error}</div>}

                <div className="step-footer-actions">
                  <button type="button" onClick={() => setCurrentStep(2)} className="wizard-btn-prev">
                    ← Back to Business Info
                  </button>
                  <button type="button" onClick={handleNext} className="wizard-btn-next">
                    <span>Next: Account Credentials</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Owner Account Credentials */}
            {currentStep === 4 && (
              <div className="wizard-step-pane">
                <div className="step-header">
                  <span className="step-tag-pill">Step 4 • Security & Login</span>
                  <h2 className="step-heading">Owner Password & Security</h2>
                  <p className="step-subheading">
                    Create the master password for <strong>{ownerEmail || 'your owner account'}</strong>.
                  </p>
                </div>

                <div className="wizard-form-section">
                  <div className="form-field-group">
                    <label className="field-label">Master Login Username (Email)</label>
                    <input
                      type="email"
                      className="text-input read-only-input"
                      readOnly
                      value={ownerEmail}
                    />
                    <small className="field-hint">To change this email, click Back to Business & Owner Info</small>
                  </div>

                  <div className="form-two-col-grid">
                    <div className="form-field-group">
                      <label className="field-label">Password *</label>
                      <input
                        type="password"
                        className="text-input"
                        required
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <small className="field-hint">Include numbers and symbols for high security</small>
                    </div>

                    <div className="form-field-group">
                      <label className="field-label">Confirm Password *</label>
                      <input
                        type="password"
                        className="text-input"
                        required
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                      {password && confirmPassword && (
                        <small style={{ color: password === confirmPassword ? '#10b981' : '#f43f5e' }}>
                          {password === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                        </small>
                      )}
                    </div>
                  </div>

                  <div className="checkbox-agreement-box">
                    <label className="checkbox-label" style={{ alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        checked={agreeTerms}
                        onChange={(e) => setAgreeTerms(e.target.checked)}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
                        I agree to the <strong>Terms of Service</strong>, <strong>Privacy Policy</strong>, and confirm that our store operations comply with applicable Indian GST and trade regulations. I understand that our business data is securely isolated from all other platform tenants.
                      </span>
                    </label>
                  </div>
                </div>

                {error && <div className="wizard-error-banner">{error}</div>}

                <div className="step-footer-actions">
                  <button type="button" onClick={() => setCurrentStep(3)} className="wizard-btn-prev">
                    ← Back to Trade Setup
                  </button>
                  <button type="button" onClick={handleNext} className="wizard-btn-next">
                    <span>Next: Review & Submit</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: Review & Submit (Step E from prompt) */}
            {currentStep === 5 && (
              <form onSubmit={handleSubmit} className="wizard-step-pane">
                <div className="step-header">
                  <span className="step-tag-pill" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                    Step 5 • Review & Launch
                  </span>
                  <h2 className="step-heading">Review & Confirm Registration</h2>
                  <p className="step-subheading">
                    Please verify your details below. Once confirmed, your isolated business workspace and master catalog will be generated.
                  </p>
                </div>

                <div className="wizard-review-container">
                  {/* Card 1: Business Identity */}
                  <div className="review-section-card">
                    <div className="review-card-header">
                      <div className="review-header-title">
                        <span className="review-header-icon">{selectedMeta.icon}</span>
                        <h4>Business Identity</h4>
                      </div>
                      <button type="button" onClick={() => setCurrentStep(1)} className="review-edit-btn">
                        ✏️ Edit Type
                      </button>
                    </div>
                    <div className="review-grid">
                      <div className="review-item">
                        <span className="review-label">Business Type</span>
                        <strong className="review-value">{selectedMeta.title} ({selectedType})</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">Store Name</span>
                        <strong className="review-value">{businessName}</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">GSTIN</span>
                        <strong className="review-value">{gstin || 'Unregistered / Composition'}</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">Store Address</span>
                        <strong className="review-value">{businessAddress}, {city} ({stateCode})</strong>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Owner & Login */}
                  <div className="review-section-card">
                    <div className="review-card-header">
                      <div className="review-header-title">
                        <span className="review-header-icon">👤</span>
                        <h4>Owner & Security</h4>
                      </div>
                      <button type="button" onClick={() => setCurrentStep(2)} className="review-edit-btn">
                        ✏️ Edit Contact
                      </button>
                    </div>
                    <div className="review-grid">
                      <div className="review-item">
                        <span className="review-label">Owner Name</span>
                        <strong className="review-value">{ownerName}</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">Mobile Phone</span>
                        <strong className="review-value">{ownerPhone}</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">Login Identifier (Email)</span>
                        <strong className="review-value" style={{ color: '#6d4aff' }}>{ownerEmail}</strong>
                      </div>
                      <div className="review-item">
                        <span className="review-label">Password Protection</span>
                        <strong className="review-value" style={{ color: '#10b981' }}>•••••••• (Encrypted PBKDF2)</strong>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Modules & Preferences */}
                  <div className="review-section-card">
                    <div className="review-card-header">
                      <div className="review-header-title">
                        <span className="review-header-icon">⚙️</span>
                        <h4>Active Modules & Invoicing</h4>
                      </div>
                      <button type="button" onClick={() => setCurrentStep(3)} className="review-edit-btn">
                        ✏️ Edit Modules
                      </button>
                    </div>
                    <div className="review-badges-row">
                      <span className="review-feature-badge">✓ {invoicePrefix}-0001 Serial Prefix</span>
                      <span className="review-feature-badge">✓ {language === 'en' ? 'English' : language === 'ta' ? 'Tamil' : 'Hindi'} Invoicing</span>
                      {enableBarcode && <span className="review-feature-badge">✓ Barcode POS Active</span>}
                      {enableExpiry && <span className="review-feature-badge">✓ Batch & Expiry Tracking</span>}
                      {selectedType === 'pharmacy' && <span className="review-feature-badge">✓ Lic: {drugLicenceNo}</span>}
                      {selectedType === 'restaurant' && tableManagement && <span className="review-feature-badge">✓ Table Orders & KOT</span>}
                      {selectedType === 'clothing' && <span className="review-feature-badge">✓ Size & Colour Matrix</span>}
                      {selectedType === 'electronics' && <span className="review-feature-badge">✓ IMEI Serial Tracking</span>}
                      <span className="review-feature-badge">✓ Strict Multi-Tenant Isolation</span>
                    </div>
                  </div>
                </div>

                {error && <div className="wizard-error-banner">{error}</div>}

                <div className="step-footer-actions">
                  <button type="button" onClick={() => setCurrentStep(4)} className="wizard-btn-prev">
                    ← Back to Password
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="wizard-btn-submit"
                  >
                    {isSubmitting ? (
                      <span>Provisioning Store...</span>
                    ) : (
                      <>
                        <span>🚀 Create Business Account & Launch Dashboard</span>
                        <span>→</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
