-- Phase 3 : projets, lieux, régies, contenants (racks), panels.
--
-- Source : arkyo@88b2e4b, database/tenant/schema.prisma (modèles Project,
-- TechnicalSheet, Location, RigConfig, RigRack, Rack, RackSlot,
-- RackInventoryItem, Panel, PanelSlot, Task, Message, ProjectDocument) et ses
-- migrations SQL (clés étrangères et index). Conventions de 0002_catalogue.sql :
-- String → TEXT, Int → INTEGER, Float → REAL, Boolean → INTEGER 0/1,
-- DateTime → TEXT ISO 8601 UTC ms, Json → TEXT JSON ; enum Prisma → TEXT CHECK
-- (valeurs de l'enum, dans l'ordre du schéma). createdAt / updatedAt sont posés
-- par le handler. Les « soft FK » d'arkyo (catalogEquipmentId, catalogAdapterId,
-- catalogConnectorTypeId, snapshotId, createdById, assignedToId…) restent du
-- texte ; clés étrangères seulement pour les vraies relations du schéma tenant,
-- avec l'ON DELETE d'arkyo (relation optionnelle sans onDelete → SET NULL,
-- obligatoire → CASCADE quand arkyo l'écrit) et ON UPDATE CASCADE.
--
-- Écarts et choix :
-- - Project.ipMapPositions (phase 5) est créé dès maintenant, nullable : les
--   routes renvoient toutes les colonnes scalaires du projet, comme Prisma.
-- - RackSlot.snapshotId / RackInventoryItem.snapshotId : présents, nullables,
--   toujours NULL (décision 5 : les snapshots du catalogue Arkyo sont SaaS).
-- - Task, Message, ProjectDocument : créées vides (décision 4), pour que les
--   compteurs soient de vraies requêtes. Rien ne les écrit, comme dans arkyo.
-- - AuditLog.projectId reste sans clé étrangère (SQLite ne sait pas en ajouter
--   à une table existante) : la suppression d'un projet remet ses lignes
--   d'audit à NULL dans la route (SetNull d'arkyo, décision 7).
-- - Panel.panelType / accessoryType / plateType, RackInventoryItem.accessory* :
--   String dans arkyo (pas d'enum), donc sans CHECK.

CREATE TABLE "Project" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "name"              TEXT NOT NULL,
    "clientName"        TEXT,
    "shootingDate"      TEXT,
    "shootingEndDate"   TEXT,
    "planningStart"     TEXT,
    "planningEnd"       TEXT,
    "commissioningDate" TEXT,
    "location"          TEXT,
    "description"       TEXT,
    "status"            TEXT NOT NULL DEFAULT 'EN_PREPARATION'
        CHECK ("status" IN ('EN_PREPARATION', 'PRET', 'EN_COURS', 'TERMINE', 'ANNULE')),
    "prestationType"    TEXT,
    "interventionType"  TEXT NOT NULL DEFAULT 'PRESTATION'
        CHECK ("interventionType" IN ('PRESTATION', 'INTEGRATION')),
    "rigType"           TEXT
        CHECK ("rigType" IN ('FLIGHT_CASE', 'CAR', 'FIXED_INSTALL', 'MIXED')),
    "createdAt"         TEXT NOT NULL,
    "updatedAt"         TEXT NOT NULL,
    "createdById"       TEXT NOT NULL,
    "ipMapPositions"    TEXT
);

CREATE TABLE "TechnicalSheet" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "projectId"         TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "blocks"            TEXT NOT NULL DEFAULT '[]',
    "completionPercent" REAL NOT NULL DEFAULT 0,
    "createdAt"         TEXT NOT NULL,
    "updatedAt"         TEXT NOT NULL
);
CREATE UNIQUE INDEX "TechnicalSheet_projectId_key" ON "TechnicalSheet" ("projectId");

CREATE TABLE "ProjectDocument" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "projectId"    TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name"         TEXT NOT NULL,
    "url"          TEXT NOT NULL,
    "mimeType"     TEXT,
    "sizeBytes"    INTEGER,
    "uploadedAt"   TEXT NOT NULL,
    "uploadedById" TEXT
);
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument" ("projectId");

CREATE TABLE "Task" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "projectId"    TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "title"        TEXT NOT NULL,
    "description"  TEXT,
    "status"       TEXT NOT NULL DEFAULT 'A_FAIRE'
        CHECK ("status" IN ('A_FAIRE', 'EN_COURS', 'TERMINE', 'VALIDE')),
    "priority"     TEXT NOT NULL DEFAULT 'NORMALE'
        CHECK ("priority" IN ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE')),
    "dueDate"      TEXT,
    "completedAt"  TEXT,
    "order"        INTEGER NOT NULL DEFAULT 0,
    "fromTemplate" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "createdAt"    TEXT NOT NULL,
    "updatedAt"    TEXT NOT NULL
);

CREATE TABLE "Message" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "projectId"   TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "authorId"    TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'OUVERTE'
        CHECK ("status" IN ('OUVERTE', 'REPONDUE', 'VALIDEE', 'CLOTUREE')),
    "blockRef"    TEXT,
    "attachments" TEXT,
    "createdAt"   TEXT NOT NULL,
    "updatedAt"   TEXT NOT NULL
);

CREATE TABLE "Location" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name"      TEXT NOT NULL,
    "cableCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "canvasX"   INTEGER,
    "canvasY"   INTEGER,
    "canvasW"   INTEGER,
    "canvasH"   INTEGER,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE INDEX "Location_projectId_idx" ON "Location" ("projectId");

CREATE TABLE "RigConfig" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "type"           TEXT NOT NULL DEFAULT 'FLIGHT_CASE'
        CHECK ("type" IN ('FLIGHT_CASE', 'CAR', 'FIXED_INSTALL', 'MIXED')),
    "prestationType" TEXT,
    "isTemplate"     INTEGER NOT NULL DEFAULT 0,
    "notes"          TEXT,
    "projectId"      TEXT REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdById"    TEXT NOT NULL,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL
);

CREATE TABLE "Rack" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "name"               TEXT NOT NULL,
    "totalU"             INTEGER NOT NULL DEFAULT 42,
    "depthMm"            INTEGER NOT NULL DEFAULT 600,
    "maxWeightKg"        REAL,
    "maxPowerW"          REAL,
    "emptyWeightKg"      REAL,
    "notes"              TEXT,
    "rearInteriorGapMm"  INTEGER,
    "cableId"            INTEGER,
    "cableNextNum"       INTEGER NOT NULL DEFAULT 1,
    "cableCode"          TEXT,
    "numberingOverride"  TEXT,
    "rackType"           TEXT NOT NULL DEFAULT 'STANDARD'
        CHECK ("rackType" IN ('STANDARD', 'FLIGHT_CASE_CLASSIC', 'FLIGHT_CASE_SKB', 'PELICAN', 'CAP')),
    "isRackable"         INTEGER NOT NULL DEFAULT 1,
    "widthMm"            INTEGER,
    "heightMm"           INTEGER,
    "hasWheels"          INTEGER NOT NULL DEFAULT 0,
    "constructionChecks" TEXT NOT NULL DEFAULT '[]',
    "templateStatus"     TEXT NOT NULL DEFAULT 'BROUILLON'
        CHECK ("templateStatus" IN ('BROUILLON', 'INACTIF', 'ACTIF')),
    "prepStatus"         TEXT NOT NULL DEFAULT 'TO_PREPARE'
        CHECK ("prepStatus" IN ('TO_PREPARE', 'TO_ORDER', 'ORDERED', 'RECEIVED', 'READY')),
    "sourcing"           TEXT NOT NULL DEFAULT 'STOCK'
        CHECK ("sourcing" IN ('STOCK', 'PURCHASE', 'RENTAL')),
    "canvasX"            INTEGER,
    "canvasY"            INTEGER,
    "locationId"         TEXT REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "isVirtual"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"          TEXT NOT NULL,
    "updatedAt"          TEXT NOT NULL
);
CREATE INDEX "Rack_locationId_idx" ON "Rack" ("locationId");

CREATE TABLE "RigRack" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "rigConfigId" TEXT NOT NULL REFERENCES "RigConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rackId"      TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "position"    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "RigRack_rigConfigId_rackId_key" ON "RigRack" ("rigConfigId", "rackId");

CREATE TABLE "Panel" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "name"             TEXT NOT NULL,
    "panelType"        TEXT NOT NULL DEFAULT 'PATCH',
    "accessoryType"    TEXT,
    "plateType"        TEXT,
    "heightU"          INTEGER NOT NULL DEFAULT 1,
    "slotsPerU"        INTEGER NOT NULL DEFAULT 8,
    "depthMm"          INTEGER,
    "rearCableDepthMm" INTEGER NOT NULL DEFAULT 80,
    "notes"            TEXT,
    "private"          INTEGER NOT NULL DEFAULT 0,
    "createdById"      TEXT NOT NULL,
    "createdAt"        TEXT NOT NULL,
    "updatedAt"        TEXT NOT NULL
);
CREATE INDEX "Panel_private_idx" ON "Panel" ("private");

CREATE TABLE "PanelSlot" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "panelId"                TEXT NOT NULL REFERENCES "Panel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "position"               INTEGER NOT NULL,
    "sizeSlots"              INTEGER NOT NULL DEFAULT 1,
    "label"                  TEXT,
    "notes"                  TEXT,
    "catalogConnectorTypeId" TEXT,
    "mountD"                 INTEGER NOT NULL DEFAULT 0,
    "familyLabel"            TEXT
);

CREATE TABLE "RackInventoryItem" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "rackId"             TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogEquipmentId" TEXT,
    "panelId"            TEXT REFERENCES "Panel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "catalogAdapterId"   TEXT,
    "snapshotId"         TEXT,
    "accessoryType"      TEXT,
    "accessoryHeightU"   INTEGER,
    "accessoryVariant"   TEXT,
    "accessoryDepthMm"   INTEGER,
    "quantity"           INTEGER NOT NULL DEFAULT 1,
    "notes"              TEXT,
    "hostItemId"         TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "hostSlotIndex"      INTEGER,
    "createdAt"          TEXT NOT NULL,
    "updatedAt"          TEXT NOT NULL
);
CREATE INDEX "RackInventoryItem_rackId_idx" ON "RackInventoryItem" ("rackId");
CREATE INDEX "RackInventoryItem_catalogEquipmentId_idx" ON "RackInventoryItem" ("catalogEquipmentId");
CREATE INDEX "RackInventoryItem_panelId_idx" ON "RackInventoryItem" ("panelId");
CREATE INDEX "RackInventoryItem_catalogAdapterId_idx" ON "RackInventoryItem" ("catalogAdapterId");
CREATE INDEX "RackInventoryItem_snapshotId_idx" ON "RackInventoryItem" ("snapshotId");
CREATE INDEX "RackInventoryItem_hostItemId_idx" ON "RackInventoryItem" ("hostItemId");

CREATE TABLE "RackSlot" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "rackId"             TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogEquipmentId" TEXT,
    "snapshotId"         TEXT,
    "panelId"            TEXT REFERENCES "Panel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "parentSlotId"       TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "inventoryItemId"    TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "view"               TEXT NOT NULL DEFAULT 'FRONT'
        CHECK ("view" IN ('FRONT', 'REAR', 'REAR_INTERIOR', 'SIDE')),
    "startU"             INTEGER,
    "heightU"            REAL,
    "widthFraction"      TEXT NOT NULL DEFAULT 'FULL'
        CHECK ("widthFraction" IN ('FULL', 'HALF', 'THIRD', 'QUARTER')),
    "column"             INTEGER NOT NULL DEFAULT 0,
    "label"              TEXT,
    "notes"              TEXT,
    "patchNotes"         TEXT,
    "panelLabels"        TEXT,
    "synopticX"          REAL,
    "synopticY"          REAL,
    "createdAt"          TEXT NOT NULL,
    "updatedAt"          TEXT NOT NULL
);
CREATE INDEX "RackSlot_inventoryItemId_idx" ON "RackSlot" ("inventoryItemId");
CREATE INDEX "RackSlot_snapshotId_idx" ON "RackSlot" ("snapshotId");
