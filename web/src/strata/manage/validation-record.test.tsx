/**
 * Rapport de validation par projet : seules les publications du synoptique
 * faites pendant que le projet est ouvert lui sont attribuées.
 */

import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { ValidationRecorder, useValidationRecordStore } from "./validation-record";

const report = (n: number): ValidationReport => ({ issues: [], counts: { error: n, warning: 0, info: 0 } });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useValidationRecordStore.setState({ byProject: {} });
  useTopbarActions.getState().setValidationReport(null);
});

describe("ValidationRecorder", () => {
  test("un rapport resté d'un autre projet n'est pas attribué ; une publication l'est, avec sa vue", () => {
    const stale = report(3);
    useTopbarActions.getState().setValidationReport(stale);
    window.localStorage.setItem("project-p1-synoptique-rack", "loc:l1");
    render(<ValidationRecorder projectId="p1" />);
    expect(useValidationRecordStore.getState().byProject.p1).toBeUndefined();

    const fresh = report(1);
    act(() => useTopbarActions.getState().setValidationReport(fresh));
    expect(useValidationRecordStore.getState().byProject.p1).toEqual({ projectId: "p1", viewId: "loc:l1", report: fresh });

    // Vue Générale : le synoptique retire son rapport.
    act(() => useTopbarActions.getState().setValidationReport(null));
    expect(useValidationRecordStore.getState().byProject.p1?.report).toBeNull();
    cleanup();
    // Démonté : plus rien n'est noté.
    act(() => useTopbarActions.getState().setValidationReport(report(5)));
    expect(useValidationRecordStore.getState().byProject.p1?.report).toBeNull();
  });
});
