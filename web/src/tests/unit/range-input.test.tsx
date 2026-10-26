import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RangeInput } from "@/components/wizard/range-input";

/**
 * La saisie manuelle (mode `editable`) doit arrondir à la précision du `step`
 * au commit (blur / Enter). Le serveur valide plusieurs champs en entier
 * strict (`z.number().int()` : depthMm, powerW, heightU, dimL/W/Hmm…) — une
 * valeur décimale envoyée telle quelle provoque un 400 opaque à la création
 * d'un équipement.
 */
describe("RangeInput — saisie manuelle (EditableValue)", () => {
  const renderEditable = (props: Partial<React.ComponentProps<typeof RangeInput>> = {}) => {
    const onChange = vi.fn();
    render(
      <RangeInput
        min={100}
        max={1200}
        step={10}
        value={400}
        onChange={onChange}
        label="Profondeur"
        unit="mm"
        editable
        {...props}
      />,
    );
    return { onChange, input: screen.getByRole("spinbutton") };
  };

  it("arrondit une décimale à l'entier quand le step est entier (step=10)", () => {
    const { onChange, input } = renderEditable();
    fireEvent.change(input, { target: { value: "462.5" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(463);
  });

  it("n'arrondit PAS au multiple du step (saisie fine légitime, ex. 463 W)", () => {
    const { onChange, input } = renderEditable({ min: 0, max: 5000, value: 0 });
    fireEvent.change(input, { target: { value: "463" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(463);
  });

  it("conserve une décimale quand le step en a une (step=0.5, poids)", () => {
    const { onChange, input } = renderEditable({
      min: 0,
      max: 200,
      step: 0.5,
      value: 0,
      label: "Poids",
      unit: "kg",
    });
    fireEvent.change(input, { target: { value: "12.34" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(12.3);
  });

  it("clampe toujours aux bornes après arrondi", () => {
    const { onChange, input } = renderEditable();
    fireEvent.change(input, { target: { value: "1500.7" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(1200);
  });

  it("valide aussi sur Enter", () => {
    const { onChange, input } = renderEditable();
    fireEvent.change(input, { target: { value: "250.4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(250);
  });
});
