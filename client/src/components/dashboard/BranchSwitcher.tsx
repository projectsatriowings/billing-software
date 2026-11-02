import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { User } from '../../api.ts';
import './BranchSwitcher.css';

export interface BranchSwitcherItem {
  id: string;
  code: string;
  name: string;
  active?: boolean;
  counters?: string[];
  address?: string | null;
  city?: string;
}

export interface BranchSwitcherProps {
  branches: BranchSwitcherItem[];
  selectedBranchCode: string;
  onSelectBranch: (branchCode: string) => void;
  user: User;
  onManageBranches?: () => void;
}

const PINNED_STORAGE_KEY = 'sa_pinned_branches';

export const ALL_BRANCHES_ITEM: BranchSwitcherItem = {
  id: 'all',
  code: 'all',
  name: 'All branches (overall)',
  active: true,
};

/**
 * Intelligent city extractor:
 * Checks branch.city -> branch.address -> well-known Indian cities/localities in branch name/code.
 */
export function extractCity(branch: BranchSwitcherItem): string {
  if (branch.code === 'all') return 'Overall';
  if (branch.city && branch.city.trim()) {
    return branch.city.trim();
  }

  if (branch.address && branch.address.trim()) {
    const rawParts = branch.address
      .split(',')
      .map((p) => p.replace(/\b\d{6}\b/g, '').replace(/[-–—]/g, '').trim())
      .filter((p) => p.length > 0);
    if (rawParts.length > 0) {
      const last = rawParts[rawParts.length - 1];
      if (/^(tamil nadu|karnataka|kerala|andhra|telangana|india)$/i.test(last) && rawParts.length > 1) {
        return rawParts[rawParts.length - 2];
      }
      return last;
    }
  }

  const name = branch.name || '';
  const code = branch.code || '';

  const knownCities = [
    'Chennai', 'Coimbatore', 'Madurai', 'Trichy', 'Tiruchirappalli', 'Salem',
    'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Bengaluru', 'Bangalore',
    'Mysuru', 'Hyderabad', 'Kochi', 'Thiruvananthapuram', 'Mumbai', 'Pune',
    'Delhi', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow'
  ];
  for (const c of knownCities) {
    const re = new RegExp(`\\b${c}\\b`, 'i');
    if (re.test(name) || re.test(code)) {
      return c === 'Bangalore' ? 'Bengaluru' : c === 'Tiruchirappalli' ? 'Trichy' : c;
    }
  }

  // Known Chennai localities
  if (/porur|t[\s._-]?nagar|anna\s*nagar|adyar|velachery|tambaram|guindy|mylapore|alwarpet|nungambakkam|vadapalani|kodambakkam/i.test(name) || /porur|tng|tnagar/i.test(code)) {
    return 'Chennai';
  }

  // Check dashed suffix, e.g. "Store - RS Puram"
  const dashMatch = name.split(/[-–—]/);
  if (dashMatch.length > 1) {
    const candidate = dashMatch[dashMatch.length - 1].trim();
    if (candidate && candidate.length > 2 && candidate.length < 25) {
      return candidate;
    }
  }

  if (/main|hq|headquarters|central/i.test(name) || /main|hq/i.test(code)) {
    return 'Chennai';
  }

  return 'Other';
}

// Inline SVG Icons
const StoreIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
    <path d="M2 7h20" />
    <path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7" />
  </svg>
);

const ChevronDownIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const SearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const XIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PinIcon: React.FC<{ size?: number; filled?: boolean; className?: string }> = ({
  size = 13,
  filled = false,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
  </svg>
);

const CheckIcon: React.FC<{ size?: number; className?: string }> = ({ size = 15, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const BranchSwitcher: React.FC<BranchSwitcherProps> = ({
  branches,
  selectedBranchCode,
  onSelectBranch,
  user: _user,
  onManageBranches,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // 1. Load pinned branches from localStorage (with fallback to Main/HQ branch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setPinnedIds(parsed);
          return;
        }
      }
    } catch {
      // ignore JSON parse error
    }

    // Fallback: If none pinned yet, default to MAIN or first branch
    if (branches && branches.length > 0) {
      const main =
        branches.find((b) => (b.code || '').toUpperCase() === 'MAIN') ||
        branches.find((b) => /main|hq|central/i.test(b.name || '')) ||
        branches[0];
      if (main) {
        setPinnedIds([main.id || main.code]);
      }
    }
  }, [branches]);

  const togglePin = useCallback((branchKey: string) => {
    if (branchKey === 'all') return;
    setPinnedIds((prev) => {
      let next: string[];
      if (prev.includes(branchKey)) {
        next = prev.filter((id) => id !== branchKey);
      } else {
        next = [...prev, branchKey];
      }
      try {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage write error fallback
      }
      return next;
    });
  }, []);

  const isBranchPinned = useCallback(
    (b: BranchSwitcherItem) => {
      if (b.code === 'all') return false;
      const key1 = b.id;
      const key2 = b.code;
      return (Boolean(key1) && pinnedIds.includes(key1)) || (Boolean(key2) && pinnedIds.includes(key2));
    },
    [pinnedIds]
  );

  // 2. Identify currently selected branch for display
  const isSelectedAll = (selectedBranchCode || '').toLowerCase() === 'all';
  const currentBranch = useMemo(() => {
    if (isSelectedAll) return ALL_BRANCHES_ITEM;
    const sel = (selectedBranchCode || '').toUpperCase();
    return branches.find((b) => (b.code || '').toUpperCase() === sel) || ALL_BRANCHES_ITEM;
  }, [branches, selectedBranchCode, isSelectedAll]);

  const currentBranchName = currentBranch.name || currentBranch.code;

  // 3. Filter branches according to search input
  const q = searchQuery.trim().toLowerCase();
  const matchesAll = useMemo(() => {
    if (!q) return true;
    return 'all branches (overall)'.includes(q) || 'overall'.includes(q);
  }, [q]);

  const filteredBranches = useMemo(() => {
    if (!q) return branches;
    return branches.filter((b) => {
      const nameMatch = (b.name || '').toLowerCase().includes(q);
      const codeMatch = (b.code || '').toLowerCase().includes(q);
      const cityMatch = extractCity(b).toLowerCase().includes(q);
      return nameMatch || codeMatch || cityMatch;
    });
  }, [branches, q]);

  // 4. Split into Pinned and Remaining (Grouped by City)
  const { pinnedBranches, cityGroups, navigableList } = useMemo(() => {
    const pinned: BranchSwitcherItem[] = [];
    const remaining: BranchSwitcherItem[] = [];

    for (const b of filteredBranches) {
      if (b.code === 'all') continue;
      if (isBranchPinned(b)) {
        pinned.push(b);
      } else {
        remaining.push(b);
      }
    }

    // Group remaining branches by city
    const groups: { [city: string]: BranchSwitcherItem[] } = {};
    for (const b of remaining) {
      const city = extractCity(b);
      if (!groups[city]) groups[city] = [];
      groups[city].push(b);
    }

    // Sort cities alphabetically
    const sortedCities = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const sortedCityGroups: Array<{ city: string; branches: BranchSwitcherItem[] }> = [];

    const navList: BranchSwitcherItem[] = [];
    if (matchesAll) {
      navList.push(ALL_BRANCHES_ITEM);
    }
    navList.push(...pinned);

    for (const city of sortedCities) {
      const sortedInCity = groups[city].slice().sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code));
      sortedCityGroups.push({ city, branches: sortedInCity });
      navList.push(...sortedInCity);
    }

    return {
      pinnedBranches: pinned,
      cityGroups: sortedCityGroups,
      navigableList: navList,
    };
  }, [filteredBranches, isBranchPinned, matchesAll]);

  // 5. Open / Close helpers
  const handleOpen = () => {
    setIsOpen(true);
    setSearchQuery('');
    // Highlight currently active branch
    const idx = navigableList.findIndex(
      (b) => (b.code || '').toLowerCase() === (selectedBranchCode || '').toLowerCase()
    );
    setHighlightedIndex(idx >= 0 ? idx : 0);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 40);
  };

  const handleClose = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const toggleDropdown = () => {
    if (isOpen) {
      handleClose();
    } else {
      handleOpen();
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation inside dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
      return;
    }

    if (navigableList.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (highlightedIndex + 1) % navigableList.length;
      setHighlightedIndex(nextIdx);
      const target = navigableList[nextIdx];
      const targetKey = target.id || target.code;
      optionRefs.current[targetKey]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (highlightedIndex - 1 + navigableList.length) % navigableList.length;
      setHighlightedIndex(prevIdx);
      const target = navigableList[prevIdx];
      const targetKey = target.id || target.code;
      optionRefs.current[targetKey]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = navigableList[highlightedIndex];
      if (selected) {
        onSelectBranch(selected.code);
        handleClose();
      }
    }
  };

  const handleSelectBranch = (branch: BranchSwitcherItem) => {
    onSelectBranch(branch.code);
    handleClose();
  };

  const handleManageBranches = () => {
    setIsOpen(false);
    if (onManageBranches) {
      onManageBranches();
    } else {
      window.location.hash = '#user-management';
    }
  };

  const renderBranchOption = (branch: BranchSwitcherItem, globalIndex: number) => {
    const isSelected = (branch.code || '').toLowerCase() === (selectedBranchCode || '').toLowerCase();
    const isHighlighted = highlightedIndex === globalIndex;
    const isPinned = isBranchPinned(branch);
    const branchKey = branch.id || branch.code;
    const isOverall = branch.code === 'all';
    const city = isOverall ? 'Company Overall' : extractCity(branch);

    return (
      <div
        key={branchKey}
        ref={(el) => {
          optionRefs.current[branchKey] = el;
        }}
        role="option"
        aria-selected={isSelected}
        className={`branch-switcher-option ${isSelected ? 'is-selected' : ''} ${
          isHighlighted ? 'is-highlighted' : ''
        } ${isOverall ? 'is-overall-option' : ''}`}
        onClick={() => handleSelectBranch(branch)}
        onMouseEnter={() => setHighlightedIndex(globalIndex)}
        title={`Select ${branch.name || branch.code}`}
      >
        <div className="branch-switcher-option-main">
          <span
            className={`branch-switcher-status-dot ${isOverall ? 'active' : branch.active !== false ? 'active' : ''}`}
            title={isOverall ? 'Company All Branches' : branch.active !== false ? 'Active & Live' : 'Inactive'}
          />
          <div className="branch-switcher-option-text">
            <span className="branch-switcher-option-name">{branch.name || branch.code}</span>
            <span className="branch-switcher-option-sub">
              {isOverall ? 'Sum of all branches' : `${branch.code}${city ? ` · ${city}` : ''}`}
            </span>
          </div>
        </div>

        <div className="branch-switcher-option-actions">
          {!isOverall && (
            <button
              type="button"
              className={`branch-switcher-pin-btn ${isPinned ? 'is-pinned' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                togglePin(branchKey);
              }}
              title={isPinned ? 'Unpin branch' : 'Pin branch to top'}
              aria-label={isPinned ? `Unpin ${branch.name}` : `Pin ${branch.name} to top`}
            >
              <PinIcon size={12} filled={isPinned} />
            </button>
          )}

          {isSelected && (
            <span className="branch-switcher-check-icon" title="Currently selected">
              <CheckIcon size={15} />
            </span>
          )}
        </div>
      </div>
    );
  };

  let runningIndex = 0;

  return (
    <div className="branch-switcher-wrapper" ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="branch-switcher-trigger-group">
        <button
          ref={triggerRef}
          type="button"
          className={`branch-switcher-trigger ${isOpen ? 'is-open' : ''}`}
          onClick={toggleDropdown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls="branch-switcher-dropdown"
          title={`Active Branch: ${currentBranchName}. Click to switch branch.`}
        >
          <StoreIcon size={14} className="branch-switcher-store-icon" />
          <span className="branch-switcher-name" title={currentBranchName}>
            {currentBranchName}
          </span>
          <span className="branch-switcher-count-badge">
            {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
          </span>
          <ChevronDownIcon
            size={13}
            className={`branch-switcher-chevron ${isOpen ? 'rotated' : ''}`}
          />
        </button>
        <span className="branch-switcher-sa-tag">Super Admin</span>
      </div>

      {isOpen && (
        <div
          id="branch-switcher-dropdown"
          className="branch-switcher-dropdown"
          role="listbox"
          aria-label="Select Branch"
        >
          {/* Top Search Input */}
          <div className="branch-switcher-search-box">
            <SearchIcon size={14} className="search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="branch-switcher-search-input"
              placeholder="Search branch, city or code"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="branch-switcher-search-clear"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                title="Clear search"
                aria-label="Clear search"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {/* Branch List (Scrollable) */}
          <div className="branch-switcher-list">
            {navigableList.length === 0 ? (
              <div className="branch-switcher-empty">No branch matches that search.</div>
            ) : (
              <>
                {/* 0. All Branches (Overall) Option */}
                {matchesAll && (
                  <div className="branch-switcher-overall-section">
                    {renderBranchOption(ALL_BRANCHES_ITEM, runningIndex++)}
                  </div>
                )}

                {/* 1. Pinned Section */}
                {pinnedBranches.length > 0 && (
                  <div className="branch-switcher-pinned-section">
                    <div className="branch-switcher-section-header">
                      <span>Pinned</span>
                      <span className="branch-section-count">{pinnedBranches.length}</span>
                    </div>
                    {pinnedBranches.map((branch) => {
                      const idx = runningIndex++;
                      return renderBranchOption(branch, idx);
                    })}
                  </div>
                )}

                {/* 2. Grouped Section by City */}
                {cityGroups.map(({ city, branches: inCity }) => (
                  <div key={city} className="branch-switcher-city-section">
                    <div className="branch-switcher-section-header">
                      <span>{city}</span>
                      <span className="branch-section-count">{inCity.length}</span>
                    </div>
                    {inCity.map((branch) => {
                      const idx = runningIndex++;
                      return renderBranchOption(branch, idx);
                    })}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Fixed Footer */}
          <div className="branch-switcher-footer">
            <span className="branch-switcher-footer-hint">
              ↑↓ to move · Enter to select · Esc to close
            </span>
            <button
              type="button"
              className="branch-switcher-manage-btn"
              onClick={handleManageBranches}
              title="Manage branches in settings"
            >
              Manage branches →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
