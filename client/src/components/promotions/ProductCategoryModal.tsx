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
  title = 'Select Products & Categories',
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

  return (
    <div className="promo-modal-overlay" onClick={onClose}>
      <div className="promo-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="promo-modal-header">
          <div>
            <h3 className="promo-modal-title">{title}</h3>
            <p className="promo-modal-subtitle">
              {mode === 'single-product'
                ? 'Choose a product from your catalog'
                : 'Select specific products or entire categories eligible for this promotion'}
            </p>
          </div>
          <button className="promo-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* Tab switcher if both allowed */}
        {mode === 'products-and-categories' && (
          <div className="promo-modal-tabs">
            <button
              className={`promo-modal-tab ${activeTab === 'products' ? 'active' : ''}`}
              onClick={() => setActiveTab('products')}
            >
              Products ({tempProductIds.length})
            </button>
            <button
              className={`promo-modal-tab ${activeTab === 'categories' ? 'active' : ''}`}
              onClick={() => setActiveTab('categories')}
            >
              Categories ({tempCategoryNames.length})
            </button>
          </div>
        )}

        {/* Search and filters bar */}
        <div className="promo-modal-filters">
          <div className="promo-search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder={activeTab === 'products' ? 'Search by name, SKU, or barcode...' : 'Search categories...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="promo-search-input"
              autoFocus
            />
            {search && (
              <button className="promo-search-clear" onClick={() => setSearch('')}>
                &times;
              </button>
            )}
          </div>

          {activeTab === 'products' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="promo-cat-select"
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
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
                      <div className="promo-item-check">
                        {mode === 'single-product' ? (
                          <input
                            type="radio"
                            checked={isSelected}
                            onChange={() => {}}
                            name="single-product-choice"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                          />
                        )}
                      </div>
                      <div className="promo-item-info">
                        <div className="promo-item-name">{item.name}</div>
                        <div className="promo-item-meta">
                          {item.sku && <span>SKU: {item.sku}</span>}
                          {item.barcode && <span>Barcode: {item.barcode}</span>}
                          {item.hsn && <span>HSN: {item.hsn}</span>}
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

        {/* Modal footer */}
        <div className="promo-modal-footer">
          <div className="promo-footer-stats">
            {mode === 'single-product' ? (
              selectedSingleItem ? (
                <span>
                  Selected: <strong>{selectedSingleItem.name}</strong> (₹{(selectedSingleItem.priceMinor / 100).toFixed(2)})
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
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="promo-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="promo-btn-primary"
              onClick={handleApply}
              disabled={mode === 'single-product' && !selectedSingleItem}
            >
              Apply Selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

