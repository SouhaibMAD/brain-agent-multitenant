import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import ProductRow from "./ProductRow";
import ImportPanel from "./ImportPanel";
import "./Catalog.css";

async function fetchProducts(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/products`);
  return data;
}

export default function Catalog() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);

  const { data: products, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["catalog-products", tenantId],
    queryFn: () => fetchProducts(tenantId),
  });

  const categories = useMemo(() => {
    if (!products) return [];
    const set = new Set();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (!term) return true;
      const nameMatch = p.name.toLowerCase().includes(term);
      const skuMatch = p.variants.some((v) => v.sku.toLowerCase().includes(term));
      return nameMatch || skuMatch;
    });
  }, [products, search, categoryFilter]);

  const totalVariants = useMemo(
    () => (products ?? []).reduce((sum, p) => sum + p.variants.length, 0),
    [products]
  );

  return (
    <div className="cat-shell">
      <div className="cat-header">
        <div>
          <h1 className="cat-title">Catalogue</h1>
          {!isLoading && (
            <p className="cat-subtitle">
              {products?.length ?? 0} produit{(products?.length ?? 0) > 1 ? "s" : ""} ·{" "}
              {totalVariants} variante{totalVariants > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          className="cat-import-toggle-btn"
          onClick={() => setImportOpen((v) => !v)}
        >
          {importOpen ? "Fermer l'import" : "Importer un catalogue"}
        </button>
      </div>

      {importOpen && (
        <ImportPanel
          tenantId={tenantId}
          onImportDone={() => {
            refetch();
          }}
        />
      )}

      <div className="cat-filters">
        <input
          type="text"
          className="cat-search-input"
          placeholder="Rechercher un produit ou un SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="cat-category-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">Toutes catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="cat-refresh-btn"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Rafraîchir"
        >
          {isFetching ? "…" : "Rafraîchir"}
        </button>
      </div>

      {isLoading && <div className="cat-empty-state">Chargement…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="cat-empty-state">
          {products?.length === 0
            ? "Aucun produit dans le catalogue. Importez un fichier CSV/JSON pour commencer."
            : "Aucun produit ne correspond à ce filtre."}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="cat-product-list">
          {filtered.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}