"use client";

import { useState } from "react";

export type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
  variant?: "danger" | "default";
};

/**
 * Promise-based confirm dialog state used by rack-editor.
 * Pairs with `<ConfirmDialog state={confirmState} onCancel={cancel} />`.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const confirm = (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: "danger" | "default";
  }) =>
    new Promise<boolean>((resolve) => {
      setState({
        open: true,
        ...opts,
        onConfirm: () => {
          setState((s) => ({ ...s, open: false }));
          resolve(true);
        },
      });
    });

  const cancel = () => {
    setState((s) => ({ ...s, open: false }));
  };

  return { confirmState: state, confirm, cancel };
}
