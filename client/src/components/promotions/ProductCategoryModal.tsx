import React, { useState, useMemo } from 'react';
import type { Item, Category } from '../../api';

interface ProductCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  categories: Category[];
  mode: 'single-product' | 'multi-product' | 'multi-category' | 'products-and-categories';
  selectedProductIds?: string[];
  selectedCategoryNames?: string[];
  onConfirm: (result: { productIds: string[]; categoryNames: string[]; singleProduct?: Item }) => void;
  title?: string;
}

export function ProductCategoryModal({
  isOpen,
  onClose,
  items,
  categories,
  mode,
  selectedProductIds = [],
  selectedCategoryNames = [],
  onConfirm,
  title,
}: ProductCategoryModalProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'categories'>(
    mode === 'multi-category' ? 'categories' : 'products'
  );
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const [tempProductIds, setTempProductIds] = useState<string[]>(selectedProductIds);
  const [tempCategoryNames, setTempCategoryNames] = useState<string[]>(selectedCategoryNames);
  const [selectedSingleItem, setSelectedSingleItem] = useState<Item | undefined>(() => {
    if (mode === 'single-product' && selectedProductIds.length > 0) {
      return items.find((i) => i.id === selectedProductIds[0]);
    }
    return undefined;
  });

  // Extract all unique category names from both categories prop and item attributes
  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => {
      if (c && c.name) set.add(c.name);
    });
    items.forEach((i) => {
      if (i && i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [categories, items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.barcode && item.barcode.toLowerCase().includes(q));

      const matchCat =
        categoryFilter === 'ALL' ||
        (item.category && item.category.toLowerCase() === categoryFilter.toLowerCase());

      return matchSearch && matchCat;
    });
  }, [items, search, categoryFilter]);

  // Filtered categories
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [categories, search]);

  if (!isOpen) return null;

  const toggleProduct = (item: Item) => {
    if (mode === 'single-product') {
      setSelectedSingleItem(item);
      setTempProductIds([item.id]);
      return;
    }
    if (tempProductIds.includes(item.id)) {
      setTempProductIds(tempProductIds.filter((id) => id !== item.id));
    } else {
      setTempProductIds([...tempProductIds, item.id]);
    }
  };

  const toggleCategory = (catName: string) => {
    if (tempCategoryNames.includes(catName)) {
      setTempCategoryNames(tempCategoryNames.filter((c) => c !== catName));
    } else {
      setTempCategoryNames([...tempCategoryNames, catName]);
    }
  };

  const selectAllFilteredProducts = () => {
    const newIds = new Set([...tempProductIds, ...filteredItems.map((i) => i.id)]);
    setTempProductIds(Array.from(newIds));
  };

  const deselectAllFilteredProducts = () => {
    const removeSet = new Set(filteredItems.map((i) => i.id));
    setTempProductIds(tempProductIds.filter((id) => !removeSet.has(id)));
  };

  const handleApply = () => {
    onConfirm({
      productIds: tempProductIds,
      categoryNames: tempCategoryNames,
      singleProduct: selectedSingleItem,
    });
    onClose();
  };

  const modalTitle = title || (mode === 'single-product' ? 'Select product' : 'Select products & categories');
  const modalSubtitle =
    mode === 'single-product'
      ? 'Choose the product this offer applies to.'
      : 'Select specific products or entire categories eligible for this promotion';

  return (
    <div className="promo-modal-overlay" onClick={onClose}>
      <div className="promo-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="promo-modal-header">
          <div>
            <h3 className="promo-modal-title">{modalTitle}</h3>
            <p className="promo-modal-subtitle">{modalSubtitle}</p>
          </div>
          <button className="promo-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* Tab switcher if both allowed */}
        {mode === 'products-and-categories' && (
          <div className="promo-modal-tabs">
            <button
              type="button"
              className={`promo-modal-tab ${activeTab === 'products' ? 'active' : ''}`}
              onClick={() => setActiveTab('products')}
            >
              Products ({tempProductIds.length})
            </button>
            <button
              type="button"
              className={`promo-modal-tab ${activeTab === 'categories' ? 'active' : ''}`}
              onClick={() => setActiveTab('categories')}
            >
              Categories ({tempCategoryNames.length})
            </button>
          </div>
        )}

        {/* Search & Filter Row */}
        <div className="promo-modal-filters-section">
          <div className="promo-modal-search-row">
            <div className="promo-search-wrap">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder={activeTab === 'products' ? 'Search by name, SKU or barcode' : 'Search categories'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="promo-search-input promo-modal-search-input"
                autoFocus
              />
              {search ? (
                <button type="button" className="promo-search-clear" onClick={() => setSearch('')}>
                  &times;
                </button>
              ) : (
                <div className="promo-modal-barcode-icon" title="Scan barcode">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
                    <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
                    <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
                    <line x1="7" y1="12" x2="17" y2="12"></line>
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Chips Filter Row */}
          {activeTab === 'products' && allCategoryNames.length > 0 && (
            <div className="promo-modal-chips-row">
              <button
                type="button"
                className={`promo-filter-chip ${categoryFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setCategoryFilter('ALL')}
              >
                All
              </button>
              {allCategoryNames.map((catName) => (
                <button
                  type="button"
                  key={catName}
                  className={`promo-filter-chip ${categoryFilter === catName ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(categoryFilter === catName ? 'ALL' : catName)}
                >
                  {catName}
                </button>
              ))}
            </div>
          )}

          {/* Count & Header row for products */}
          {activeTab === 'products' && (
            <div className="promo-modal-list-header">
              <span>{filteredItems.length} PRODUCTS</span>
              <span>PRICE</span>
            </div>
          )}
        </div>

        {/* Bulk select actions for multi-product */}
        {activeTab === 'products' && mode !== 'single-product' && (
          <div className="promo-selection-bar">
            <span>
              Showing {filteredItems.length} products • <strong>{tempProductIds.length} selected</strong>
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="promo-btn-link" onClick={selectAllFilteredProducts}>
                Select all visible
              </button>
              <span>•</span>
              <button type="button" className="promo-btn-link" onClick={deselectAllFilteredProducts}>
                Clear visible
              </button>
            </div>
          </div>
        )}

        {/* Modal body list */}
        <div className="promo-modal-body">
          {activeTab === 'products' ? (
            filteredItems.length === 0 ? (
              <div className="promo-empty-list">No products found matching your search.</div>
            ) : (
              <div className="promo-item-grid">
                {filteredItems.map((item) => {
                  const isSelected =
                    mode === 'single-product'
                      ? selectedSingleItem?.id === item.id
                      : tempProductIds.includes(item.id);

                  return (
                    <div
                      key={item.id}
                      className={`promo-item-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleProduct(item)}
                    >
                      <div className="promo-item-radio">
                        {isSelected ? (
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="9" stroke="#0F6B4F" strokeWidth="2" fill="#FFFFFF" />
                            <circle cx="10" cy="10" r="5" fill="#0F6B4F" />
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="9" stroke="#DAD8E6" strokeWidth="1.5" fill="#FFFFFF" />
                          </svg>
                        )}
                      </div>

                      <div className="promo-item-icon-tile">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5D6068" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                          <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                      </div>

                      <div className="promo-item-info">
                        <div className="promo-item-name">{item.name}</div>
                        <div className="promo-item-meta">
                          {(item.barcode || item.sku) && (
                            <span className="promo-item-barcode">{item.barcode || item.sku}</span>
                          )}
                          {item.category && <span className="promo-item-tag">{item.category}</span>}
                        </div>
                      </div>

                      <div className="promo-item-price">
                        ₹{(item.priceMinor / 100).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            filteredCategories.length === 0 ? (
              <div className="promo-empty-list">No categories found matching your search.</div>
            ) : (
              <div className="promo-category-grid">
                {filteredCategories.map((c) => {
                  const isSelected = tempCategoryNames.includes(c.name);
                  return (
                    <div
                      key={c.id}
                      className={`promo-category-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleCategory(c.name)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                      />
                      <span className="promo-category-name">{c.name}</span>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Modal footer strip */}
        <div className="promo-modal-footer">
          <div className="promo-footer-stats">
            {mode === 'single-product' ? (
              selectedSingleItem ? (
                <span>
                  Selected: {selectedSingleItem.name} · ₹{(selectedSingleItem.priceMinor / 100).toFixed(2)}
                </span>
              ) : (
                <span>No product selected</span>
              )
            ) : (
              <span>
                Selected: <strong>{tempProductIds.length}</strong> products,{' '}
                <strong>{tempCategoryNames.length}</strong> categories
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" className="promo-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="promo-btn-primary"
              onClick={handleApply}
              disabled={mode === 'single-product' && !selectedSingleItem}
            >
              Apply selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
