# Arkyo — Patterns UI canoniques

> arkyo-server : habillage Strata — police Inter, palette Strata (voir CLAUDE.md)

> **OBLIGATOIRE** : avant toute UI nouvelle ou refonte, lire ce fichier et **réutiliser** les composants/snippets ci-dessous. Ne jamais inventer une variante.
> Si un composant manquant est nécessaire → en parler à l'utilisateur avant de créer.

---

## 1. Composants partagés (réutilisables)

| Pattern               | Composant                                       | Path                                                                       |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| État vide             | `EmptyState` + `EmptyStateAction`               | `components/ui/empty-state.tsx`                                            |
| Attente de zone       | `LoadingState`                                  | `components/ui/loading-state.tsx`                                          |
| Modal Radix           | `Dialog` + `DialogContent` + `DialogTitle`      | `components/ui/dialog.tsx`                                                 |
| Slider numérique      | `RangeInput` (avec `editable showBounds`)       | `components/wizard/range-input.tsx`                                        |
| Upload image cropée   | `ImageCropUpload` (avec `forceAspectRatio`)     | `components/ui/image-crop-upload.tsx`                                      |
| Confirmation          | `ConfirmDialog`                                 | `components/ui/confirm-dialog.tsx`                                         |
| Icône connecteur      | `ConnectorIcon`                                 | `components/ui/connector-icon.tsx`                                         |
| Toast                 | `toast` (sonner)                                | `components/ui/toast.tsx`                                                  |
| Layout onglet admin   | `AdminTabLayout`                                | `app/(app)/admin/_components/admin-tab-layout.tsx`                         |

### Pickers monochromes (modaux de sélection)

| Picker            | Composant                                       | Path                                                                       |
| ----------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Connecteur        | `ConnectorPickerModal` + `ConnectorPickerTrigger` | `components/catalogue/connector-picker-modal.tsx`                       |
| Marque            | `BrandPickerModal`                              | `components/catalogue/brand-picker-modal.tsx`                              |
| Fonction (single) | `FunctionPickerModal`                           | `components/catalogue/function-picker-modal.tsx`                           |
| Fonction (multi)  | `FunctionMultiPickerModal`                      | `components/catalogue/function-multi-picker-modal.tsx`                     |
| Type (cordon)     | `TypePickerModal`                               | `components/catalogue/type-picker-modal.tsx`                               |
| Phase             | `PhasePickerModal`                              | `components/catalogue/phase-picker-modal.tsx`                              |
| Catégorie         | `CategoryPickerModal`                           | `components/catalogue/category-picker-modal.tsx`                           |

**Règle :** pour brand/function/type/phase, **toujours** utiliser le picker modal, jamais un dropdown.

**Règle :** attente de zone (panneau, page, liste, section en attente de fetch) → **toujours** `LoadingState`, jamais un texte brut « Chargement… ». Le libellé par défaut est « Chargement… » ; ne le personnaliser que s'il est informatif (« Chargement des factures… »). Ajuster l'espace vertical via `className` (ex. `py-8`, `py-12`), jamais via une prop `size`.

---

## 2. Pattern liste vide vs avec données

**Cas vide (`items.length === 0`)** → composant `EmptyState` exclusivement. Référence canonique : `app/(app)/admin/catalogue/_components/cables-list-panel.tsx` lignes 737-748.

```tsx
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";

<EmptyState
  icon={<IconLucide strokeWidth={1.5} />}
  title="Aucun X"
  description="Texte sobre — pas de hint évident."
  action={
    <EmptyStateAction onClick={handleCreate}>
      <Plus className="h-3.5 w-3.5" />
      Ajouter un X
    </EmptyStateAction>
  }
/>
```

**Cas avec données** :
1. Toolbar fixe (recherche + tri/filtres + compteur) via `AdminTabLayout` `toolbar`
2. Bouton inline dashed pleine largeur via `addButton`
3. Grille/liste en `children`

---

## 3. Boutons d'ajout — TOUJOURS dashed, JAMAIS plein accent

### Bouton pleine largeur (au-dessus d'une liste avec données)

```tsx
<button
  type="button"
  onClick={openAdd}
  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
>
  <Plus className="h-4 w-4" />
  Ajouter un X
</button>
```

### Petit bouton inline (dans EmptyStateAction)

Le composant `EmptyStateAction` est déjà en dashed — utiliser tel quel.

### ❌ INTERDIT pour boutons "Ajouter"

- `bg-[var(--accent)]`
- `bg-primary`
- `bg-blue-*`
- Toute classe qui produit un bouton **plein coloré** pour une action d'ajout standard.

---

## 4. Cards d'items en grille

Pattern card individuelle, utilisée pour groupes de connecteurs, sorties d'adaptateur, etc.

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {items.map((item) => (
    <div
      key={item.id}
      className="group relative flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm transition-all hover:border-[var(--accent)]/40 hover:shadow-md"
    >
      {/* Header : thumbnail + titre + actions */}
      <div className="flex items-start gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--secondary)]">
          {/* icône ou image */}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{item.title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
            {item.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* boutons edit/delete h-7 w-7 */}
        </div>
      </div>

      {/* Footer optionnel : meta + badges, séparé par border-t */}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)]/60 pt-2">
        {/* signal, direction, ×N badge accent/10 */}
      </div>
    </div>
  ))}
</div>
```

### Card en row compact (BomRow) — quand densité prioritaire

Référence canonique : `app/(fullscreen)/project/[id]/inventaire/_components/bom-panel.tsx` lignes 510-567 (`BomRow`).

```tsx
<div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] py-1.5 pr-2 pl-2">
  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--secondary)]">
    {/* thumbnail 36×36 */}
  </div>
  <div className="min-w-0 flex-1">
    <p className="truncate text-xs font-medium leading-tight">{name}</p>
    <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
      {meta1} · {meta2} · {meta3}
    </p>
  </div>
  {/* contrôles à droite h-7 */}
</div>
```

**Le terme "card" dans cette app = élément avec son propre cadre (border + bg + rounded).** Que ce soit grille ou stack vertical, chaque item a son cadre. Ne pas faire de "lignes plates" sans cadre sauf demande explicite.

---

## 5. Hero pages d'édition (équipement, adaptateur, cordon)

3 colonnes équilibrées `lg:grid-cols-3 items-stretch`, chaque colonne contient un ou plusieurs blocs (`Card`). Référence : `app/(app)/admin/equipment/[id]/_editor/general-tab.tsx`.

- Pas d'ActivePill sur les éditeurs tenant
- Breadcrumb chemin uniquement (pas de nom/status au header)
- Image 16:9 forcée via `ImageCropUpload forceAspectRatio={16/9}`

---

## 6. Persistance d'onglets / vue

Onglet actif + mode grid/list persistés via `localStorage` (pattern dans `supervisor` et `admin`). Clé : `arkyo:<scope>:<tab|view>`.

---

## 7. DnD (réordonnancement de listes/grilles)

```tsx
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
```

- Handle `GripVertical` **dédiée** (jamais sur toute la card) — sinon collision avec boutons edit/delete
- `PointerSensor` avec `activationConstraint: { distance: 4 }`
- `isDragging` → `opacity-50 shadow-lg z-50`
- Handle visible au hover : `opacity-0 group-hover:opacity-100`
- Strategy : `rectSortingStrategy` pour grille, `verticalListSortingStrategy` pour stack vertical

---

## 8. Forms — validation et UX

- `react-hook-form` + `zod` via `@hookform/resolvers/zod`
- Champs obligatoires : asterisque dans le label, `aria-invalid` + bordure `[var(--destructive)]` quand erreur
- Hint d'erreur sous le champ en `text-xs text-[var(--destructive)]`
- Bouton submit `disabled` quand le formulaire est invalide, avec `title` contextuel
- Champs dépendants : `disabled` tant que la dépendance n'est pas remplie (ex : Signal disabled tant que Connecteur vide)

---

## 9. Anti-patterns (ce qu'on ne fait JAMAIS)

| Anti-pattern                                              | Pourquoi                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Bouton plein accent/bleu pour une action "Ajouter"        | Voir §3 — toujours dashed                                               |
| EmptyState custom (div centrée maison)                    | Utiliser `EmptyState` shared                                            |
| Dropdown `<select>` pour brand/function/type/phase        | Utiliser le picker modal correspondant                                  |
| Hint « Auto-rempli — modifiable », « Cliquez pour… »      | Comportement observable → pas besoin d'expliquer                        |
| Glyphes ♂ ♀ pour le genre connecteur                       | Écrire `M`/`F`/`N` ou `Mâle`/`Femelle`/`Neutre`                          |
| Inventer un layout/style pour matcher la DA arkyo         | La DA est un vocabulaire de moyens, pas un template à appliquer         |
| Documentation/blabla auto-générée (commentaires inutiles) | Sobriété — pas de JSDoc descriptive, juste raison du *pourquoi*         |
| Re-implémenter un picker / un modal / un slider           | Réutiliser les composants partagés (voir §1)                            |

---

## 10. DA arkyo — règles d'usage

- Polices : DM Sans (body), IBM Plex Mono (code/labels mono), Instrument Serif (titres exceptionnels)
- Palette : `ink`, `deep`, `blue` + couleurs signal (catégories)
- **Sobriété toujours** : pas de gradient flashy, pas d'illustrations gratuites, pas de reskinning
- Variables CSS : `var(--background)`, `var(--card)`, `var(--secondary)`, `var(--border)`, `var(--accent)`, `var(--destructive)`, `var(--muted-foreground)`, `var(--foreground)`
- Border-radius : `rounded-md` (rows compacts), `rounded-lg` (boutons), `rounded-xl` (cards individuelles), `rounded-full` (pills onglets)
