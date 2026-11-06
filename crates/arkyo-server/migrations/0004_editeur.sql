-- Phase 4 : éditeur projet (inventaire, rack, synoptique), câblage et
-- numérotation du synoptique.
--
-- Source : arkyo@88b2e4b, database/tenant/schema.prisma (modèles
-- ProjectEquipment, RackZone, RackLabel, CableBundle, RackSlotPanelRow,
-- SynopticAdapter, ExternalPort, RackConnection, ProjectSynopticAdapter,
-- ProjectCableBundle, ProjectConnection, ProjectSynopticZone,
-- ProjectSynopticLabel, SynopticGuide, ProjectSynopticLayout ; enum
-- ExternalPortKind) et ses migrations SQL (clés étrangères et index).
-- Conventions de 0002_catalogue.sql et 0003_projets.sql : String → TEXT,
-- Int → INTEGER, Float → REAL, Boolean → INTEGER 0/1, DateTime → TEXT
-- ISO 8601 UTC ms, Json → TEXT JSON ; enum Prisma → TEXT CHECK (valeurs de
-- l'enum, dans l'ordre du schéma). createdAt / updatedAt sont posés par le
-- handler. Colonnes dans l'ordre du schéma Prisma. Toutes les relations de
-- ces modèles ont un onDelete explicite dans arkyo, repris tel quel, avec
-- ON UPDATE CASCADE.
--
-- Les « soft FK » vers le catalogue restent du texte sans contrainte et
-- visent les tables locales de 0002 : catalogAdapterId → TenantAdapter,
-- catalogEquipmentId → TenantEquipment, catalogCableModelId →
-- TenantCableModel (décision 9 de la phase 4). catalogue/in_use.rs les
-- compte dès que ces tables existent.
--
-- Écarts et choix :
-- - snapshotId (RackConnection, SynopticAdapter, ProjectSynopticAdapter) :
--   présents, nullables, toujours NULL (snapshots du catalogue Arkyo = SaaS,
--   décision 5 de la phase 3). ProjectCatalogueSnapshot n'est pas créée.
-- - Écart de performance (décision 10 de la phase 4) : index
--   RackConnection_rackId_idx, RackConnection_fromSlotId_idx et
--   RackConnection_toSlotId_idx, absents d'arkyo. Les lectures du synoptique
--   filtrent par rackId et les suppressions en cascade depuis RackSlot
--   parcourent fromSlotId / toSlotId. Additifs, sans effet sur le JSON.
-- - SynopticGuide : la règle « rackId XOR projectId » n'est validée que par
--   l'API dans arkyo, donc pas de CHECK.
-- - Les « énumérations » String d'arkyo (borderStyle, labelPosition, axis,
--   *Side, cableStyle…) restent sans CHECK, comme Panel.panelType en 0003.
-- - ProjectConnection.cartoCablePath (relation inverse vers CartoCablePath)
--   arrive avec la table de la phase 5 ; rien à créer ici.

CREATE TABLE "ProjectEquipment" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "projectId"          TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogEquipmentId" TEXT,
    "ipAddress"          TEXT,
    "notes"              TEXT,
    "position"           TEXT,
    "quantity"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "ProjectEquipment_projectId_catalogEquipmentId_key"
    ON "ProjectEquipment" ("projectId", "catalogEquipmentId");
CREATE INDEX "ProjectEquipment_projectId_idx" ON "ProjectEquipment" ("projectId");

CREATE TABLE "RackZone" (
    "id"                  TEXT NOT NULL PRIMARY KEY,
    "rackId"              TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "label"               TEXT NOT NULL DEFAULT 'Zone',
    "labelPosition"       TEXT NOT NULL DEFAULT 'top-left',
    "color"               TEXT NOT NULL DEFAULT '#6366f1',
    "x"                   REAL NOT NULL,
    "y"                   REAL NOT NULL,
    "w"                   REAL NOT NULL,
    "h"                   REAL NOT NULL,
    "borderRadius"        INTEGER NOT NULL DEFAULT 8,
    "borderWidth"         INTEGER NOT NULL DEFAULT 2,
    "borderStyle"         TEXT NOT NULL DEFAULT 'solid',
    "opacity"             REAL NOT NULL DEFAULT 0.12,
    "labelFontSize"       INTEGER NOT NULL DEFAULT 12,
    "labelFontWeight"     TEXT NOT NULL DEFAULT 'normal',
    "labelFontStyle"      TEXT NOT NULL DEFAULT 'normal',
    "labelTextDecoration" TEXT NOT NULL DEFAULT 'none',
    "labelFontFamily"     TEXT,
    "createdAt"           TEXT NOT NULL,
    "updatedAt"           TEXT NOT NULL
);

CREATE TABLE "RackLabel" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "rackId"         TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "text"           TEXT NOT NULL DEFAULT 'Libellé',
    "x"              REAL NOT NULL,
    "y"              REAL NOT NULL,
    "fontSize"       INTEGER NOT NULL DEFAULT 14,
    "width"          REAL,
    "color"          TEXT NOT NULL DEFAULT '#111827',
    "fontWeight"     TEXT NOT NULL DEFAULT 'normal',
    "fontFamily"     TEXT,
    "fontStyle"      TEXT NOT NULL DEFAULT 'normal',
    "textDecoration" TEXT NOT NULL DEFAULT 'none',
    "pill"           INTEGER NOT NULL DEFAULT 0,
    "pillBg"         TEXT,
    "pillRadius"     INTEGER NOT NULL DEFAULT 12,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL
);

CREATE TABLE "CableBundle" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "rackId"    TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name"      TEXT NOT NULL,
    "color"     TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

CREATE TABLE "RackSlotPanelRow" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "slotId"    TEXT NOT NULL REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rowIndex"  INTEGER NOT NULL,
    "synopticX" REAL NOT NULL,
    "synopticY" REAL NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "RackSlotPanelRow_slotId_rowIndex_key" ON "RackSlotPanelRow" ("slotId", "rowIndex");

CREATE TABLE "SynopticAdapter" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "rackId"            TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogAdapterId"  TEXT,
    "snapshotId"        TEXT,
    "x"                 REAL NOT NULL,
    "y"                 REAL NOT NULL,
    "attachedSlotId"    TEXT REFERENCES "RackSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "attachedSide"      TEXT,
    "attachedPortIndex" INTEGER,
    "label"             TEXT,
    "notes"             TEXT,
    "createdAt"         TEXT NOT NULL,
    "updatedAt"         TEXT NOT NULL
);
CREATE INDEX "SynopticAdapter_snapshotId_idx" ON "SynopticAdapter" ("snapshotId");

CREATE TABLE "ExternalPort" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "rackId"    TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "slotId"    TEXT NOT NULL REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "portIndex" INTEGER NOT NULL,
    "labelX"    REAL,
    "labelY"    REAL,
    "label"     TEXT,
    "kind"      TEXT NOT NULL DEFAULT 'INTER_LIEU'
        CHECK ("kind" IN ('INTER_LIEU', 'MONDE')),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "ExternalPort_slotId_portIndex_key" ON "ExternalPort" ("slotId", "portIndex");
CREATE INDEX "ExternalPort_rackId_idx" ON "ExternalPort" ("rackId");

CREATE TABLE "RackConnection" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "rackId"               TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromSlotId"           TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromConnectorIndex"   INTEGER,
    "fromAdapterId"        TEXT REFERENCES "SynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromAdapterSide"      TEXT,
    "fromAdapterPortIndex" INTEGER,
    "fromComponentItemId"  TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toSlotId"             TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toConnectorIndex"     INTEGER,
    "toAdapterId"          TEXT REFERENCES "SynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toAdapterSide"        TEXT,
    "toAdapterPortIndex"   INTEGER,
    "toComponentItemId"    TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "label"                TEXT,
    "color"                TEXT,
    "waypoints"            TEXT,
    "cableStyle"           TEXT,
    "notes"                TEXT,
    "tags"                 TEXT,
    "catalogCableModelId"  TEXT,
    "snapshotId"           TEXT,
    "wired"                INTEGER NOT NULL DEFAULT 0,
    "wiredAt"              TEXT,
    "wiredNotes"           TEXT,
    "bundleId"             TEXT REFERENCES "CableBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt"            TEXT NOT NULL
);
CREATE INDEX "RackConnection_snapshotId_idx" ON "RackConnection" ("snapshotId");
-- Écart (décision 10) : absents d'arkyo, voir l'en-tête.
CREATE INDEX "RackConnection_rackId_idx" ON "RackConnection" ("rackId");
CREATE INDEX "RackConnection_fromSlotId_idx" ON "RackConnection" ("fromSlotId");
CREATE INDEX "RackConnection_toSlotId_idx" ON "RackConnection" ("toSlotId");

CREATE TABLE "ProjectSynopticAdapter" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "projectId"        TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogAdapterId" TEXT,
    "snapshotId"       TEXT,
    "x"                REAL NOT NULL,
    "y"                REAL NOT NULL,
    "notes"            TEXT,
    "color"            TEXT,
    "createdAt"        TEXT NOT NULL,
    "updatedAt"        TEXT NOT NULL
);
CREATE INDEX "ProjectSynopticAdapter_projectId_idx" ON "ProjectSynopticAdapter" ("projectId");
CREATE INDEX "ProjectSynopticAdapter_snapshotId_idx" ON "ProjectSynopticAdapter" ("snapshotId");

CREATE TABLE "ProjectCableBundle" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name"      TEXT NOT NULL,
    "color"     TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "ProjectCableBundle_projectId_idx" ON "ProjectCableBundle" ("projectId");

CREATE TABLE "ProjectConnection" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "projectId"            TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromRackId"           TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromSlotId"           TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromConnectorIndex"   INTEGER,
    "fromAdapterId"        TEXT REFERENCES "ProjectSynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromAdapterPortIndex" INTEGER,
    "fromAdapterSide"      TEXT,
    "toRackId"             TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toSlotId"             TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toConnectorIndex"     INTEGER,
    "toAdapterId"          TEXT REFERENCES "ProjectSynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toAdapterPortIndex"   INTEGER,
    "toAdapterSide"        TEXT,
    "label"                TEXT,
    "color"                TEXT,
    "waypoints"            TEXT,
    "cableStyle"           TEXT,
    "notes"                TEXT,
    "tags"                 TEXT,
    "catalogCableModelId"  TEXT,
    "wired"                INTEGER NOT NULL DEFAULT 0,
    "wiredAt"              TEXT,
    "wiredNotes"           TEXT,
    "bundleId"             TEXT REFERENCES "ProjectCableBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt"            TEXT NOT NULL
);
CREATE INDEX "ProjectConnection_projectId_idx" ON "ProjectConnection" ("projectId");
CREATE INDEX "ProjectConnection_fromSlotId_idx" ON "ProjectConnection" ("fromSlotId");
CREATE INDEX "ProjectConnection_toSlotId_idx" ON "ProjectConnection" ("toSlotId");

CREATE TABLE "ProjectSynopticZone" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "x"         REAL NOT NULL,
    "y"         REAL NOT NULL,
    "w"         REAL NOT NULL,
    "h"         REAL NOT NULL,
    "color"     TEXT NOT NULL,
    "label"     TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "ProjectSynopticZone_projectId_idx" ON "ProjectSynopticZone" ("projectId");

CREATE TABLE "ProjectSynopticLabel" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "x"         REAL NOT NULL,
    "y"         REAL NOT NULL,
    "text"      TEXT NOT NULL,
    "color"     TEXT,
    "fontSize"  INTEGER,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "ProjectSynopticLabel_projectId_idx" ON "ProjectSynopticLabel" ("projectId");

CREATE TABLE "SynopticGuide" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "rackId"    TEXT REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "projectId" TEXT REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "axis"      TEXT NOT NULL,
    "position"  REAL NOT NULL,
    "color"     TEXT NOT NULL DEFAULT '#06b6d4',
    "label"     TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "SynopticGuide_rackId_idx" ON "SynopticGuide" ("rackId");
CREATE INDEX "SynopticGuide_projectId_idx" ON "SynopticGuide" ("projectId");

CREATE TABLE "ProjectSynopticLayout" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "projectId"  TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rackId"     TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "x"          REAL NOT NULL,
    "y"          REAL NOT NULL,
    "isExpanded" INTEGER NOT NULL DEFAULT 1,
    "createdAt"  TEXT NOT NULL,
    "updatedAt"  TEXT NOT NULL
);
CREATE UNIQUE INDEX "ProjectSynopticLayout_projectId_rackId_key" ON "ProjectSynopticLayout" ("projectId", "rackId");
CREATE INDEX "ProjectSynopticLayout_projectId_idx" ON "ProjectSynopticLayout" ("projectId");
