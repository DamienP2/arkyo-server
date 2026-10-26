/**
 * Types du client Prisma « main » d'arkyo (`arkyo:lib/prisma/main-client`,
 * généré depuis `arkyo:database/main/schema.prisma`) importés par les fichiers
 * front copiés.
 *
 * arkyo-server n'a pas de client Prisma : ce module ne déclare que les types
 * dont le front a besoin, à l'identique des enums du schéma.
 */

/** `enum MemberRole` (arkyo:database/main/schema.prisma). */
export type MemberRole = "OWNER" | "CHEF_PROJET" | "TECHNICIEN" | "CONSULTATION";
