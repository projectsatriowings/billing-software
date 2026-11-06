import React from 'react';
import type { Branch } from '../../api.ts';
import './BranchSelector.css';

export interface BranchSelectorProps {
  branches: Branch[];
  selectedBranch: string;
  onSelectBranch: (branchCode: string) => void;
  canAccessOverall?: boolean;
  className?: string;
  id?: string;
}

export const BranchSelector: React.FC<BranchSelectorProps> = ({
  branches,
  selectedBranch,
  onSelectBranch,
  canAccessOverall = true,
  className = '',
  id = 'global-branch-selector',
}) => {
  if (!branches || branches.length === 0) {
    return null;
  }

  // Normalize current select value so it matches whether code or id was passed
  const selectValue = React.useMemo(() => {
    if (!selectedBranch || selectedBranch.toLowerCase() === 'all') return 'all';
    const match = branches.find(
      (b) => b.id === selectedBranch || (b.code && b.code.toUpperCase() === selectedBranch.toUpperCase())
    );
    return match ? (match.code || match.id) : selectedBranch;
  }, [selectedBranch, branches]);

  return (
    <div className={`top-branch-selector-pill ${className}`.trim()}>
      {/* a) Building icon, 18px, stroke #5B4FE9, aria-hidden */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#5B4FE9"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="top-branch-icon"
      >
        <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
        <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
        <path d="M10 6h4" />
        <path d="M10 10h4" />
        <path d="M10 14h4" />
        <path d="M10 18h4" />
      </svg>

      {/* b) "Branch" label: 14px, weight 500, color #5F6275. Accessible label for select */}
      <label htmlFor={id} className="top-branch-label">
        Branch
      </label>

      {/* c) <select> inside relative wrapper with custom chevron-down icon */}
      <div className="top-branch-select-wrapper">
        <select
          id={id}
          value={selectValue}
          onChange={(e) => onSelectBranch(e.target.value)}
          className="top-branch-select"
          title="Switch branch scope"
        >
          {canAccessOverall && (
            <option value="all">All Branches (Overall)</option>
          )}
          {branches.map((b) => (
            <option key={b.id || b.code} value={b.code || b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5F6275"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="top-branch-chevron"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* d) Count pill: "3 branches" (singular "1 branch"), 12px, weight 600, color #4F46E5, background #EEEDFD, padding 4px 8px, fully rounded. Hidden if only one branch */}
      {branches.length > 1 && (
        <span className="top-branch-count-pill">
          {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
        </span>
      )}
    </div>
  );
};
