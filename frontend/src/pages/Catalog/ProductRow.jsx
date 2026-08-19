import { useState } from "react";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ProductRow({ product }) {
  const [expanded, setExpanded] = useState(false);
  const variantCount = product.variants.length;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
  const lowStock = product.variants.some((v) => v.stock === 0);

  return (
    <div className="cat-product-card">
      <button
        type="button"
        className="cat-product-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`cat-expand-icon ${expanded ? "cat-expand-icon-open" : ""}`}>▸</span>

        <div className="cat-product-thumb">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" />
          ) : (
            <span className="cat-product-thumb-placeholder" aria-hidden="true" />
          )}
        </div>

        <div className="cat-product-info">
          <div className="cat-product-name-row">
            <span className="cat-product-name">{product.name}</span>
            {product.category && (
              <span className="cat-product-category-tag">{product.category}</span>
            )}
            {lowStock && <span className="cat-product-stock-warning">stock épuisé sur 1+ variante</span>}
          </div>
          <div className="cat-product-meta">
            {product.productRef && <span>Réf. {product.productRef}</span>}
            <span>
              {variantCount} variante{variantCount > 1 ? "s" : ""}
            </span>
            <span>{totalStock} en stock</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="cat-product-detail">
          {product.description && (
            <p className="cat-product-description">{product.description}</p>
          )}

          <table className="cat-variant-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Attributs</th>
                <th>Prix</th>
                <th>Stock</th>
                <th>Mis à jour</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td className="cat-sku-cell">{v.sku}</td>
                  <td>
                    {Object.entries(v.attributes).length === 0
                      ? "—"
                      : Object.entries(v.attributes)
                          .map(([k, val]) => `${k}: ${val}`)
                          .join(" · ")}
                  </td>
                  <td>{v.price} MAD</td>
                  <td className={v.stock === 0 ? "cat-stock-zero" : ""}>{v.stock}</td>
                  <td>{formatDate(v.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {product.tags.length > 0 && (
            <div className="cat-product-tags">
              {product.tags.map((t) => (
                <span key={t} className="cat-tag-chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}