// Re-export from the shared synoptique module. The original implementation has
// been moved to `components/synoptique/components/rack-editor-confirm-dialog.tsx`
// so the shared synoptic stack (and the project synoptique tab) can consume it
// without importing from `app/(app)/rigs/...`.
export {
  RackEditorConfirmDialog,
  type RackEditorConfirmDialogProps,
} from "@/components/synoptique/components/rack-editor-confirm-dialog";
