-- Phase 2 : catalogue unique, référentiels, impression, journal d'audit.
--
-- Source : arkyo@88b2e4b, database/tenant/schema.prisma (modèles Tenant*,
-- AuditLog, ExportTemplate) et database/main/schema.prisma (CatalogSymbol,
-- PrintSettings). Types : String → TEXT, Int → INTEGER, Float → REAL,
-- Boolean → INTEGER 0/1, DateTime → TEXT ISO 8601 UTC ms, Json et String[] /
-- Float[] → TEXT JSON. Les « soft FK » d'arkyo restent du texte ; clés
-- étrangères seulement pour les vraies relations du schéma tenant.
--
-- CATALOGUE UNIQUE (décisions 2 et 3 de la phase) : les lignes des modèles
-- Catalog* (main) vivent dans les tables Tenant*. Pour chaque modèle :
--
-- TenantBrand            ← CatalogBrand
--   ignorées : visibleFromPlan, propagation, pinned (SaaS) ; sortOrder (0 dans
--   tous les seeds, le tenant trie par nom).
-- TenantConnectorType    ← CatalogConnectorType
--   relation convertie : CatalogConnectorTypeFunction (jointure) → functionIds
--   (JSON). versions String[] → JSON. cablesLeft/cablesRight non stockés
--   (relations inverses). ignorées : visibleFromPlan, propagation, pinned,
--   sortOrder (0 dans les seeds, le tenant trie par nom).
-- TenantSignalType       ← CatalogSignalType
--   ajoutées : isDefault, sortOrder. relation convertie : connectors (JSON) →
--   connectorIds. ignorées : visibleFromPlan, propagation, pinned.
-- TenantDimensionPreset  ← DimensionPreset
--   ignorée : isBuiltin (tout est perso, restore-arkyo relit les seeds).
-- TenantCableModel       ← CableModel
--   ignorées : visibleFromPlan, propagation, pinned. Unicité tenant gardée
--   (name, reference) ; celle de main (name, brandId) n'est pas reprise.
-- TenantEquipment        ← CatalogEquipment (non seedé)
--   relations converties : CatalogEquipmentFunction / CatalogEquipmentPhase →
--   functionIds / phaseIds (JSON). ignorées : category (texte hérité),
--   sortOrder, visibleFromPlan, propagation, pinned. clonedFromArkyoId,
--   clonedFromArkyoVersion restent NULL et shadowsArkyo 0 (décision 2).
-- TenantEquipmentComponent ← CatalogEquipmentComponent (vraie relation hostId).
-- TenantCable            ← Cable
--   useCases String[] / availableLengths Float[] → JSON. ignorées :
--   visibleFromPlan, propagation, pinned. clonedFromArkyo* : comme équipements.
-- TenantAdapter          ← CatalogAdapter
--   ignorées : sortOrder (0 dans les seeds), visibleFromPlan, propagation,
--   pinned. clonedFromArkyo* : comme équipements.
-- TenantEquipmentCategory ← CatalogEquipmentCategory
--   ignorées : visibleFromPlan, propagation, pinned. parentId : vraie relation
--   (auto-référence, ON DELETE SET NULL).
-- TenantFunction         ← CatalogFunction
--   ajoutées : cablePrefix, cableSuffix, systemCategory (unique, NULL multiples).
-- TenantPhase            ← CatalogPhase (aucun écart).
-- TenantType             ← CatalogType
--   ajoutées : iconId, schemaImageUrl. ÉCART D'UNICITÉ (validé le
--   2026-11-05) : l'unique global sur name du tenant est remplacé par une
--   unicité par fratrie (name, parentId), les types racine (parentId NULL)
--   formant une seule fratrie (COALESCE). C'est la règle de la garde
--   isDuplicateSibling d'arkyo (même nom sous le même parent → 409) : la
--   taxonomie d'arkyo répète des noms de sous-types sous des parents
--   différents (« Production », « Micro HF », « Processeur »…).
-- TenantPrintTemplate    ← PrintTemplate ; ignorée : isBuiltin.
-- TenantCableLabelStock  ← CableLabelStock ; ignorée : isBuiltin.
-- TenantPrintExportModel / TenantPrintExportPage ← PrintExportModel /
--   PrintExportPage ; ignorée : isBuiltin. Vraie relation modelId (cascade).
-- CatalogSymbol          : modèle main repris tel quel.
-- PrintSettings          : singleton main (key = 'default'), lecture seule.
-- ExportTemplate, AuditLog : modèles tenant repris tels quels ; AuditLog.projectId
--   sans clé étrangère (table Project en phase 3, décision 11).

CREATE TABLE "TenantBrand" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL UNIQUE,
    "website"   TEXT,
    "logoUrl"   TEXT,
    "isActive"  INTEGER NOT NULL DEFAULT 1,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "TenantBrand_isActive_idx" ON "TenantBrand" ("isActive");

CREATE TABLE "TenantConnectorType" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "name"        TEXT NOT NULL UNIQUE,
    "versions"    TEXT NOT NULL DEFAULT '[]',
    "iconId"      TEXT,
    "svgUrl"      TEXT,
    "color"       TEXT,
    "functionIds" TEXT NOT NULL DEFAULT '[]',
    "isActive"    INTEGER NOT NULL DEFAULT 1,
    "createdAt"   TEXT NOT NULL,
    "updatedAt"   TEXT NOT NULL
);
CREATE INDEX "TenantConnectorType_isActive_idx" ON "TenantConnectorType" ("isActive");

CREATE TABLE "TenantSignalType" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "name"               TEXT NOT NULL UNIQUE,
    "color"              TEXT,
    "functionId"         TEXT,
    "cablePrefix"        TEXT,
    "cableSuffix"        TEXT,
    "bandwidth"          TEXT,
    "requiredImpedance"  REAL,
    "minBandwidthMHz"    REAL,
    "connectorIds"       TEXT NOT NULL DEFAULT '[]',
    "isIp"               INTEGER NOT NULL DEFAULT 0,
    "supportsRedundancy" INTEGER NOT NULL DEFAULT 0,
    "redundancyStyle"    TEXT,
    "usesMulticast"      INTEGER NOT NULL DEFAULT 0,
    "isDefault"          INTEGER NOT NULL DEFAULT 0,
    "sortOrder"          INTEGER NOT NULL DEFAULT 0,
    "isActive"           INTEGER NOT NULL DEFAULT 1,
    "createdAt"          TEXT NOT NULL,
    "updatedAt"          TEXT NOT NULL
);
CREATE INDEX "TenantSignalType_isActive_idx" ON "TenantSignalType" ("isActive");

CREATE TABLE "TenantDimensionPreset" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "category"  TEXT NOT NULL,
    "value"     REAL NOT NULL,
    "unit"      TEXT NOT NULL,
    "isReel"    INTEGER NOT NULL DEFAULT 0,
    "isActive"  INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "TenantDimensionPreset_category_isActive_idx" ON "TenantDimensionPreset" ("category", "isActive");
CREATE UNIQUE INDEX "TenantDimensionPreset_category_value_unit_key" ON "TenantDimensionPreset" ("category", "value", "unit");

CREATE TABLE "TenantCableModel" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "reference"      TEXT,
    "functionId"     TEXT,
    "brandId"        TEXT,
    "impedance"      REAL,
    "bandwidthMHz"   REAL,
    "diameterMm"     REAL,
    "conductor"      TEXT,
    "shielding"      TEXT,
    "jacketMaterial" TEXT,
    "fireRating"     TEXT,
    "customFields"   TEXT NOT NULL DEFAULT '[]',
    "imageUrl"       TEXT,
    "datasheetUrl"   TEXT,
    "notes"          TEXT,
    "isActive"       INTEGER NOT NULL DEFAULT 1,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL
);
CREATE UNIQUE INDEX "TenantCableModel_name_reference_key" ON "TenantCableModel" ("name", "reference");
CREATE INDEX "TenantCableModel_isActive_functionId_idx" ON "TenantCableModel" ("isActive", "functionId");

CREATE TABLE "TenantEquipment" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "name"                   TEXT NOT NULL,
    "reference"              TEXT,
    "brandId"                TEXT,
    "categoryId"             TEXT,
    "typeId"                 TEXT,
    "clonedFromArkyoId"      TEXT,
    "shadowsArkyo"           INTEGER NOT NULL DEFAULT 0,
    "clonedFromArkyoVersion" TEXT,
    "isRackable"             INTEGER NOT NULL DEFAULT 1,
    "heightU"                INTEGER,
    "depthMm"                INTEGER,
    "rearCableDepthMm"       INTEGER,
    "widthFraction"          TEXT NOT NULL DEFAULT 'FULL',
    "dimLmm"                 INTEGER,
    "dimWmm"                 INTEGER,
    "dimHmm"                 INTEGER,
    "weight"                 REAL,
    "powerW"                 INTEGER,
    "heatBtuH"               REAL,
    "hasDualPsu"             INTEGER NOT NULL DEFAULT 0,
    "is2110"                 INTEGER NOT NULL DEFAULT 0,
    "ip2110Mode"             TEXT,
    "isLightingFixture"      INTEGER NOT NULL DEFAULT 0,
    "dmxChannelsDefault"     INTEGER,
    "dmxModes"               TEXT NOT NULL DEFAULT '[]',
    "isComponentHost"        INTEGER NOT NULL DEFAULT 0,
    "hostSlotCount"          INTEGER,
    "isComponent"            INTEGER NOT NULL DEFAULT 0,
    "componentSlotSpan"      INTEGER NOT NULL DEFAULT 1,
    "connectors"             TEXT NOT NULL DEFAULT '[]',
    "signalCapacities"       TEXT NOT NULL DEFAULT '[]',
    "customFields"           TEXT NOT NULL DEFAULT '[]',
    "imageUrl"               TEXT,
    "iconUrl"                TEXT,
    "rackSymbolUrl"          TEXT,
    "rackSymbolRearUrl"      TEXT,
    "rackPhotoFrontUrl"      TEXT,
    "rackPhotoRearUrl"       TEXT,
    "schemaImageUrl"         TEXT,
    "frontImageUrl"          TEXT,
    "rearImageUrl"           TEXT,
    "documents"              TEXT NOT NULL DEFAULT '[]',
    "notes"                  TEXT,
    "tags"                   TEXT NOT NULL DEFAULT '[]',
    "isActive"               INTEGER NOT NULL DEFAULT 1,
    "createdById"            TEXT NOT NULL,
    "createdAt"              TEXT NOT NULL,
    "updatedAt"              TEXT NOT NULL,
    "functionIds"            TEXT NOT NULL DEFAULT '[]',
    "phaseIds"               TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX "TenantEquipment_createdById_idx" ON "TenantEquipment" ("createdById");
CREATE INDEX "TenantEquipment_clonedFromArkyoId_idx" ON "TenantEquipment" ("clonedFromArkyoId");
CREATE INDEX "TenantEquipment_shadowsArkyo_clonedFromArkyoId_idx" ON "TenantEquipment" ("shadowsArkyo", "clonedFromArkyoId");

CREATE TABLE "TenantEquipmentComponent" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "hostId"      TEXT NOT NULL REFERENCES "TenantEquipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "componentId" TEXT NOT NULL,
    "slotIndex"   INTEGER NOT NULL,
    "createdAt"   TEXT NOT NULL
);
CREATE UNIQUE INDEX "TenantEquipmentComponent_hostId_slotIndex_key" ON "TenantEquipmentComponent" ("hostId", "slotIndex");
CREATE INDEX "TenantEquipmentComponent_hostId_idx" ON "TenantEquipmentComponent" ("hostId");
CREATE INDEX "TenantEquipmentComponent_componentId_idx" ON "TenantEquipmentComponent" ("componentId");

CREATE TABLE "TenantCable" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "name"                   TEXT NOT NULL,
    "reference"              TEXT,
    "leftConnectorId"        TEXT,
    "leftGender"             TEXT,
    "rightConnectorId"       TEXT,
    "rightGender"            TEXT,
    "functionId"             TEXT,
    "brandId"                TEXT,
    "model"                  TEXT,
    "cableModelId"           TEXT,
    "useCases"               TEXT NOT NULL DEFAULT '[]',
    "availableLengths"       TEXT NOT NULL DEFAULT '[]',
    "customMinLength"        REAL,
    "customMaxLength"        REAL,
    "notes"                  TEXT,
    "imageUrl"               TEXT,
    "isActive"               INTEGER NOT NULL DEFAULT 1,
    "sortOrder"              INTEGER NOT NULL DEFAULT 0,
    "clonedFromArkyoId"      TEXT,
    "shadowsArkyo"           INTEGER NOT NULL DEFAULT 0,
    "clonedFromArkyoVersion" TEXT,
    "createdById"            TEXT NOT NULL,
    "createdAt"              TEXT NOT NULL,
    "updatedAt"              TEXT NOT NULL
);
CREATE INDEX "TenantCable_createdById_idx" ON "TenantCable" ("createdById");
CREATE INDEX "TenantCable_clonedFromArkyoId_idx" ON "TenantCable" ("clonedFromArkyoId");
CREATE INDEX "TenantCable_shadowsArkyo_clonedFromArkyoId_idx" ON "TenantCable" ("shadowsArkyo", "clonedFromArkyoId");
CREATE INDEX "TenantCable_cableModelId_idx" ON "TenantCable" ("cableModelId");

CREATE TABLE "TenantAdapter" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "name"                   TEXT NOT NULL,
    "reference"              TEXT,
    "functionId"             TEXT,
    "inputs"                 TEXT NOT NULL DEFAULT '[]',
    "outputs"                TEXT NOT NULL DEFAULT '[]',
    "notes"                  TEXT,
    "imageUrl"               TEXT,
    "isActive"               INTEGER NOT NULL DEFAULT 1,
    "clonedFromArkyoId"      TEXT,
    "shadowsArkyo"           INTEGER NOT NULL DEFAULT 0,
    "clonedFromArkyoVersion" TEXT,
    "createdById"            TEXT NOT NULL,
    "createdAt"              TEXT NOT NULL,
    "updatedAt"              TEXT NOT NULL
);
CREATE INDEX "TenantAdapter_createdById_idx" ON "TenantAdapter" ("createdById");
CREATE INDEX "TenantAdapter_clonedFromArkyoId_idx" ON "TenantAdapter" ("clonedFromArkyoId");
CREATE INDEX "TenantAdapter_shadowsArkyo_clonedFromArkyoId_idx" ON "TenantAdapter" ("shadowsArkyo", "clonedFromArkyoId");

CREATE TABLE "TenantEquipmentCategory" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL UNIQUE,
    "color"     TEXT,
    "iconId"    TEXT,
    "parentId"  TEXT REFERENCES "TenantEquipmentCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive"  INTEGER NOT NULL DEFAULT 1,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "TenantEquipmentCategory_parentId_idx" ON "TenantEquipmentCategory" ("parentId");
CREATE INDEX "TenantEquipmentCategory_isActive_idx" ON "TenantEquipmentCategory" ("isActive");

CREATE TABLE "TenantFunction" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "key"            TEXT NOT NULL UNIQUE,
    "label"          TEXT NOT NULL,
    "color"          TEXT,
    "cablePrefix"    TEXT,
    "cableSuffix"    TEXT,
    "systemCategory" TEXT,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "isActive"       INTEGER NOT NULL DEFAULT 1,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL
);
CREATE INDEX "TenantFunction_isActive_idx" ON "TenantFunction" ("isActive");
CREATE UNIQUE INDEX "TenantFunction_systemCategory_key" ON "TenantFunction" ("systemCategory");

CREATE TABLE "TenantPhase" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "key"       TEXT NOT NULL UNIQUE,
    "label"     TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive"  INTEGER NOT NULL DEFAULT 1,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "TenantPhase_isActive_idx" ON "TenantPhase" ("isActive");

CREATE TABLE "TenantType" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "functionId"     TEXT,
    "parentId"       TEXT,
    "iconId"         TEXT,
    "schemaImageUrl" TEXT,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "isActive"       INTEGER NOT NULL DEFAULT 1,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL
);
CREATE INDEX "TenantType_isActive_idx" ON "TenantType" ("isActive");
CREATE INDEX "TenantType_parentId_idx" ON "TenantType" ("parentId");
CREATE INDEX "TenantType_functionId_idx" ON "TenantType" ("functionId");
CREATE UNIQUE INDEX "TenantType_name_parentId_key"
    ON "TenantType" ("name", COALESCE("parentId", ''));

CREATE TABLE "TenantPrintTemplate" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "key"         TEXT NOT NULL UNIQUE,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "paperFormat" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'PORTRAIT',
    "slots"       TEXT NOT NULL DEFAULT '[]',
    "layout"      TEXT,
    "isActive"    INTEGER NOT NULL DEFAULT 1,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TEXT NOT NULL,
    "updatedAt"   TEXT NOT NULL
);
CREATE INDEX "TenantPrintTemplate_isActive_idx" ON "TenantPrintTemplate" ("isActive");

CREATE TABLE "TenantCableLabelStock" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "name"             TEXT NOT NULL,
    "reference"        TEXT,
    "brandId"          TEXT,
    "description"      TEXT,
    "datasheetUrl"     TEXT,
    "paperFormat"      TEXT NOT NULL DEFAULT 'A4',
    "orientation"      TEXT NOT NULL DEFAULT 'PORTRAIT',
    "pageMarginTop"    REAL NOT NULL,
    "pageMarginRight"  REAL NOT NULL,
    "pageMarginBottom" REAL NOT NULL,
    "pageMarginLeft"   REAL NOT NULL,
    "columns"          INTEGER NOT NULL DEFAULT 1,
    "rows"             INTEGER NOT NULL DEFAULT 1,
    "gutterX"          REAL NOT NULL DEFAULT 0,
    "gutterY"          REAL NOT NULL DEFAULT 0,
    "labelWidth"       REAL NOT NULL,
    "labelHeight"      REAL NOT NULL,
    "printableHeight"  REAL,
    "wrapHeight"       REAL,
    "printablePadding" REAL,
    "printableColor"   TEXT,
    "cableDiameterMin" REAL,
    "cableDiameterMax" REAL,
    "isActive"         INTEGER NOT NULL DEFAULT 1,
    "sortOrder"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"        TEXT NOT NULL,
    "updatedAt"        TEXT NOT NULL
);
CREATE UNIQUE INDEX "TenantCableLabelStock_name_reference_key" ON "TenantCableLabelStock" ("name", "reference");
CREATE INDEX "TenantCableLabelStock_isActive_idx" ON "TenantCableLabelStock" ("isActive");

CREATE TABLE "TenantPrintExportModel" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "key"         TEXT NOT NULL UNIQUE,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    INTEGER NOT NULL DEFAULT 1,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TEXT NOT NULL,
    "updatedAt"   TEXT NOT NULL
);
CREATE INDEX "TenantPrintExportModel_isActive_idx" ON "TenantPrintExportModel" ("isActive");

CREATE TABLE "TenantPrintExportPage" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "modelId"   TEXT NOT NULL REFERENCES "TenantPrintExportModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "kind"      TEXT NOT NULL,
    "layout"    TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "TenantPrintExportPage_modelId_kind_key" ON "TenantPrintExportPage" ("modelId", "kind");
CREATE INDEX "TenantPrintExportPage_modelId_idx" ON "TenantPrintExportPage" ("modelId");

CREATE TABLE "ExportTemplate" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "scope"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "columns"   TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "ExportTemplate_scope_name_key" ON "ExportTemplate" ("scope", "name");
CREATE INDEX "ExportTemplate_scope_idx" ON "ExportTemplate" ("scope");

CREATE TABLE "AuditLog" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "userId"     TEXT NOT NULL,
    "action"     TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "projectId"  TEXT,
    "before"     TEXT,
    "after"      TEXT,
    "createdAt"  TEXT NOT NULL
);
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog" ("projectId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");

CREATE TABLE "CatalogSymbol" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "key"       TEXT NOT NULL UNIQUE,
    "label"     TEXT NOT NULL,
    "isBuiltin" INTEGER NOT NULL DEFAULT 0,
    "svgUrl"    TEXT,
    "svgUrlD"   TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

CREATE TABLE "PrintSettings" (
    "id"                  TEXT NOT NULL PRIMARY KEY,
    "key"                 TEXT NOT NULL UNIQUE DEFAULT 'default',
    "defaultPaperFormat"  TEXT NOT NULL DEFAULT 'A3',
    "defaultOrientation"  TEXT NOT NULL DEFAULT 'LANDSCAPE',
    "defaultMarginTop"    INTEGER NOT NULL DEFAULT 15,
    "defaultMarginRight"  INTEGER NOT NULL DEFAULT 15,
    "defaultMarginBottom" INTEGER NOT NULL DEFAULT 15,
    "defaultMarginLeft"   INTEGER NOT NULL DEFAULT 15,
    "watermarkUrl"        TEXT,
    "watermarkOpacity"    REAL NOT NULL DEFAULT 0.1,
    "pdfOptions"          TEXT NOT NULL DEFAULT '{}',
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);
