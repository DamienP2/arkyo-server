CREATE TABLE "Role" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "key"         TEXT NOT NULL UNIQUE,
    "label"       TEXT NOT NULL,
    "color"       TEXT NOT NULL DEFAULT '#6b7280',
    "isOwner"     INTEGER NOT NULL DEFAULT 0,
    "isBuiltin"   INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT NOT NULL DEFAULT '{}',
    "createdAt"   TEXT NOT NULL,
    "updatedAt"   TEXT NOT NULL
);

CREATE TABLE "User" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "email"              TEXT NOT NULL COLLATE NOCASE UNIQUE,
    "name"               TEXT,
    "username"           TEXT COLLATE NOCASE UNIQUE,
    "passwordHash"       TEXT NOT NULL,
    "mustChangePassword" INTEGER NOT NULL DEFAULT 0,
    "roleKey"            TEXT NOT NULL REFERENCES "Role" ("key") ON UPDATE CASCADE,
    "isActive"           INTEGER NOT NULL DEFAULT 1,
    "locale"             TEXT NOT NULL DEFAULT 'fr',
    "lastLogin"          TEXT,
    "createdAt"          TEXT NOT NULL,
    "updatedAt"          TEXT NOT NULL
);

CREATE TABLE "UserProfile" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "userId"    TEXT NOT NULL UNIQUE REFERENCES "User" ("id") ON DELETE CASCADE,
    "civility"  TEXT,
    "firstName" TEXT,
    "lastName"  TEXT,
    "phone"     TEXT,
    "company"   TEXT,
    "jobTitle"  TEXT,
    "avatarUrl" TEXT
);

CREATE TABLE "AuthSession" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "tokenHash"  TEXT NOT NULL UNIQUE,
    "userId"     TEXT NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    "createdAt"  TEXT NOT NULL,
    "expiresAt"  TEXT NOT NULL,
    "lastSeenAt" TEXT NOT NULL
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession" ("userId");

CREATE TABLE "Notification" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    "type"        TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "message"     TEXT,
    "data"        TEXT,
    "readAt"      TEXT,
    "createdAt"   TEXT NOT NULL
);
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification" ("recipientId", "readAt");
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification" ("recipientId", "createdAt");

CREATE TABLE "AppConfig" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "key"       TEXT NOT NULL UNIQUE,
    "value"     TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
