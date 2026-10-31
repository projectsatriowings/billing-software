import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  getStockTransfers,
  getNextStockTransferNumber,
  getBranchStock,
  getStockTransfer,
  createStockTransfer,
  dispatchStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
  api,
  type User,
} from '../../api';
import type {
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
  StockMove,
  Branch,
} from '../../../../shared/types';
import {
  PackageIcon,
  SearchIcon,
  Trash2Icon,
  CheckCircleIcon,
  AlertTriangleIcon,
  CalendarIcon,
  UserIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  FilterIcon,
  TruckIcon,
  FileTextIcon,
  ClockIcon,
  RefreshCwIcon,
  XIcon,
  PrinterIcon,
} from './InventoryIcons';

interface StockTransferViewProps {
  user: User;
  onNavigateToTab?: (tab: string) => void;
  showToast?: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

export const StockTransferView: React.FC<StockTransferViewProps> = ({
  user,
  onNavigateToTab,
  showToast = (msg) => console.log(msg),
}) => {
  // Navigation / sub-views: 'list' | 'create_step1' | 'create_step2' | 'create_step3' | 'details'
  const [activeView, setActiveView] = useState<'list' | 'create_step1' | 'create_step2' | 'create_step3' | 'details'>('list');
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);

  // Branches list
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Screen 1: Transfer List State
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [totalTransfers, setTotalTransfers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingList, setLoadingList] = useState(false);

  // Filters for Screen 1
  const [filterBranch, setFilterBranch] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterFromDate, setFilterFromDate] = useState<string>('');
  const [filterToDate, setFilterToDate] = useState<string>('');

  // Screens 2, 3, 4: Creation Wizard State
  const [nextTransferNumber, setNextTransferNumber] = useState<string>('TRF-0001');
  const [wizardFromBranch, setWizardFromBranch] = useState<string>('');
  const [wizardToBranch, setWizardToBranch] = useState<string>('');
  const [wizardTransferDate, setWizardTransferDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [wizardNotes, setWizardNotes] = useState<string>('');
  const [wizardLines, setWizardLines] = useState<
    {
      itemId: string;
      name: string;
      sku: string;
      barcode?: string;
      unit: string;
      availableStockMilli: number;
      transferQty: number; // in normal unit (e.g. 20)
    }[]
  >([]);

  // Product search in Screen 3
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [branchProducts, setBranchProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // Screen 5 & 6: Transfer Details State
  const [detailedTransfer, setDetailedTransfer] = useState<StockTransfer | null>(null);
  const [detailedLines, setDetailedLines] = useState<StockTransferLine[]>([]);
  const [detailedMoves, setDetailedMoves] = useState<{ source: StockMove[]; destination: StockMove[] }>({
    source: [],
    destination: [],
  });
  const [detailedActivityLog, setDetailedActivityLog] = useState<any[]>([]);
  const [detailsTab, setDetailsTab] = useState<'items' | 'activity'>('items');
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Receiving Modal State
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveLines, setReceiveLines] = useState<
    {
      lineId: string;
      itemName: string;
      dispatchedQty: number;
      receivedQty: number;
      unit: string;
      discrepancyReason: string;
    }[]
  >([]);
  const [submittingReceive, setSubmittingReceive] = useState(false);

  // Dispatch confirmation modal
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [submittingDispatch, setSubmittingDispatch] = useState(false);

  // Submitting Creation
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Load branches on mount
  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    try {
      setLoadingBranches(true);
      const res = await api<{ branches: Branch[] }>('/api/branches');
      const bList = res.branches || [];
      setBranches(bList);

      // Default wizard branches
      if (bList.length > 0) {
        const defaultSource = user.assignedLocation && bList.some((b) => b.code === user.assignedLocation)
          ? user.assignedLocation
          : bList[0].code;
        setWizardFromBranch(defaultSource);

        const defaultDest = bList.find((b) => b.code !== defaultSource)?.code || '';
        setWizardToBranch(defaultDest);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load branches', 'error');
    } finally {
      setLoadingBranches(false);
    }
  };

  // Load Transfers List
  useEffect(() => {
    if (activeView === 'list') {
      loadTransfersList();
    }
  }, [activeView, currentPage, filterBranch, filterStatus, filterFromDate, filterToDate]);

  const loadTransfersList = async () => {
    try {
      setLoadingList(true);
      const res = await getStockTransfers({
        branch: filterBranch !== 'ALL' ? filterBranch : undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
        search: filterSearch.trim() || undefined,
        from: filterFromDate || undefined,
        to: filterToDate || undefined,
        page: currentPage,
        limit: 10,
      });
      setTransfers(res.transfers || []);
      setTotalTransfers(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      showToast(err.message || 'Failed to load transfers', 'error');
    } finally {
      setLoadingList(false);
    }
  };

  // Fetch next transfer number when entering Screen 2
  const handleStartCreateTransfer = async () => {
    try {
      const res = await getNextStockTransferNumber();
      setNextTransferNumber(res.nextTransferNumber || 'TRF-0001');
    } catch {
      setNextTransferNumber('TRF-0001');
    }
    setWizardLines([]);
    setWizardNotes('');
    setWizardTransferDate(new Date().toISOString().split('T')[0]);
    setActiveView('create_step1');
  };

  // Load branch stock when on Screen 3
  useEffect(() => {
    if (activeView === 'create_step2' && wizardFromBranch) {
      loadSourceBranchProducts();
    }
  }, [activeView, wizardFromBranch, productSearchQuery]);

  const loadSourceBranchProducts = async () => {
    try {
      setLoadingProducts(true);
      const res = await getBranchStock(wizardFromBranch, productSearchQuery.trim());
      setBranchProducts(res.items || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Load details for Screen 5 & 6
  const handleViewTransferDetails = async (id: string) => {
    setSelectedTransferId(id);
    setActiveView('details');
    setDetailsTab('items');
    try {
      setLoadingDetails(true);
      const res = await getStockTransfer(id);
      setDetailedTransfer(res.transfer);
      setDetailedLines(res.lines || []);
      setDetailedMoves(res.stockMoves || { source: [], destination: [] });
      setDetailedActivityLog(res.activityLog || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load transfer details', 'error');
    } finally {
      setLoadingDetails(false);
    }
  };

  // Screen 2: Proceed to Add Products
  const handleStep1Next = () => {
    if (!wizardFromBranch) {
      showToast('Please select a source branch (From Branch).', 'error');
      return;
    }
    if (!wizardToBranch) {
      showToast('Please select a destination branch (To Branch).', 'error');
      return;
    }
    if (wizardFromBranch === wizardToBranch) {
      showToast('Source and Destination branches cannot be the same. Please choose different branches.', 'error');
      return;
    }
    setActiveView('create_step2');
  };

  // Screen 3: Add product to transfer list
  const handleAddProductToTransfer = (prod: any) => {
    if (wizardLines.some((l) => l.itemId === prod.id)) {
      showToast(`"${prod.name}" is already in the transfer list. Adjust its quantity below.`, 'info');
      setShowProductDropdown(false);
      return;
    }

    const available = Number(prod.availableStockMilli || 0);
    if (available <= 0) {
      showToast(`"${prod.name}" has 0 stock at ${wizardFromBranch}. Cannot transfer out of stock items.`, 'error');
      return;
    }

    // Default transfer qty: 1 unit or available
    const initialQty = Math.min(1, available / 1000);
    setWizardLines((prev) => [
      ...prev,
      {
        itemId: prod.id,
        name: prod.name,
        sku: prod.sku || 'SKU-GEN',
        barcode: prod.barcode || '',
        unit: prod.unit || 'pcs',
        availableStockMilli: available,
        transferQty: initialQty,
      },
    ]);
    setShowProductDropdown(false);
    setProductSearchQuery('');
  };

  // Screen 3: Update qty for line
  const handleUpdateLineQty = (itemId: string, newQty: number) => {
    setWizardLines((prev) =>
      prev.map((l) => {
        if (l.itemId !== itemId) return l;
        return {
          ...l,
          transferQty: isNaN(newQty) ? 0 : newQty,
        };
      })
    );
  };

  // Screen 3: Remove line
  const handleRemoveLine = (itemId: string) => {
    setWizardLines((prev) => prev.filter((l) => l.itemId !== itemId));
  };

  // Screen 3: Proceed to Review
  const handleStep2Next = () => {
    if (wizardLines.length === 0) {
      showToast('Please add at least one product to the stock transfer.', 'error');
      return;
    }
    for (const l of wizardLines) {
      if (l.transferQty <= 0) {
        showToast(`Quantity for "${l.name}" must be greater than 0.`, 'error');
        return;
      }
      const maxAllowed = l.availableStockMilli / 1000;
      if (l.transferQty > maxAllowed) {
        showToast(
          `Quantity for "${l.name}" (${l.transferQty}) exceeds available stock (${maxAllowed}) at ${wizardFromBranch}.`,
          'error'
        );
        return;
      }
    }
    setActiveView('create_step3');
  };

  // Screen 4: Confirm and save transfer
  const handleConfirmTransfer = async () => {
    try {
      setSubmittingCreate(true);
      const res = await createStockTransfer({
        fromBranch: wizardFromBranch,
        toBranch: wizardToBranch,
        transferDate: wizardTransferDate,
        notes: wizardNotes || undefined,
        lines: wizardLines.map((l) => ({
          itemId: l.itemId,
          qtyMilli: Math.round(l.transferQty * 1000),
          unit: l.unit,
        })),
      });

      showToast(res.message || 'Transfer created successfully!', 'success');
      // View newly created transfer
      handleViewTransferDetails(res.transferId);
    } catch (err: any) {
      showToast(err.message || 'Failed to create transfer', 'error');
    } finally {
      setSubmittingCreate(false);
    }
  };

  // Screen 5: Dispatch Action
  const handleConfirmDispatch = async () => {
    if (!detailedTransfer) return;
    try {
      setSubmittingDispatch(true);
      const res = await dispatchStockTransfer(detailedTransfer.id);
      showToast(res.message || 'Transfer dispatched successfully!', 'success');
      setShowDispatchModal(false);
      handleViewTransferDetails(detailedTransfer.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to dispatch transfer', 'error');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  // Screen 5: Open Receiving Modal
  const handleOpenReceiveModal = () => {
    if (!detailedLines) return;
    setReceiveLines(
      detailedLines.map((l) => ({
        lineId: l.id,
        itemName: l.itemName || 'Product',
        dispatchedQty: l.qtyMilli / 1000,
        receivedQty: l.receivedQtyMilli > 0 ? l.receivedQtyMilli / 1000 : l.qtyMilli / 1000,
        unit: l.unit || 'pcs',
        discrepancyReason: l.discrepancyReason || '',
      }))
    );
    setShowReceiveModal(true);
  };

  // Screen 5: Submit Receipt
  const handleSubmitReceipt = async () => {
    if (!detailedTransfer) return;
    try {
      // Validate shortages have reasons
      for (const line of receiveLines) {
        if (line.receivedQty < 0) {
          showToast(`Received quantity cannot be negative for ${line.itemName}.`, 'error');
          return;
        }
        if (line.receivedQty > line.dispatchedQty) {
          showToast(
            `Received quantity cannot exceed dispatched quantity (${line.dispatchedQty}) for ${line.itemName}.`,
            'error'
          );
          return;
        }
        if (line.receivedQty < line.dispatchedQty && !line.discrepancyReason.trim()) {
          showToast(
            `Please specify a shortage reason for "${line.itemName}" (${line.dispatchedQty - line.receivedQty} ${line.unit} missing).`,
            'error'
          );
          return;
        }
      }

      setSubmittingReceive(true);
      const res = await receiveStockTransfer(detailedTransfer.id, {
        lines: receiveLines.map((l) => ({
          lineId: l.lineId,
          receivedQty: l.receivedQty,
          discrepancyReason: l.discrepancyReason.trim() || undefined,
        })),
      });

      showToast(res.message || 'Transfer received successfully!', 'success');
      setShowReceiveModal(false);
      handleViewTransferDetails(detailedTransfer.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to receive transfer', 'error');
    } finally {
      setSubmittingReceive(false);
    }
  };

  // Screen 5: Cancel Transfer
  const handleCancelTransfer = async () => {
    if (!detailedTransfer) return;
    if (!window.confirm(`Are you sure you want to cancel Transfer ${detailedTransfer.transferNumber}?`)) {
      return;
    }
    try {
      const res = await cancelStockTransfer(detailedTransfer.id, 'Cancelled from management console');
      showToast(res.message || 'Transfer cancelled successfully', 'info');
      handleViewTransferDetails(detailedTransfer.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel transfer', 'error');
    }
  };

  // Print Transfer Note
  const handlePrintTransferNote = () => {
    window.print();
  };

  // Helper for Status Badge Styling
  const renderStatusBadge = (status: StockTransferStatus) => {
    switch (status) {
      case 'completed':
      case 'received':
        return (
          <span
            style={{
              background: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ● Completed
          </span>
        );
      case 'in_transit':
        return (
          <span
            style={{
              background: '#dbeafe',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ● In Transit
          </span>
        );
      case 'partially_received':
        return (
          <span
            style={{
              background: '#fef3c7',
              color: '#b45309',
              border: '1px solid #fde68a',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ● Partially Received
          </span>
        );
      case 'approved':
        return (
          <span
            style={{
              background: '#f3e8ff',
              color: '#7e22ce',
              border: '1px solid #e9d5ff',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
            }}
          >
            ● Approved
          </span>
        );
      case 'cancelled':
      case 'rejected':
        return (
          <span
            style={{
              background: '#fee2e2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
            }}
          >
            ● {status === 'cancelled' ? 'Cancelled' : 'Rejected'}
          </span>
        );
      default:
        return (
          <span
            style={{
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.78rem',
              fontWeight: 700,
            }}
          >
            ● Draft
          </span>
        );
    }
  };

  const renderCreateStepper = (currentStep: 1 | 2 | 3) => {
    const steps = [
      { step: 1, title: 'Transfer Details', subtitle: 'Source & destination' },
      { step: 2, title: 'Add Items', subtitle: 'Quantities & stock' },
      { step: 3, title: 'Review & Confirm', subtitle: 'Summary & dispatch' },
    ];
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        {steps.map((s, idx) => {
          const isDone = s.step < currentStep;
          const isActive = s.step === currentStep;
          return (
            <React.Fragment key={s.step}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  cursor: isDone ? 'pointer' : 'default',
                  opacity: isActive || isDone ? 1 : 0.6,
                }}
                onClick={() => {
                  if (isDone) {
                    if (s.step === 1) setActiveView('create_step1');
                    if (s.step === 2) setActiveView('create_step2');
                  }
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: isDone ? '#16a34a' : isActive ? '#6366f1' : '#f1f5f9',
                    color: isDone || isActive ? '#ffffff' : '#64748b',
                    border: isActive ? '2px solid #818cf8' : isDone ? 'none' : '1px solid #cbd5e1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                    boxShadow: isActive ? '0 2px 8px rgba(99, 102, 241, 0.3)' : 'none',
                  }}
                >
                  {isDone ? '✓' : s.step}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '0.86rem',
                      fontWeight: isActive ? 700 : 600,
                      color: isActive ? '#0f172a' : isDone ? '#16a34a' : '#64748b',
                    }}
                  >
                    {s.title}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{s.subtitle}</div>
                </div>
              </div>

              {idx < steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: '2px',
                    margin: '0 1rem',
                    background: isDone ? '#16a34a' : '#e2e8f0',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="stock-transfer-module"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        padding: '0.5rem 0 2rem 0',
      }}
    >
      {/* =========================================================================
          SCREEN 1: STOCK TRANSFER – TRANSFER LIST
          ========================================================================= */}
      {activeView === 'list' && (
        <div
          className="card stock-transfer-list-card"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
            padding: '1.75rem',
          }}
        >
          {/* Header row with Module Icon, Title, Subtitle, and Primary Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
                  flexShrink: 0,
                }}
              >
                <TruckIcon size={22} />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: '1.3rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: 0,
                    letterSpacing: '-0.01em',
                  }}
                >
                  Stock Transfer – Transfer List
                </h2>
                <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: '2px' }}>
                  View and manage stock transfers between branches
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={loadTransfersList}
                title="Refresh transfer list"
                style={{
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  padding: '0.6rem 0.9rem',
                  borderRadius: '10px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#94a3b8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                <RefreshCwIcon size={14} className={loadingList ? 'spin' : ''} />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartCreateTransfer}
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
                  cursor: 'pointer',
                }}
              >
                <span>+</span> Create New Transfer
              </button>
            </div>
          </div>

          {/* Filters Toolbar */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'center',
              background: '#f8fafc',
              padding: '0.85rem 1rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              marginBottom: '1.25rem',
            }}
          >
            {/* Branch Filter */}
            <div style={{ flex: '0 1 180px', minWidth: '150px' }}>
              <select
                className="form-input"
                value={filterBranch}
                onChange={(e) => {
                  setFilterBranch(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  background: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '8px',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  width: '100%',
                  height: '38px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ALL">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div style={{ flex: '0 1 160px', minWidth: '135px' }}>
              <select
                className="form-input"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  background: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '8px',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  width: '100%',
                  height: '38px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="all">All Status</option>
                <option value="in_transit">In Transit</option>
                <option value="completed">Completed</option>
                <option value="partially_received">Partially Received</option>
                <option value="draft">Draft</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Date Range Filter Capsule */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0 0.6rem',
                height: '38px',
                boxSizing: 'border-box',
                flex: '0 0 auto',
                minWidth: '290px',
              }}
            >
              <CalendarIcon size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
              <input
                type="date"
                value={filterFromDate}
                onChange={(e) => {
                  setFilterFromDate(e.target.value);
                  setCurrentPage(1);
                }}
                title="From Date"
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.82rem',
                  color: filterFromDate ? '#1e293b' : '#64748b',
                  background: 'transparent',
                  padding: '0',
                  width: '125px',
                  cursor: 'pointer',
                }}
              />
              <span style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '0 2px' }}>–</span>
              <input
                type="date"
                value={filterToDate}
                onChange={(e) => {
                  setFilterToDate(e.target.value);
                  setCurrentPage(1);
                }}
                title="To Date"
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.82rem',
                  color: filterToDate ? '#1e293b' : '#64748b',
                  background: 'transparent',
                  padding: '0',
                  width: '125px',
                  cursor: 'pointer',
                }}
              />
            </div>

            {/* Search Input - flexible to take remaining space */}
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '200px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by transfer number..."
                value={filterSearch}
                onChange={(e) => {
                  setFilterSearch(e.target.value);
                  setCurrentPage(1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadTransfersList();
                }}
                style={{
                  background: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '8px',
                  padding: '0.45rem 2rem 0.45rem 2.2rem',
                  fontSize: '0.85rem',
                  width: '100%',
                  height: '38px',
                  boxSizing: 'border-box',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <SearchIcon size={14} />
              </span>
              {filterSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterSearch('');
                    setCurrentPage(1);
                  }}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Clear search"
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* Clear All Filters Button */}
            {(filterBranch !== 'ALL' ||
              filterStatus !== 'all' ||
              Boolean(filterFromDate) ||
              Boolean(filterToDate) ||
              Boolean(filterSearch.trim())) && (
              <button
                type="button"
                onClick={() => {
                  setFilterBranch('ALL');
                  setFilterStatus('all');
                  setFilterFromDate('');
                  setFilterToDate('');
                  setFilterSearch('');
                  setCurrentPage(1);
                }}
                style={{
                  height: '38px',
                  padding: '0 0.85rem',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#fee2e2';
                  e.currentTarget.style.color = '#b91c1c';
                  e.currentTarget.style.borderColor = '#fca5a5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f1f5f9';
                  e.currentTarget.style.color = '#475569';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                <XIcon size={13} />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Table Matching Reference Image */}
          <div style={{ overflowX: 'auto' }}>
            <table
              className="table"
              style={{
                width: '100%',
                borderCollapse: 'separate',
                borderSpacing: '0',
                fontSize: '0.86rem',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Transfer No.
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    From Branch
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    To Branch
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Date
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Status
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Items
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Created By
                  </th>
                  <th
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid #e2e8f0',
                      fontWeight: 700,
                      textAlign: 'right',
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingList ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                      <RefreshCwIcon size={24} className="spin" style={{ marginBottom: '8px' }} />
                      <div>Loading stock transfers...</div>
                    </td>
                  </tr>
                ) : transfers.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                      <PackageIcon size={36} style={{ color: '#cbd5e1', marginBottom: '8px' }} />
                      <div style={{ fontWeight: 600, color: '#475569' }}>No stock transfers found</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                        Click "+ Create New Transfer" above to initiate a branch transfer.
                      </div>
                    </td>
                  </tr>
                ) : (
                  transfers.map((trf) => (
                    <tr
                      key={trf.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                        {trf.transferNumber}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>
                        {trf.fromBranchName || trf.fromBranch}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#334155' }}>
                        {trf.toBranchName || trf.toBranch}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#64748b', fontSize: '0.82rem' }}>
                        {trf.transferDate}
                      </td>
                      <td style={{ padding: '0.9rem 1rem' }}>{renderStatusBadge(trf.status)}</td>
                      <td style={{ padding: '0.9rem 1rem', fontWeight: 600, color: '#0f172a' }}>
                        {trf.itemsCount || 0}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', color: '#475569' }}>
                        {trf.requestedByName || 'Staff'}
                      </td>
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <button
                            type="button"
                            onClick={() => handleViewTransferDetails(trf.id)}
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              padding: '0.35rem 0.75rem',
                              borderRadius: '6px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid #f1f5f9',
              fontSize: '0.82rem',
              color: '#64748b',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div>
              Showing {transfers.length > 0 ? (currentPage - 1) * 10 + 1 : 0} to{' '}
              {Math.min(currentPage * 10, totalTransfers)} of {totalTransfers} transfers
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: currentPage <= 1 ? 0.5 : 1,
                }}
              >
                &lt;
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                const isActive = pageNum === currentPage;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      background: isActive ? '#6366f1' : '#ffffff',
                      color: isActive ? '#ffffff' : '#334155',
                      border: isActive ? '1px solid #6366f1' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '0.3rem 0.65rem',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: currentPage >= totalPages ? 0.5 : 1,
                }}
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 2: CREATE STOCK TRANSFER – BASIC DETAILS (WIZARD STEP 1)
          ========================================================================= */}
      {activeView === 'create_step1' && (
        <div
          className="card create-transfer-card"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
            padding: '2rem',
            maxWidth: '850px',
            margin: '0 auto',
            width: '100%',
          }}
        >
          {/* Header Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setActiveView('list')}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '0.45rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#475569',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              ← Back to List
            </button>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Create New Stock Transfer
            </h3>
          </div>

          {/* Stepper Progress */}
          {renderCreateStepper(1)}

          {/* Form Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {/* Transfer Number */}
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                Transfer Number
              </label>
              <input
                type="text"
                className="form-input"
                value={nextTransferNumber}
                disabled
                style={{
                  background: '#f1f5f9',
                  color: '#64748b',
                  fontWeight: 700,
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0.65rem 0.85rem',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                Auto generated
              </span>
            </div>

            {/* From Branch */}
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                From Branch *
              </label>
              <select
                className="form-input"
                value={wizardFromBranch}
                onChange={(e) => {
                  const newFrom = e.target.value;
                  setWizardFromBranch(newFrom);
                  if (wizardToBranch === newFrom) {
                    const other = branches.find((b) => b.code !== newFrom)?.code || '';
                    setWizardToBranch(other);
                  }
                }}
                style={{
                  borderRadius: '8px',
                  borderColor: '#cbd5e1',
                  padding: '0.65rem 0.85rem',
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.code}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            {/* To Branch */}
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                To Branch *
              </label>
              <select
                className="form-input"
                value={wizardToBranch}
                onChange={(e) => setWizardToBranch(e.target.value)}
                style={{
                  borderRadius: '8px',
                  borderColor: '#cbd5e1',
                  padding: '0.65rem 0.85rem',
                }}
              >
                <option value="">-- Select Destination Branch --</option>
                {branches
                  .filter((b) => b.code !== wizardFromBranch)
                  .map((b) => (
                    <option key={b.id} value={b.code}>
                      {b.name} ({b.code})
                    </option>
                  ))}
              </select>
            </div>

            {/* Transfer Date */}
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                Transfer Date *
              </label>
              <input
                type="date"
                className="form-input"
                value={wizardTransferDate}
                onChange={(e) => setWizardTransferDate(e.target.value)}
                style={{
                  borderRadius: '8px',
                  borderColor: '#cbd5e1',
                  padding: '0.65rem 0.85rem',
                }}
              />
            </div>

            {/* Requested By */}
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                Requested By *
              </label>
              <input
                type="text"
                className="form-input"
                value={user.name}
                disabled
                style={{
                  background: '#f8fafc',
                  color: '#334155',
                  fontWeight: 600,
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0.65rem 0.85rem',
                }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155', margin: 0 }}>
                Notes (Optional)
              </label>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {wizardNotes.length}/500
              </span>
            </div>
            <textarea
              className="form-input"
              rows={3}
              maxLength={500}
              placeholder="Urgent stock requirement for destination branch..."
              value={wizardNotes}
              onChange={(e) => setWizardNotes(e.target.value)}
              style={{
                borderRadius: '8px',
                borderColor: '#cbd5e1',
                padding: '0.75rem',
                width: '100%',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Footer Action */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStep1Next}
              style={{
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                padding: '0.7rem 1.75rem',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '0.92rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
              }}
            >
              Next: Add Products →
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 3: ADD PRODUCTS – TRANSFER ITEMS (WIZARD STEP 2)
          ========================================================================= */}
      {activeView === 'create_step2' && (
        <div
          className="card add-products-card"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
            padding: '2rem',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setActiveView('create_step1')}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '0.45rem 0.8rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Add Products – Transfer Items
              </h3>
            </div>

            <div
              style={{
                fontSize: '0.85rem',
                background: '#ede9fe',
                color: '#5b21b6',
                padding: '0.4rem 0.85rem',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              Source Branch: <strong>{wizardFromBranch}</strong> → Target: <strong>{wizardToBranch}</strong>
            </div>
          </div>

          {/* Stepper Progress */}
          {renderCreateStepper(2)}

          {/* Product Search Input with Barcode Icon */}
          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search products by name, SKU or barcode..."
                value={productSearchQuery}
                onFocus={() => setShowProductDropdown(true)}
                onChange={(e) => {
                  setProductSearchQuery(e.target.value);
                  setShowProductDropdown(true);
                }}
                style={{
                  borderRadius: '10px',
                  borderColor: '#cbd5e1',
                  padding: '0.75rem 3rem 0.75rem 2.5rem',
                  fontSize: '0.92rem',
                  width: '100%',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              >
                <SearchIcon size={18} />
              </span>
              <button
                type="button"
                title="Barcode scanner"
                onClick={() => {
                  showToast('Barcode scanner ready. Focus search bar to scan item.', 'info');
                }}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                |||| Barcode
              </button>
            </div>

            {/* Dropdown Results */}
            {showProductDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  zIndex: 50,
                  marginTop: '4px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.85rem',
                    background: '#f8fafc',
                    borderBottom: '1px solid #f1f5f9',
                    fontSize: '0.78rem',
                    color: '#64748b',
                  }}
                >
                  <span>Select Product to Add</span>
                  <span
                    onClick={() => setShowProductDropdown(false)}
                    style={{ cursor: 'pointer', fontWeight: 600, color: '#ef4444' }}
                  >
                    Close ✕
                  </span>
                </div>
                {loadingProducts ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                    Loading products...
                  </div>
                ) : branchProducts.length === 0 ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    No products found matching "{productSearchQuery}"
                  </div>
                ) : (
                  branchProducts.map((p) => {
                    const isAlreadyAdded = wizardLines.some((l) => l.itemId === p.id);
                    const stock = p.availableStockUnits;
                    return (
                      <div
                        key={p.id}
                        onClick={() => !isAlreadyAdded && handleAddProductToTransfer(p)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.65rem 0.85rem',
                          borderBottom: '1px solid #f8fafc',
                          cursor: isAlreadyAdded ? 'not-allowed' : 'pointer',
                          background: isAlreadyAdded ? '#f8fafc' : '#ffffff',
                          opacity: isAlreadyAdded ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!isAlreadyAdded) e.currentTarget.style.background = '#f1f5f9';
                        }}
                        onMouseLeave={(e) => {
                          if (!isAlreadyAdded) e.currentTarget.style.background = '#ffffff';
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                            SKU: {p.sku || 'N/A'} {p.barcode ? `• Barcode: ${p.barcode}` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: stock > 0 ? '#15803d' : '#b91c1c',
                              background: stock > 0 ? '#dcfce7' : '#fee2e2',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '6px',
                            }}
                          >
                            Stock: {stock} {p.unit}
                          </span>
                          {isAlreadyAdded && (
                            <div style={{ fontSize: '0.72rem', color: '#6366f1', marginTop: '2px' }}>
                              ✓ Added
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Table of Added Items Matching Screen 3 */}
          <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
            <table
              className="table"
              style={{
                width: '100%',
                borderCollapse: 'separate',
                borderSpacing: '0',
                fontSize: '0.88rem',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Product
                  </th>
                  <th
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid #e2e8f0',
                      fontWeight: 700,
                      textAlign: 'center',
                    }}
                  >
                    Available Stock ({wizardFromBranch})
                  </th>
                  <th
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid #e2e8f0',
                      fontWeight: 700,
                      textAlign: 'center',
                      width: '160px',
                    }}
                  >
                    Transfer Qty *
                  </th>
                  <th style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                    Unit
                  </th>
                  <th
                    style={{
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid #e2e8f0',
                      fontWeight: 700,
                      textAlign: 'center',
                      width: '80px',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {wizardLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                      <PackageIcon size={32} style={{ color: '#cbd5e1', marginBottom: '6px' }} />
                      <div>No products added yet.</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                        Type a product name, SKU or barcode in the search bar above to add.
                      </div>
                    </td>
                  </tr>
                ) : (
                  wizardLines.map((line) => {
                    const maxStock = line.availableStockMilli / 1000;
                    const hasError = line.transferQty <= 0 || line.transferQty > maxStock;
                    return (
                      <tr key={line.itemId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '8px',
                                background: '#f1f5f9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#6366f1',
                              }}
                            >
                              <PackageIcon size={18} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: '#1e293b' }}>{line.name}</div>
                              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                SKU: {line.sku} {line.barcode ? `• ${line.barcode}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'center', fontWeight: 600, color: '#334155' }}>
                          {maxStock}
                        </td>
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0.001"
                            max={maxStock}
                            step="any"
                            className="form-input"
                            value={line.transferQty === 0 ? '' : line.transferQty}
                            onChange={(e) => handleUpdateLineQty(line.itemId, parseFloat(e.target.value))}
                            style={{
                              width: '100%',
                              textAlign: 'center',
                              borderRadius: '8px',
                              fontWeight: 700,
                              borderColor: hasError ? '#ef4444' : '#cbd5e1',
                              background: hasError ? '#fef2f2' : '#ffffff',
                              color: hasError ? '#b91c1c' : '#0f172a',
                            }}
                          />
                          {line.transferQty > maxStock && (
                            <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '2px' }}>
                              Exceeds stock ({maxStock})
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 500 }}>
                          {line.unit}
                        </td>
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.itemId)}
                            title="Remove product"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '0.35rem',
                              borderRadius: '6px',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                          >
                            <Trash2Icon size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '1rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.92rem' }}>
              Total Items: <span style={{ color: '#6366f1' }}>{wizardLines.length}</span>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveView('create_step1')}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '0.65rem 1.25rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={wizardLines.length === 0}
                onClick={handleStep2Next}
                style={{
                  background: wizardLines.length === 0 ? '#94a3b8' : '#6366f1',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.65rem 1.5rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: wizardLines.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Next: Review →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 4: REVIEW & CONFIRM (WIZARD STEP 3)
          ========================================================================= */}
      {activeView === 'create_step3' && (
        <div
          className="card review-transfer-card"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
            padding: '2rem',
            maxWidth: '900px',
            margin: '0 auto',
            width: '100%',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setActiveView('create_step2')}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '0.45rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#475569',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Review &amp; Confirm Transfer
            </h3>
          </div>

          {/* Stepper Progress */}
          {renderCreateStepper(3)}

          {/* Transfer Summary Box */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.25rem',
              marginBottom: '1.75rem',
            }}
          >
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 700, color: '#334155' }}>
              Transfer Summary
            </h4>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1rem',
                fontSize: '0.86rem',
              }}
            >
              <div>
                <span style={{ color: '#64748b' }}>Transfer Number</span>
                <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {nextTransferNumber}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>From Branch</span>
                <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {branches.find((b) => b.code === wizardFromBranch)?.name || wizardFromBranch}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>To Branch</span>
                <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {branches.find((b) => b.code === wizardToBranch)?.name || wizardToBranch}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Transfer Date</span>
                <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {wizardTransferDate}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Requested By</span>
                <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {user.name}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Notes</span>
                <div style={{ fontWeight: 500, color: '#334155', marginTop: '2px' }}>
                  {wizardNotes || 'None'}
                </div>
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div style={{ marginBottom: '1.75rem' }}>
            <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', fontWeight: 700, color: '#334155' }}>
              Items ({wizardLines.length})
            </h4>
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                      Product
                    </th>
                    <th
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid #e2e8f0',
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                    >
                      Qty
                    </th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>
                      Unit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {wizardLines.map((l) => (
                    <tr key={l.itemId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#1e293b' }}>
                        {l.name}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                        {l.transferQty}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{l.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Buttons: Cancel, Previous, Confirm Transfer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveView('list')}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0.65rem 1.25rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveView('create_step2')}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0.65rem 1.25rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submittingCreate}
              onClick={handleConfirmTransfer}
              style={{
                background: submittingCreate ? '#94a3b8' : '#6366f1',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.65rem 1.75rem',
                fontWeight: 700,
                cursor: submittingCreate ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
              }}
            >
              {submittingCreate ? 'Saving Transfer...' : 'Confirm Transfer'}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          SCREEN 5 & SCREEN 6: TRANSFER DETAILS, STATUS TRACKING & STOCK MOVEMENTS
          ========================================================================= */}
      {activeView === 'details' && detailedTransfer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* SCREEN 5 CARD: Transfer Details & Status Tracking */}
          <div
            className="card transfer-details-card"
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
              padding: '1.75rem',
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.25rem',
                paddingBottom: '1rem',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <button
                  type="button"
                  onClick={() => setActiveView('list')}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: '#e0e7ff',
                        color: '#4338ca',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid #c7d2fe',
                        flexShrink: 0,
                      }}
                    >
                      <FileTextIcon size={18} />
                    </div>
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                      Transfer Details – {detailedTransfer.transferNumber}
                    </h3>
                    {renderStatusBadge(detailedTransfer.status)}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '3px' }}>
                    Route: <strong style={{ color: '#1e293b' }}>{detailedTransfer.fromBranchName}</strong>{' '}
                    → <strong style={{ color: '#1e293b' }}>{detailedTransfer.toBranchName}</strong>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handlePrintTransferNote}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                    padding: '0.5rem 0.95rem',
                    borderRadius: '8px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                  }}
                >
                  <PrinterIcon size={16} /> Print Transfer Note
                </button>

                {/* Dispatch Button (allowed when draft/requested) */}
                {['draft', 'requested', 'approved'].includes(detailedTransfer.status) && (
                  <button
                    type="button"
                    onClick={() => setShowDispatchModal(true)}
                    style={{
                      background: '#6366f1',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.5rem 1.15rem',
                      borderRadius: '8px',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                    }}
                  >
                    <TruckIcon size={16} /> Dispatch Stock
                  </button>
                )}

                {/* Receive Button (allowed when in_transit or partially_received) */}
                {['in_transit', 'partially_received'].includes(detailedTransfer.status) && (
                  (() => {
                    const isDestinationStaff = user?.assignedLocation === detailedTransfer.toBranch;
                    const isSourceStaff = user?.assignedLocation === detailedTransfer.fromBranch;
                    const isOwner = user?.role === 'owner';

                    if (isSourceStaff && !isOwner) {
                      // Source branch manager/cashier sent the goods: they must wait for destination branch to receive
                      return (
                        <div
                          style={{
                            padding: '0.5rem 0.95rem',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '8px',
                            fontSize: '0.82rem',
                            color: '#1e40af',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <TruckIcon size={16} /> In Transit – Awaiting receipt by {detailedTransfer.toBranchName}
                        </div>
                      );
                    }

                    if (isDestinationStaff) {
                      // Destination branch manager/cashier who is receiving the stock
                      return (
                        <button
                          type="button"
                          onClick={handleOpenReceiveModal}
                          style={{
                            background: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '0.5rem 1.15rem',
                            borderRadius: '8px',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
                          }}
                        >
                          <CheckCircleIcon size={16} /> Receive Stock
                        </button>
                      );
                    }

                    // Owner / Super Admin: show status + explicit action for destination branch
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div
                          style={{
                            padding: '0.45rem 0.85rem',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            color: '#1e40af',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <TruckIcon size={16} /> In Transit to {detailedTransfer.toBranchName}
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenReceiveModal}
                          style={{
                            background: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '0.5rem 1.15rem',
                            borderRadius: '8px',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
                          }}
                        >
                          <CheckCircleIcon size={16} /> Receive at {detailedTransfer.toBranchName}
                        </button>
                      </div>
                    );
                  })()
                )}

                {/* Cancel Button */}
                {['draft', 'requested'].includes(detailedTransfer.status) && (
                  <button
                    type="button"
                    onClick={handleCancelTransfer}
                    style={{
                      background: '#fee2e2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel Transfer
                  </button>
                )}
              </div>
            </div>

            {/* Meta Pills Row Matching Reference Screen 5 */}
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '1.5rem',
              }}
            >
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.65rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  flex: '1 1 200px',
                }}
              >
                <CalendarIcon size={18} style={{ color: '#6366f1' }} />
                <div>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>
                    {detailedTransfer.transferDate}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Transfer Date</div>
                </div>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.65rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  flex: '1 1 200px',
                }}
              >
                <UserIcon size={18} style={{ color: '#6366f1' }} />
                <div>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>
                    {detailedTransfer.requestedByName}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Requested By</div>
                </div>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.65rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  flex: '2 1 300px',
                }}
              >
                <FileTextIcon size={18} style={{ color: '#6366f1' }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.88rem' }}>
                    {detailedTransfer.notes || 'Urgent stock requirement for destination branch.'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Notes</div>
                </div>
              </div>
            </div>

            {/* Split View: Left (Items / Activity Tabs) & Right (Status Tracker Timeline) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
              {/* Left Column: Tabs */}
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <button
                    type="button"
                    onClick={() => setDetailsTab('items')}
                    style={{
                      background: detailsTab === 'items' ? '#6366f1' : '#f1f5f9',
                      color: detailsTab === 'items' ? '#ffffff' : '#475569',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.45rem 1.15rem',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailsTab('activity')}
                    style={{
                      background: detailsTab === 'activity' ? '#6366f1' : '#f1f5f9',
                      color: detailsTab === 'activity' ? '#ffffff' : '#475569',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.45rem 1.15rem',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    Activity Log
                  </button>
                </div>

                {detailsTab === 'items' ? (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                    <table
                      className="table"
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.86rem',
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0' }}>Product</th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                            Qty
                          </th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0' }}>Unit</th>
                          <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailedLines.map((l) => (
                          <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{l.itemName}</div>
                              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                                SKU: {l.itemSku || 'N/A'}
                              </div>
                              {l.discrepancyMilli > 0 && (
                                <div
                                  style={{
                                    fontSize: '0.76rem',
                                    color: '#b45309',
                                    background: '#fef3c7',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    marginTop: '4px',
                                  }}
                                >
                                  Shortage: {l.discrepancyMilli / 1000} {l.unit} • Reason: {l.discrepancyReason}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700 }}>
                              {l.qtyMilli / 1000}
                              {l.receivedQtyMilli > 0 && l.receivedQtyMilli !== l.qtyMilli && (
                                <span style={{ fontSize: '0.75rem', color: '#16a34a', display: 'block' }}>
                                  ({l.receivedQtyMilli / 1000} rec)
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{l.unit}</td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              {detailedTransfer.status === 'completed' ? (
                                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.8rem' }}>Received</span>
                              ) : detailedTransfer.status === 'in_transit' ? (
                                <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.8rem' }}>In Transit</span>
                              ) : (
                                <span style={{ color: '#d97706', fontWeight: 600, fontSize: '0.8rem' }}>Pending</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '1rem',
                      background: '#f8fafc',
                    }}
                  >
                    {detailedActivityLog.length === 0 ? (
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No activity records found.</div>
                    ) : (
                      detailedActivityLog.map((log, idx) => (
                        <div
                          key={log.id || idx}
                          style={{
                            display: 'flex',
                            gap: '0.75rem',
                            paddingBottom: '0.75rem',
                            marginBottom: '0.75rem',
                            borderBottom: idx < detailedActivityLog.length - 1 ? '1px solid #e2e8f0' : 'none',
                            fontSize: '0.84rem',
                          }}
                        >
                          <ClockIcon size={16} style={{ color: '#6366f1', marginTop: '2px' }} />
                          <div>
                            <div style={{ fontWeight: 600, color: '#1e293b' }}>
                              {log.action.replace('stock_transfer.', '').toUpperCase()} by {log.user_name || 'User'}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                              {new Date(log.created_at).toLocaleString('en-IN')}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Timeline Tracker Matching Reference Screen 5 */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1.25rem',
                }}
              >
                <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.92rem', fontWeight: 700, color: '#1e293b' }}>
                  Current Status
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
                  {/* Step 1: Transfer Created */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: '#16a34a',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                        Transfer Created
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {new Date(detailedTransfer.createdAt).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* Step 2: In Transit */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: detailedTransfer.dispatchedAt ? '#16a34a' : (detailedTransfer.status === 'in_transit' ? '#2563eb' : '#cbd5e1'),
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {detailedTransfer.dispatchedAt ? '✓' : '●'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                        In Transit
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {detailedTransfer.dispatchedAt
                          ? `Dispatched ${new Date(detailedTransfer.dispatchedAt).toLocaleString('en-IN')}`
                          : 'Awaiting dispatch at source branch'}
                      </div>
                    </div>
                  </div>

                  {/* Step 3: Received at Target Branch */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: detailedTransfer.receivedAt ? '#16a34a' : '#cbd5e1',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {detailedTransfer.receivedAt ? '✓' : '○'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                        Received at Target Branch
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {detailedTransfer.receivedAt
                          ? `Received ${new Date(detailedTransfer.receivedAt).toLocaleString('en-IN')}`
                          : 'Pending receipt at destination'}
                      </div>
                    </div>
                  </div>

                  {/* Step 4: Stock Updated */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: detailedTransfer.receivedAt ? '#16a34a' : '#cbd5e1',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {detailedTransfer.receivedAt ? '✓' : '○'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                        Stock Updated
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Ledger synchronized
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Completed */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: detailedTransfer.status === 'completed' ? '#16a34a' : '#cbd5e1',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {detailedTransfer.status === 'completed' ? '✓' : '○'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                        Completed
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {detailedTransfer.status === 'completed'
                          ? 'Transfer cycle finalized'
                          : detailedTransfer.status === 'partially_received'
                          ? 'Partially received with shortage'
                          : 'Pending steps'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =========================================================================
              SCREEN 6: AUTOMATIC STOCK MOVEMENT RECORDS (TWO GREEN PANELS)
              ========================================================================= */}
          <div
            className="card stock-movements-card"
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
              padding: '1.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: '#ecfdf5',
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #a7f3d0',
                  flexShrink: 0,
                }}
              >
                <PackageIcon size={18} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Stock Movement – Automatic Records
              </h3>
            </div>
            <div style={{ fontSize: '0.84rem', color: '#64748b', marginBottom: '1.5rem', marginLeft: '44px' }}>
              For each transfer, stock movements are recorded in both branches.
            </div>

            {/* Two Side-by-Side Panels */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '1.5rem',
              }}
            >
              {/* Panel 1: Source Branch – Stock Reduce */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #86efac',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  boxShadow: '0 2px 10px rgba(34, 197, 94, 0.08)',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: '#15803d',
                    fontSize: '0.95rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  Source Branch – {detailedTransfer.fromBranchName} (Stock Reduce)
                </div>

                <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                    <thead>
                      <tr style={{ background: '#f0fdf4', color: '#166534', textAlign: 'left' }}>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Product</th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7', textAlign: 'center' }}>
                          Qty
                        </th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Type</th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailedMoves.source.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                            {detailedTransfer.status === 'draft' || detailedTransfer.status === 'requested'
                              ? 'Pending dispatch. Stock moves will generate upon dispatch.'
                              : 'No source stock movements.'}
                          </td>
                        </tr>
                      ) : (
                        detailedMoves.source.map((m) => (
                          <tr key={m.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, color: '#1e293b' }}>
                              {m.itemName}
                            </td>
                            <td
                              style={{
                                padding: '0.6rem 0.8rem',
                                textAlign: 'center',
                                fontWeight: 700,
                                color: '#b91c1c',
                              }}
                            >
                              -{Math.abs(m.qtyMilli / 1000)}
                            </td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#475569' }}>
                              Transfer Out
                            </td>
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, color: '#334155' }}>
                              {detailedTransfer.transferNumber}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Info banner */}
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    color: '#1d4ed8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>ⓘ</span>
                  <span>
                    Stock is reduced from source branch only after dispatch (or when transfer is marked as 'Dispatched').
                  </span>
                </div>
              </div>

              {/* Panel 2: Destination Branch – Stock Increase */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #86efac',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  boxShadow: '0 2px 10px rgba(34, 197, 94, 0.08)',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: '#15803d',
                    fontSize: '0.95rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  Destination Branch – {detailedTransfer.toBranchName} (Stock Increase)
                </div>

                <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                    <thead>
                      <tr style={{ background: '#f0fdf4', color: '#166534', textAlign: 'left' }}>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Product</th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7', textAlign: 'center' }}>
                          Qty
                        </th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Type</th>
                        <th style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #dcfce7' }}>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailedMoves.destination.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                            {detailedTransfer.status === 'completed' || detailedTransfer.status === 'partially_received'
                              ? 'No destination stock movements recorded.'
                              : 'Pending destination receipt. Stock moves will generate upon receiving.'}
                          </td>
                        </tr>
                      ) : (
                        detailedMoves.destination.map((m) => (
                          <tr key={m.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, color: '#1e293b' }}>
                              {m.itemName}
                            </td>
                            <td
                              style={{
                                padding: '0.6rem 0.8rem',
                                textAlign: 'center',
                                fontWeight: 700,
                                color: '#16a34a',
                              }}
                            >
                              +{Math.abs(m.qtyMilli / 1000)}
                            </td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#475569' }}>
                              Transfer In
                            </td>
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, color: '#334155' }}>
                              {detailedTransfer.transferNumber}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Info banner */}
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>✓</span>
                  <span>
                    Stock is added to destination branch only after receiving and confirming the transfer.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DISPATCH CONFIRMATION MODAL
          ========================================================================= */}
      {showDispatchModal && detailedTransfer && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }}>
          <div className="modal-card" style={{ maxWidth: '500px', padding: '1.75rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.2rem' }}>
              Confirm Stock Dispatch
            </h3>
            <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: '1.5', margin: '0 0 1.25rem 0' }}>
              Are you sure you want to dispatch Transfer{' '}
              <strong style={{ color: '#0f172a' }}>{detailedTransfer.transferNumber}</strong> from{' '}
              <strong>{detailedTransfer.fromBranchName}</strong>?
              <br />
              <br />
              <span style={{ color: '#2563eb' }}>
                Stock will be permanently deducted from {detailedTransfer.fromBranchName} and marked in transit.
              </span>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submittingDispatch}
                onClick={() => setShowDispatchModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submittingDispatch}
                onClick={handleConfirmDispatch}
                style={{ background: '#6366f1' }}
              >
                {submittingDispatch ? 'Dispatching...' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          RECEIVE STOCK MODAL (FULL / PARTIAL WITH DISCREPANCY REASONS)
          ========================================================================= */}
      {showReceiveModal && detailedTransfer && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }}>
          <div className="modal-card" style={{ maxWidth: '750px', padding: '1.75rem', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.2rem' }}>
                Receive Stock – {detailedTransfer.transferNumber}
              </h3>
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <XIcon size={20} />
              </button>
            </div>

            <p style={{ color: '#64748b', fontSize: '0.84rem', margin: '0 0 1.25rem 0' }}>
              Verify quantities received at <strong>{detailedTransfer.toBranchName}</strong>. If fewer items were received,
              specify a discrepancy reason for inventory shortage audits.
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '1.5rem', maxHeight: '350px' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '0.6rem 0.8rem' }}>Product</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>Dispatched</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'center', width: '130px' }}>Received Qty</th>
                    <th style={{ padding: '0.6rem 0.8rem' }}>Shortage / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {receiveLines.map((line, idx) => {
                    const shortage = line.dispatchedQty - line.receivedQty;
                    const hasShortage = shortage > 0;
                    return (
                      <tr key={line.lineId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600 }}>{line.itemName}</td>
                        <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center', color: '#64748b' }}>
                          {line.dispatchedQty} {line.unit}
                        </td>
                        <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max={line.dispatchedQty}
                            step="any"
                            className="form-input"
                            value={line.receivedQty}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setReceiveLines((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, receivedQty: val } : item))
                              );
                            }}
                            style={{ width: '100%', textAlign: 'center', fontWeight: 700 }}
                          />
                        </td>
                        <td style={{ padding: '0.6rem 0.8rem' }}>
                          {hasShortage ? (
                            <div>
                              <span
                                style={{
                                  fontSize: '0.74rem',
                                  color: '#dc2626',
                                  fontWeight: 700,
                                  display: 'block',
                                  marginBottom: '3px',
                                }}
                              >
                                Shortage: {shortage} {line.unit}
                              </span>
                              <input
                                type="text"
                                className="form-input"
                                placeholder="Reason (e.g. Broken in transit)"
                                value={line.discrepancyReason}
                                onChange={(e) => {
                                  const rText = e.target.value;
                                  setReceiveLines((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, discrepancyReason: rText } : item
                                    )
                                  );
                                }}
                                style={{ fontSize: '0.8rem', width: '100%' }}
                              />
                            </div>
                          ) : (
                            <span style={{ color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>
                              ✓ Complete
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submittingReceive}
                onClick={() => setShowReceiveModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submittingReceive}
                onClick={handleSubmitReceipt}
                style={{ background: '#16a34a' }}
              >
                {submittingReceive ? 'Processing Receipt...' : 'Confirm Stock Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
