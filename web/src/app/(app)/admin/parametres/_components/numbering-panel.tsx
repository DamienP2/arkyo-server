"use client";

/**
 * NumberingPanel — onglet « Numérotation » des câbles (tenant).
 *
 * Wrapper : porte le state config (séparateurs, padding, includeContainer,
 * template perso) qui persiste via `PATCH /api/admin/config` à chaque
 * changement. Le rendu visuel est délégué à `NumberingTab` qui héberge
 * désormais le toggle "Personnaliser" dans sa card aperçu (et plus dans la
 * toolbar AdminTabLayout).
 */

import { useEffect, useState } from "react";

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import { NumberingTab } from "../../_components/numbering-tab";

type Props = { initialAppConfig: Record<string, string> };

export function NumberingPanel({ initialAppConfig }: Props) {
  const [cablePad, setCablePad] = useState<number>(Number(initialAppConfig["cable_pad"] ?? 5));
  const [cableSep1, setCableSep1] = useState<string>(
    initialAppConfig["cable_sep1"] ?? initialAppConfig["cable_separator"] ?? "-",
  );
  const [cableSep2, setCableSep2] = useState<string>(
    initialAppConfig["cable_sep2"] ?? initialAppConfig["cable_suffix_separator"] ?? "",
  );
  const [cableIncludeRack, setCableIncludeRack] = useState<boolean>(
    (initialAppConfig["cable_include_rack"] ?? "true") === "true",
  );
  const [cableTemplate, setCableTemplate] = useState<string>(
    initialAppConfig["cable_template"] ?? "",
  );
  const [cableTemplateEnabled, setCableTemplateEnabled] = useState<boolean>(
    initialAppConfig["cable_template_enabled"] === "true",
  );

  useEffect(() => {
    setCablePad(Number(initialAppConfig["cable_pad"] ?? 5));
    setCableSep1(initialAppConfig["cable_sep1"] ?? initialAppConfig["cable_separator"] ?? "-");
    setCableSep2(initialAppConfig["cable_sep2"] ?? initialAppConfig["cable_suffix_separator"] ?? "");
    setCableIncludeRack((initialAppConfig["cable_include_rack"] ?? "true") === "true");
    setCableTemplate(initialAppConfig["cable_template"] ?? "");
    setCableTemplateEnabled(initialAppConfig["cable_template_enabled"] === "true");
  }, [initialAppConfig]);

  return (
    <AdminTabLayout>
      <NumberingTab
        cablePad={cablePad}
        setCablePad={setCablePad}
        cableSep1={cableSep1}
        setCableSep1={setCableSep1}
        cableSep2={cableSep2}
        setCableSep2={setCableSep2}
        cableIncludeRack={cableIncludeRack}
        setCableIncludeRack={setCableIncludeRack}
        cableTemplate={cableTemplate}
        setCableTemplate={setCableTemplate}
        cableTemplateEnabled={cableTemplateEnabled}
        setCableTemplateEnabled={setCableTemplateEnabled}
      />
    </AdminTabLayout>
  );
}
