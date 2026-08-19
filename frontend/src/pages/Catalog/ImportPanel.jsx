import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";


const MODE_OPTIONS = [
  {
    value: "dry-run",
    label: "Simulation (dry-run)",
    description: "Analyse le fichier sans rien écrire en base. À faire en premier.",
  },
  {
    value: "merge",
    label: "Fusion (merge)",
    description: "Ajoute les nouveaux produits/variantes, met à jour les variantes existantes (prix, stock, attributs).",
  },
  {
    value: "replace",
    label: "Remplacement (replace)",
    description: "Supprime tout le catalogue existant et le remplace entièrement par le fichier importé.",
  },
];

async function uploadImport(tenantId, file, mode) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post(
    `/tenants/${tenantId}/products/import?mode=${mode}`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

async function downloadTemplate(tenantId) {
  const response = await apiClient.get(
    `/tenants/${tenantId}/products/import/template`,
    { responseType: "blob" }
  );
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", "catalogue_template.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const ACCEPTED_EXTENSIONS = [".csv", ".json"];

function isAcceptedFile(file) {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export default function ImportPanel({ tenantId, onImportDone }) {
  const tenant = useTenant();
  const canImport = tenant.role === "admin_tenant" || tenant.role === "agent";  
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("dry-run");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dragError, setDragError] = useState(null);
  const fileInputRef = useRef(null);
  // compte les entrées/sorties imbriquées (enfants de la zone de drop) pour
  // éviter le flicker classique de dragleave qui se déclenche en survolant
  // un enfant du conteneur plutôt qu'en quittant réellement la zone.
  const dragCounterRef = useRef(0);

  const importMutation = useMutation({
    mutationFn: () => uploadImport(tenantId, file, mode),
    onSuccess: () => {
      // en dry-run rien n'a été écrit, pas besoin de refetch la liste.
      // en merge/replace, même avec des rejets partiels, ce qui a été
      // créé/mis à jour est réel en DB.
      if (mode !== "dry-run") {
        onImportDone();
      }
    },
  });

  const result = importMutation.data;
  const error = importMutation.error;

  function selectFile(selected) {
    if (!selected) return;
    if (!isAcceptedFile(selected)) {
      setDragError("Format non supporté — déposez un fichier .csv ou .json.");
      return;
    }
    setDragError(null);
    setFile(selected);
    importMutation.reset();
  }

  function handleFileChange(e) {
    selectFile(e.target.files?.[0] ?? null);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }

  function handleDragOver(e) {
    // requis pour autoriser le drop — sans preventDefault ici, le navigateur
    // refuse l'événement "drop" et ouvre le fichier dans un nouvel onglet à la place.
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    selectFile(dropped);
  }

  function handleSubmit() {
    if (!file) return;
    importMutation.mutate();
  }

  function handleReset() {
    setFile(null);
    setDragError(null);
    importMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="cat-import-panel">
      <div className="cat-import-top">
        <div
          className={`cat-dropzone ${isDraggingOver ? "cat-dropzone-active" : ""} ${
            file ? "cat-dropzone-has-file" : ""
          }`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <label className="cat-file-label" htmlFor="catalog-import-file">
            {file ? (
              <span className="cat-file-label-filename">{file.name}</span>
            ) : (
              <>
                <span>Glissez-déposez un fichier ici, ou </span>
                <span className="cat-file-label-link">cliquez pour parcourir</span>
              </>
            )}
            <span className="cat-file-label-hint">Formats acceptés : .csv, .json</span>
          </label>
          <input
            id="catalog-import-file"
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            onChange={handleFileChange}
            className="cat-file-input"
          />
        </div>
        <button
          type="button"
          className="cat-template-btn"
          onClick={() => downloadTemplate(tenantId)}
        >
          Télécharger le template CSV
        </button>
      </div>

      {dragError && <div className="cat-import-error-banner">{dragError}</div>}

      <div className="cat-mode-select">
        {MODE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`cat-mode-option ${mode === opt.value ? "cat-mode-option-active" : ""}`}
          >
            <input
              type="radio"
              name="import-mode"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => {
                setMode(opt.value);
                importMutation.reset();
              }}
            />
            <div>
              <div className="cat-mode-label">{opt.label}</div>
              <div className="cat-mode-description">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === "replace" && (
        <div className="cat-mode-warning">
          Attention : ce mode supprime l'intégralité du catalogue actuel avant de réimporter.
        </div>
      )}

      <div className="cat-import-actions">
        <button
          type="button"
          className="cat-import-submit-btn"
          onClick={handleSubmit}
          disabled={!file || importMutation.isPending || !canImport}
        >
          {!canImport
            ? "Import réservé aux admins/agents"
            : importMutation.isPending
            ? "Import en cours…"
            : "Lancer l'import"}
        </button>
        {(file || result) && (
          <button type="button" className="cat-import-reset-btn" onClick={handleReset}>
            Réinitialiser
          </button>
        )}
      </div>

      {error && (
        <div className="cat-import-error-banner">
          {error.response?.data?.error === "UNSUPPORTED_FILE_FORMAT" &&
            "Format de fichier non supporté — utilisez un .csv ou .json."}
          {error.response?.data?.error === "INVALID_JSON_FORMAT" &&
            "Le fichier JSON n'est pas un tableau valide."}
          {error.response?.data?.error === "FILE_PARSING_FAILED" &&
            "Impossible de lire le fichier — vérifiez son format."}
          {error.response?.status === 403 &&
            "Votre rôle (lecture seule) ne permet pas d'importer un catalogue. Contactez un administrateur du tenant."}
          {!["UNSUPPORTED_FILE_FORMAT", "INVALID_JSON_FORMAT", "FILE_PARSING_FAILED"].includes(
            error.response?.data?.error
          ) &&
            error.response?.status !== 403 &&
            "Une erreur est survenue pendant l'import."}
        </div>
      )}

      {result && (
        <div className="cat-import-result">
          <div className="cat-import-result-header">
            {result.mode === "dry-run" ? "Résultat de la simulation" : "Import terminé"}
          </div>
          <div className="cat-import-stats">
            <div className="cat-stat-chip">
              <span className="cat-stat-value">{result.totalRows}</span>
              <span className="cat-stat-label">lignes lues</span>
            </div>
            <div className="cat-stat-chip cat-stat-created">
              <span className="cat-stat-value">{result.created}</span>
              <span className="cat-stat-label">créées</span>
            </div>
            <div className="cat-stat-chip cat-stat-updated">
              <span className="cat-stat-value">{result.updated}</span>
              <span className="cat-stat-label">mises à jour</span>
            </div>
            <div className="cat-stat-chip cat-stat-rejected">
              <span className="cat-stat-value">{result.rejected}</span>
              <span className="cat-stat-label">rejetées</span>
            </div>
          </div>

          {result.mode === "dry-run" && result.rejected === 0 && (
            <p className="cat-import-hint">
              Simulation propre — relancez avec le mode "Fusion" ou "Remplacement" pour appliquer.
            </p>
          )}

          {result.errors.length > 0 && (
            <table className="cat-error-table">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Réf. produit</th>
                  <th>SKU</th>
                  <th>Raison</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((err, i) => (
                  <tr key={i}>
                    <td>{err.rowNumber}</td>
                    <td>{err.productRef ?? "—"}</td>
                    <td>{err.sku ?? "—"}</td>
                    <td>{err.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}