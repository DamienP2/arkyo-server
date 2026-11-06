/**
 * Descripteurs d'onglets de l'éditeur projet — utilisés par
 * `project-editor.tsx` et `project-tabs-pill.tsx`.
 *
 * Note : ce fichier exposait précédemment un composant `TabBar` rendu en
 * page (pattern supervisor `_editor/ui.tsx`). Il a été remplacé par
 * `ProjectTabsPill` (pill rendu à cheval dans la topbar globale du shell).
 * Le fichier est conservé pour exposer les types — point d'extension pour
 * d'éventuels nouveaux onglets.
 */

export type ProjectTabId =
  | "inventaire"
  | "rack"
  | "schema"
  | "synoptique"
  | "cartographie"
  | "video"
  | "audio"
  | "lumiere"
  | "reseau"
  | "preparation"
  | "recette";

export type TabSubItem = { id: string; label: string };

export type TabDescriptor = {
  id: ProjectTabId;
  label: string;
  /** Si défini : l'onglet est un dropdown.
   *  - sous-états d'UN onglet (ex. Lumière → Plan de feu / DMX, Réseau → sections)
   *  - OU, si `navGroup` est vrai, un GROUPE dont chaque `subTabs.id` est un
   *    onglet RÉEL (ProjectTabId) vers lequel on navigue (ex. Livraison →
   *    Préparation / Recette). */
  subTabs?: TabSubItem[];
  /** true → dropdown de groupe : les items sont de vrais onglets à activer. */
  navGroup?: boolean;
};
